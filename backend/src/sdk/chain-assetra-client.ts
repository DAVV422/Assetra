import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { AssetraClient, ChainPublicConfig } from "./assetra-client.js";
import { ChainError, ChainReader, scv, type VerifiedTx } from "./chain.js";
import type {
  ActivityEvent,
  Asset,
  AssetStatus,
  CreateAssetInput,
  DocumentRecord,
  LifecycleActionInput,
  Participant,
  ParticipantStatus,
  TransferInput,
  TransferResult
} from "../types.js";

interface ContractsConfig extends ChainPublicConfig {
  tokenContractId?: string;
  assetId?: string;
  accounts?: Partial<Record<"admin" | "issuer" | "compliance" | "walletA" | "walletB", string>>;
}

interface OnChainAsset {
  issuer: string;
  compliance_officer: string;
  token: string;
  due_date: bigint;
  status: number;
}

interface Store {
  assets: Asset[];
  /** Hashes ya utilizados como prueba: cada transacción respalda una sola escritura. */
  usedTx: string[];
}

const assetStatuses: AssetStatus[] = ["draft", "active", "paused", "redeemed"];
const walletStatuses: ParticipantStatus[] = ["pending", "authorized", "revoked", "frozen"];
const lifecycleStatusCode = { activate: 1, unpause: 1, pause: 2, redeem: 3 } as const;
const participantFns: Partial<Record<ParticipantStatus, string>> = {
  authorized: "authorize_wallet",
  revoked: "revoke_wallet",
  frozen: "freeze_wallet"
};

const clone = <T>(value: T): T => structuredClone(value);
const short = (address: string) => `${address.slice(0, 4)}...${address.slice(-4)}`;
const toHex = (value: unknown) => Buffer.from(value as Uint8Array).toString("hex");

function loadContractsConfig(): ContractsConfig {
  const candidates = [
    path.resolve(process.cwd(), "contracts.json"),
    path.resolve(process.cwd(), "..", "contracts.json"),
    path.resolve(import.meta.dirname, "../../../contracts.json"),
    path.resolve(import.meta.dirname, "../../contracts.json")
  ];
  let file: Partial<ContractsConfig> = {};
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      file = JSON.parse(fs.readFileSync(candidate, "utf8"));
      break;
    }
  }
  const config: ContractsConfig = {
    ...file,
    network: process.env.STELLAR_NETWORK ?? file.network ?? "testnet",
    rpcUrl: process.env.STELLAR_RPC_URL ?? file.rpcUrl ?? "https://soroban-testnet.stellar.org",
    networkPassphrase: process.env.STELLAR_NETWORK_PASSPHRASE ?? file.networkPassphrase ?? "Test SDF Network ; September 2015",
    registryContractId: process.env.RWA_REGISTRY_CONTRACT_ID || file.registryContractId || "",
    adminAddress: process.env.STELLAR_ADMIN_ADDRESS || file.adminAddress || ""
  };
  if (!config.registryContractId || !config.adminAddress) {
    throw new Error("Falta registryContractId/adminAddress: ejecuta npm run script:deploy o define RWA_REGISTRY_CONTRACT_ID.");
  }
  return config;
}

export class ChainAssetraClient implements AssetraClient {
  private readonly cfg: ContractsConfig;
  private readonly chain: ChainReader;
  private readonly storagePath: string;
  private store: Store;
  private readonly ready: Promise<void>;

  constructor() {
    this.cfg = loadContractsConfig();
    this.chain = new ChainReader({
      rpcUrl: this.cfg.rpcUrl,
      networkPassphrase: this.cfg.networkPassphrase,
      readSource: this.cfg.adminAddress
    });
    this.storagePath = this.resolveStoragePath();
    this.store = this.loadStore();
    this.ready = this.bootstrapDemoAsset().catch((err) => {
      console.warn("Notice: could not bootstrap demo asset from chain:", err instanceof Error ? err.message : err);
    });
  }

  config(): ChainPublicConfig {
    const { network, rpcUrl, networkPassphrase, registryContractId, adminAddress } = this.cfg;
    return { network, rpcUrl, networkPassphrase, registryContractId, adminAddress };
  }

  // ------------------------------------------------------------------
  // Persistencia local de metadatos (la verdad de permisos y saldos está on-chain)
  // ------------------------------------------------------------------

  private resolveStoragePath(): string {
    const dirs = [
      path.resolve(process.cwd(), "backend/data"),
      path.resolve(process.cwd(), "data"),
      path.resolve(import.meta.dirname, "../../data"),
      path.resolve(import.meta.dirname, "../../../data")
    ];
    const dir = dirs.find((d) => fs.existsSync(d)) ?? dirs[1];
    return path.join(dir, "chain-assets.json");
  }

  private loadStore(): Store {
    try {
      if (fs.existsSync(this.storagePath)) {
        const parsed = JSON.parse(fs.readFileSync(this.storagePath, "utf8"));
        if (Array.isArray(parsed.assets)) return { assets: parsed.assets, usedTx: parsed.usedTx ?? [] };
      }
    } catch (err) {
      console.error("Warning: could not read chain asset store:", err);
    }
    return { assets: [], usedTx: [] };
  }

  private save() {
    try {
      fs.mkdirSync(path.dirname(this.storagePath), { recursive: true });
      fs.writeFileSync(this.storagePath, JSON.stringify(this.store, null, 2), "utf8");
    } catch (err) {
      console.error("Warning: could not save chain asset store:", err);
    }
  }

  private find(assetId: string): Asset {
    const asset = this.store.assets.find((item) => item.id === assetId);
    if (!asset) throw new Error("ASSET_NOT_FOUND");
    return asset;
  }

  // ------------------------------------------------------------------
  // Sincronización con la cadena
  // ------------------------------------------------------------------

  private readAsset(onChainId: string): Promise<OnChainAsset> {
    return this.chain.read<OnChainAsset>(this.cfg.registryContractId, "get_asset", [scv.symbol(onChainId)]);
  }

  private async sync(asset: Asset): Promise<void> {
    if (!asset.onChainId) return;
    const data = await this.readAsset(asset.onChainId);
    asset.status = assetStatuses[data.status] ?? asset.status;
    asset.contractId = data.token;
    asset.complianceOfficer = data.compliance_officer;
    asset.creatorWallet = data.issuer;

    const [supply, maxSupply] = await Promise.all([
      this.chain.read<bigint>(data.token, "total_supply"),
      this.chain.read<bigint>(data.token, "max_supply")
    ]);
    asset.mintedSupply = Number(supply);
    asset.supply = Number(maxSupply);

    await Promise.all(
      asset.participants.map(async (participant) => {
        const status = await this.chain.read<number>(this.cfg.registryContractId, "wallet_status", [
          scv.symbol(asset.onChainId!),
          scv.address(participant.wallet)
        ]);
        participant.status = walletStatuses[status] ?? participant.status;
      })
    );

    const holders = new Set([data.issuer, ...asset.participants.map((p) => p.wallet)]);
    const balances = await Promise.all(
      [...holders].map((wallet) => this.chain.read<bigint>(data.token, "balance", [scv.address(wallet)]))
    );
    asset.holderCount = balances.filter((balance) => balance > 0n).length;
  }

  private async verify(txHash: string | undefined, expect: Parameters<ChainReader["verifyTx"]>[1]): Promise<VerifiedTx> {
    if (!txHash) throw new ChainError("TX_PROOF_REQUIRED", "en modo live cada operación debe incluir el hash de su transacción firmada");
    const hash = txHash.toLowerCase();
    if (this.store.usedTx.includes(hash)) throw new ChainError("TX_ALREADY_USED", "esa transacción ya fue registrada");
    return this.chain.verifyTx(hash, expect);
  }

  private record(asset: Asset, type: string, label: string, tx: VerifiedTx) {
    const event: ActivityEvent = { id: randomUUID(), type, label, actor: short(tx.source), timestamp: tx.timestamp, txHash: tx.hash };
    asset.activity.unshift(event);
    this.store.usedTx.push(tx.hash);
  }

  /** Crea en el catálogo el activo de demostración del seed (FACT001) a partir de la cadena. */
  private async bootstrapDemoAsset() {
    const onChainId = this.cfg.assetId;
    if (!onChainId || this.store.assets.some((a) => a.onChainId === onChainId)) return;

    const data = await this.readAsset(onChainId);
    const accounts = this.cfg.accounts ?? {};
    const participants: Participant[] = [
      { name: "Andina Export (Emisor)", wallet: accounts.issuer, jurisdiction: "Bolivia" },
      { name: "Aya Capital (Wallet A)", wallet: accounts.walletA, jurisdiction: "Bolivia" },
      { name: "Ouali Ventures (Wallet B)", wallet: accounts.walletB, jurisdiction: "Portugal" }
    ]
      .filter((p): p is Omit<Participant, "id" | "status"> => Boolean(p.wallet))
      .map((p) => ({ ...p, id: `participant-${p.wallet.slice(0, 8).toLowerCase()}`, status: "pending" }));

    const documents: DocumentRecord[] = [];
    const docCount = await this.chain.read<number>(this.cfg.registryContractId, "document_count", [scv.symbol(onChainId)]);
    for (let version = 1; version <= docCount; version++) {
      const doc = await this.chain.read<{ doc_hash: Uint8Array; uri: string }>(this.cfg.registryContractId, "get_document", [
        scv.symbol(onChainId),
        scv.u32(version)
      ]);
      documents.push({ id: `doc-${onChainId.toLowerCase()}-${version}`, name: `Documento v${version}`, kind: "Factura", hash: toHex(doc.doc_hash), url: doc.uri, version, createdAt: new Date().toISOString() });
    }

    const asset: Asset = {
      id: `asset-${onChainId.toLowerCase()}`,
      onChainId,
      name: "Factura Comercial 001",
      symbol: onChainId,
      type: "invoice",
      description: "Factura comercial de demostración registrada y emitida en Stellar Testnet por el script de seed.",
      issuer: "Andina Export SRL",
      custodian: "Assetra Demo Custody",
      jurisdiction: "Bolivia",
      totalValue: 100000,
      currency: "USDC",
      supply: 0,
      mintedSupply: 0,
      holderCount: 0,
      maturityDate: new Date(Number(data.due_date) * 1000).toISOString().slice(0, 10),
      status: "draft",
      contractId: data.token,
      documents,
      participants,
      activity: [],
      createdAt: new Date().toISOString()
    };
    await this.sync(asset);
    this.store.assets.unshift(asset);
    this.save();
  }

  // ------------------------------------------------------------------
  // AssetraClient
  // ------------------------------------------------------------------

  async listAssets(): Promise<Asset[]> {
    await this.ready;
    return clone(this.store.assets);
  }

  async getAsset(assetId: string): Promise<Asset> {
    await this.ready;
    const asset = this.find(assetId);
    try {
      await this.sync(asset);
      this.save();
    } catch (err) {
      console.warn(`Notice: could not sync ${assetId} from chain:`, err instanceof Error ? err.message : err);
    }
    return clone(asset);
  }

  async createAsset(input: CreateAssetInput): Promise<Asset> {
    await this.ready;
    const { txHash, onChainId, creatorWallet, ...metadata } = input;
    if (!onChainId || !creatorWallet) throw new ChainError("VALIDATION_ERROR", "onChainId y creatorWallet son obligatorios en modo live");
    if (this.store.assets.some((a) => a.onChainId === onChainId)) throw new ChainError("AssetAlreadyExists", "el activo ya está en el catálogo");

    const tx = await this.verify(txHash, {
      contract: this.cfg.registryContractId,
      fns: ["create_asset"],
      assetId: onChainId,
      signers: [creatorWallet]
    });

    const asset: Asset = {
      ...metadata,
      id: `asset-${onChainId.toLowerCase()}`,
      onChainId,
      symbol: onChainId,
      creatorWallet,
      status: "draft",
      mintedSupply: 0,
      holderCount: 0,
      documents: [],
      participants: [],
      activity: [],
      createdAt: tx.timestamp
    };
    await this.sync(asset);
    if (asset.creatorWallet !== creatorWallet) throw new ChainError("TX_MISMATCH", "el emisor on-chain no coincide");
    this.record(asset, "create", "Activo registrado on-chain y token desplegado", tx);

    this.store.assets.unshift(asset);
    this.save();
    return clone(asset);
  }

  async runLifecycleAction(assetId: string, input: LifecycleActionInput): Promise<Asset> {
    await this.ready;
    const asset = this.find(assetId);
    await this.sync(asset);
    const issuer = asset.creatorWallet!;
    const compliance = asset.complianceOfficer!;
    let tx: VerifiedTx;

    if (input.action === "mint") {
      tx = await this.verify(input.txHash, { contract: asset.contractId!, fns: ["mint"], signers: [issuer] });
    } else if (input.action === "burn") {
      tx = await this.verify(input.txHash, { contract: asset.contractId!, fns: ["burn"] });
      if (tx.args[0] !== tx.source) throw new ChainError("TX_MISMATCH", "el burn no corresponde al firmante");
    } else {
      const signers = input.action === "pause" ? [issuer, compliance, this.cfg.adminAddress] : [issuer, compliance];
      tx = await this.verify(input.txHash, {
        contract: this.cfg.registryContractId,
        fns: ["set_asset_status"],
        assetId: asset.onChainId,
        signers
      });
      if (tx.args[2] !== lifecycleStatusCode[input.action]) throw new ChainError("TX_MISMATCH", "el estado de la transacción no corresponde a la acción");
    }

    await this.sync(asset);
    const amount = tx.args[1];
    const labels: Record<string, string> = {
      activate: "Activo activado",
      mint: `Emisión de ${amount} ${asset.symbol}`,
      burn: `Quema de ${amount} ${asset.symbol}`,
      pause: "Activo pausado",
      unpause: "Activo reactivado",
      redeem: "Activo redimido"
    };
    this.record(asset, input.action, labels[input.action], tx);
    this.save();
    return clone(asset);
  }

  async transferTokens(assetId: string, input: TransferInput): Promise<TransferResult> {
    await this.ready;
    const asset = this.find(assetId);
    const tx = await this.verify(input.txHash, { contract: asset.contractId!, fns: ["transfer"], signers: [input.from] });
    const [from, to, amount] = tx.args as [string, string, bigint];

    await this.sync(asset);
    const receiver = asset.participants.find((p) => p.wallet === to);
    this.record(asset, "transfer", `Transferencia de ${amount} ${asset.symbol} a ${receiver?.name ?? short(to)}`, tx);
    this.save();
    return { txHash: tx.hash, status: "success", from, to, amount: Number(amount), timestamp: tx.timestamp };
  }

  async addParticipant(assetId: string, input: Omit<Participant, "id">, txHash?: string): Promise<Participant> {
    await this.ready;
    const asset = this.find(assetId);
    await this.sync(asset);
    const tx = await this.verify(txHash, {
      contract: this.cfg.registryContractId,
      fns: ["authorize_wallet"],
      assetId: asset.onChainId,
      signers: [asset.complianceOfficer!]
    });
    if (tx.args[2] !== input.wallet) throw new ChainError("TX_MISMATCH", "la wallet autorizada no coincide");

    let participant = asset.participants.find((p) => p.wallet === input.wallet);
    if (participant) {
      Object.assign(participant, { name: input.name, jurisdiction: input.jurisdiction });
    } else {
      participant = { ...input, id: `participant-${randomUUID()}` };
      asset.participants.push(participant);
    }
    participant.verifiedAt = tx.timestamp;

    await this.sync(asset);
    this.record(asset, "authorize", `${participant.name} autorizado por Compliance`, tx);
    this.save();
    return clone(participant);
  }

  async updateParticipantStatus(assetId: string, participantId: string, status: ParticipantStatus, txHash?: string): Promise<Participant> {
    await this.ready;
    const asset = this.find(assetId);
    const participant = asset.participants.find((p) => p.id === participantId);
    if (!participant) throw new Error("PARTICIPANT_NOT_FOUND");
    const fn = participantFns[status];
    if (!fn) throw new ChainError("VALIDATION_ERROR", "el estado 'pending' no existe on-chain");

    await this.sync(asset);
    const tx = await this.verify(txHash, {
      contract: this.cfg.registryContractId,
      fns: [fn],
      assetId: asset.onChainId,
      signers: [asset.complianceOfficer!]
    });
    if (tx.args[2] !== participant.wallet) throw new ChainError("TX_MISMATCH", "la wallet de la transacción no coincide");

    await this.sync(asset);
    if (status === "authorized") participant.verifiedAt = tx.timestamp;
    this.record(asset, status === "frozen" ? "freeze" : "authorize", `${participant.name} marcado como ${status.toUpperCase()} por Compliance`, tx);
    this.save();
    return clone(participant);
  }

  async addDocument(assetId: string, input: Omit<DocumentRecord, "id" | "createdAt">, txHash?: string): Promise<DocumentRecord> {
    await this.ready;
    const asset = this.find(assetId);
    await this.sync(asset);
    const tx = await this.verify(txHash, {
      contract: this.cfg.registryContractId,
      fns: ["add_document"],
      assetId: asset.onChainId,
      signers: [asset.creatorWallet!, asset.complianceOfficer!]
    });
    const hash = toHex(tx.args[2]);
    if (hash !== input.hash.toLowerCase()) throw new ChainError("TX_MISMATCH", "el hash registrado on-chain no coincide");

    const onChain = await this.chain.read<{ doc_hash: Uint8Array }>(this.cfg.registryContractId, "get_document", [
      scv.symbol(asset.onChainId!),
      scv.u32(input.version)
    ]);
    if (toHex(onChain.doc_hash) !== hash) throw new ChainError("TX_MISMATCH", "la versión del documento no coincide on-chain");

    const document: DocumentRecord = { ...input, hash, id: `doc-${randomUUID()}`, createdAt: tx.timestamp };
    asset.documents.push(document);
    this.record(asset, "document", `Documento "${document.name}" v${document.version} registrado`, tx);
    this.save();
    return clone(document);
  }
}
