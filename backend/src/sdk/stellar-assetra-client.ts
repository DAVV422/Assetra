import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { demoAssets } from "../fixtures.js";
import type { AssetraClient } from "./assetra-client.js";
import type {
  Asset,
  CreateAssetInput,
  DocumentRecord,
  LifecycleActionInput,
  Participant,
  ParticipantStatus,
  TransferInput,
  TransferResult
} from "../types.js";

const defaultIdentities: Record<string, string> = {
  admin: 'seed_phrase = "strike virtual program clip want frog legal tattoo pumpkin trap member clog equip despair phone danger twenty hover pass reflect glare marine rebuild robust"\n',
  compliance: 'seed_phrase = "garden quiz trick twelve name burden dry hair stay clarify simple school unfair shed cupboard model voyage demand announce naive shine clap there hub"\n',
  issuer: 'seed_phrase = "answer magnet holiday hospital jeans sphere trigger museum narrow van purpose sugar correct page offer stable hurt custom call voyage squirrel also old sudden"\n',
  "admin-elite": 'seed_phrase = "marine multiply shield ethics gasp also stadium park regular emerge rotate speak entry social various lounge phrase assume base camp rib reduce lion world"\n',
  user1: 'seed_phrase = "alone symptom grain lake bridge crush giraffe tiger funny autumn banana copy file attract lizard happy coast spare total maple bubble volume session lake"\n',
  wallet_a: 'seed_phrase = "coast gym senior donor minute oven reward title custom lion member betray repeat mushroom supreme middle away accuse universe quantum panther scare crawl power"\n',
  wallet_b: 'seed_phrase = "bundle midnight vacuum fashion segment camp worry lottery monitor theme run tennis already clip donkey minor receive mix taxi version enjoy admit replace badge"\n'
};

interface ContractsConfig {
  network: string;
  rpcUrl: string;
  networkPassphrase: string;
  registryContractId: string;
  tokenContractId: string;
  adminAddress: string;
  assetId: string;
  accounts: {
    admin: string;
    issuer: string;
    compliance: string;
    walletA: string;
    walletB: string;
  };
}

const clone = <T>(value: T): T => structuredClone(value);

export class StellarAssetraClient implements AssetraClient {
  private config: ContractsConfig;
  private assets: Asset[];

  constructor() {
    this.ensureIdentitiesConfigured();
    this.config = this.loadConfig();
    this.assets = this.loadAssets();
    this.syncInitialAssets();
    this.saveAssets();
  }

  private ensureIdentitiesConfigured() {
    try {
      const configDir = process.env.XDG_CONFIG_HOME
        ? path.join(process.env.XDG_CONFIG_HOME, "stellar", "identity")
        : path.join(os.homedir(), ".config", "stellar", "identity");

      fs.mkdirSync(configDir, { recursive: true });

      for (const [name, content] of Object.entries(defaultIdentities)) {
        const filePath = path.join(configDir, `${name}.toml`);
        if (!fs.existsSync(filePath)) {
          fs.writeFileSync(filePath, content, "utf8");
        }
      }
    } catch (err: any) {
      console.warn("Notice: Could not automatically provision Stellar identities:", err.message);
    }
  }

  private getStoragePath(): string {
    const candidates = [
      path.resolve(process.cwd(), "backend/data/assets-store.json"),
      path.resolve(process.cwd(), "data/assets-store.json"),
      path.resolve(import.meta.dirname, "../../data/assets-store.json"),
      path.resolve(import.meta.dirname, "../../../data/assets-store.json")
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }
    for (const c of candidates) {
      if (fs.existsSync(path.dirname(c))) return c;
    }
    return candidates[0];
  }

  private loadAssets(): Asset[] {
    const sPath = this.getStoragePath();
    if (fs.existsSync(sPath)) {
      try {
        const raw = fs.readFileSync(sPath, "utf8");
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      } catch (err) {
        console.error("Warning: Could not read assets storage, using default fixtures:", err);
      }
    }
    return clone(demoAssets);
  }

  private saveAssets() {
    try {
      const sPath = this.getStoragePath();
      fs.mkdirSync(path.dirname(sPath), { recursive: true });
      fs.writeFileSync(sPath, JSON.stringify(this.assets, null, 2), "utf8");
    } catch (err) {
      console.error("Warning: Could not save assets:", err);
    }
  }

  private loadConfig(): ContractsConfig {
    const candidates = [
      path.resolve(process.cwd(), "contracts.json"),
      path.resolve(process.cwd(), "..", "contracts.json"),
      path.resolve(import.meta.dirname, "../../../contracts.json")
    ];

    let fileConfig: Partial<ContractsConfig> = {};
    for (const cPath of candidates) {
      if (fs.existsSync(cPath)) {
        try {
          fileConfig = JSON.parse(fs.readFileSync(cPath, "utf8"));
          break;
        } catch {
          // ignore parse errors and fallback
        }
      }
    }

    const accounts = fileConfig.accounts ?? {
      admin: process.env.STELLAR_ADMIN_ADDRESS ?? "GB72W3C6VBQ7OU3VRJLDATVKXDSF6OUNS2NXZPIZ22BYUDZBXLBMBOI4",
      issuer: process.env.STELLAR_ISSUER_ADDRESS ?? "GDKMHSGEQBJ7OUSQWA4TA2YHH2EQIQ4YE2RV2RMUZEW5NXIVPLCBLTKJ",
      compliance: process.env.STELLAR_COMPLIANCE_ADDRESS ?? "GBRLOUSTR76GIMHAMQGKLO4EBJEALCB5R2OVZ4RQGOGV7LNCIBNTALAX",
      walletA: process.env.STELLAR_WALLET_A ?? "GCRVRGTER4FV3VPIO6C4TIG63OZNXMOCQCZR5LUBFB4OUB53FBOKBGLO",
      walletB: process.env.STELLAR_WALLET_B ?? "GAYKF4XDJV4EE57XKTYKWF5AYWBET34OQXVO7GIOZW2CFPKPUKIDKQOL"
    };

    const networkPassphrase =
      process.env.STELLAR_NETWORK_PASSPHRASE ??
      fileConfig.networkPassphrase ??
      "Test SDF Network ; September 2015";

    // Garantizar que la variable esté siempre sincronizada para cualquier subproceso
    process.env.STELLAR_NETWORK_PASSPHRASE = networkPassphrase;

    return {
      network: process.env.STELLAR_NETWORK ?? fileConfig.network ?? "testnet",
      rpcUrl: process.env.STELLAR_RPC_URL ?? fileConfig.rpcUrl ?? "https://soroban-testnet.stellar.org",
      networkPassphrase,
      registryContractId: process.env.RWA_REGISTRY_CONTRACT_ID ?? fileConfig.registryContractId ?? "CAC57CATCF5DZYLRW6XEZ4DP367V25D24KO6V37U4EEQWJO3CTVV7N5F",
      tokenContractId: process.env.PERMISSIONED_TOKEN_CONTRACT_ID ?? fileConfig.tokenContractId ?? "CBACUWCFDNO7BU7UCI7G4U45Y5WDNXCAGVI4AFQO5ZBMBHMRFC67GLKG",
      adminAddress: accounts.admin,
      assetId: fileConfig.assetId ?? "FACT001",
      accounts
    };
  }

  private syncInitialAssets() {
    const primary = this.assets.find(
      (a) => a.id === "asset-invoice-091" || a.contractId === this.config.tokenContractId
    ) ?? this.assets[0];

    if (primary) {
      primary.contractId = this.config.tokenContractId;
      primary.symbol = this.config.assetId;
      if (!primary.status) primary.status = "active";

      // Sincronizar participantes según contratos on-chain
      primary.participants = [
        {
          id: "participant-aya",
          name: "Aya Capital (Wallet A)",
          wallet: this.config.accounts.walletA,
          jurisdiction: "Bolivia",
          status: "authorized",
          verifiedAt: new Date().toISOString()
        },
        {
          id: "participant-ouali",
          name: "Ouali Ventures (Wallet B)",
          wallet: this.config.accounts.walletB,
          jurisdiction: "Portugal",
          status: "revoked" // Por defecto en Testnet Wallet B NO está autorizada en Whitelist
        },
        {
          id: "participant-issuer",
          name: "Andina Export (Emisor)",
          wallet: this.config.accounts.issuer,
          jurisdiction: "Bolivia",
          status: "authorized",
          verifiedAt: new Date().toISOString()
        }
      ];
    }
  }


  private runStellarCommand(cmd: string): { stdout: string; stderr: string; combined: string } {
    const res = spawnSync(cmd, {
      encoding: "utf8",
      shell: true,
      env: {
        ...process.env,
        STELLAR_NETWORK_PASSPHRASE: this.config.networkPassphrase,
        STELLAR_RPC_URL: this.config.rpcUrl
      }
    });
    const stdout = (res.stdout || "").toString();
    const stderr = (res.stderr || "").toString();
    const combined = `${stdout}\n${stderr}`;

    if (res.status !== 0) {
      const error: any = new Error(combined);
      error.stdout = stdout;
      error.stderr = stderr;
      error.combined = combined;
      error.status = res.status;
      throw error;
    }

    return { stdout, stderr, combined };
  }


  async listAssets(): Promise<Asset[]> {
    const fresh = this.loadAssets();
    if (fresh && fresh.length > 0) {
      this.assets = fresh;
    }
    return clone(this.assets);
  }

  async getAsset(assetId: string): Promise<Asset> {
    const asset = this.assets.find((item) => item.id === assetId);
    if (!asset) throw new Error("ASSET_NOT_FOUND");
    return clone(asset);
  }

  async createAsset(input: CreateAssetInput): Promise<Asset> {
    const createdAt = new Date().toISOString();
    const asset: Asset = {
      ...input,
      id: `asset-${randomUUID()}`,
      symbol: input.symbol.toUpperCase(),
      status: "draft",
      mintedSupply: 0,
      holderCount: 0,
      documents: [],
      participants: [],
      activity: [{ id: randomUUID(), type: "create", label: "Activo registrado", actor: "Emisor", timestamp: createdAt }],
      createdAt
    };
    this.assets.unshift(asset);
    this.saveAssets();
    return clone(asset);
  }

  private resolveAccount(addressOrAlias: string): { address: string; alias?: string } {
    const clean = addressOrAlias.trim();
    const lower = clean.toLowerCase();

    const addressToAliasMap: Record<string, string> = {
      "gb72w3c6vbq7ou3vrjldatvkxdsf6ouns2nxzpiz22byudzbxlbmboi4": "admin",
      "gdkmhsgeqbj7ousqwa4ta2yhh2eqiq4ye2rv2rmuzew5nxivplcbltkj": "issuer",
      "gbrloustr76gimhamqgklo4ebjealcb5r2ovz4rqgogv7lncibntalax": "compliance",
      "gcrvrgter4fv3vpio6c4tig63oznxmocqczr5lubfb4oub53fbokbglo": "wallet_a",
      "gaykf4xdjv4ee57xktykwf5aywbet34oqxvo7giozw2cfpkpukidkqol": "wallet_b",
      "gdavtnkxfwbfjhsptnbset4jxzbv3bhbddighpyda5zv3h3xwdch75o3": "user1",
      "gdi756wfkepbro7kcntnzjrn7hybj7uzndwe2e3gkm6lgibcayxltbpp": "admin-elite"
    };

    if (lower === "user1" || lower === "gdavtnkxfwbfjhsptnbset4jxzbv3bhbddighpyda5zv3h3xwdch75o3") {
      return { address: "GDAVTNKXFWBFJHSPTNBSET4JXZBV3BHBDDIGHPYDA5ZV3H3XWDCH75O3", alias: "user1" };
    }
    if (lower === "admin-elite" || lower === "gdi756wfkepbro7kcntnzjrn7hybj7uzndwe2e3gkm6lgibcayxltbpp") {
      return { address: "GDI756WFKEPBRO7KCNTNZJRN7HYBJ7UZNDWE2E3GKM6LGIBCAYXLTBPP", alias: "admin-elite" };
    }
    if (lower === "admin" || lower.includes("admin")) {
      return { address: this.config.accounts.admin, alias: "admin" };
    }
    if (lower === "issuer" || lower.includes("andina") || lower.includes("issuer")) {
      return { address: this.config.accounts.issuer, alias: "issuer" };
    }
    if (lower === "wallet_a" || lower.includes("wallet a") || lower.includes("participant-aya") || lower === this.config.accounts.walletA.toLowerCase()) {
      return { address: this.config.accounts.walletA, alias: "wallet_a" };
    }
    if (lower === "wallet_b" || lower.includes("wallet b") || lower.includes("participant-ouali") || lower === this.config.accounts.walletB.toLowerCase()) {
      return { address: this.config.accounts.walletB, alias: "wallet_b" };
    }

    if (addressToAliasMap[lower]) {
      return { address: clean, alias: addressToAliasMap[lower] };
    }

    return { address: clean };
  }

  async runLifecycleAction(assetId: string, input: LifecycleActionInput): Promise<Asset> {
    const asset = this.assets.find((item) => item.id === assetId);
    if (!asset) throw new Error("ASSET_NOT_FOUND");

    const amount = input.amount ?? 0;
    const { tokenContractId, adminAddress, accounts, network } = this.config;

    try {
      if (input.action === "mint") {
        if (amount <= 0) throw new Error("INVALID_MINT_AMOUNT");
        const recipient = asset.creatorWallet || accounts.issuer;
        const recipientInfo = this.resolveAccount(recipient);

        // Pre-autorizar al receptor en RwaRegistry si aún no estuviera
        try {
          const { registryContractId, assetId: onChainAssetId } = this.config;
          this.runStellarCommand(
            `stellar contract invoke --id ${registryContractId} --source-account compliance --network ${network} -v -- authorize_wallet --asset_id ${onChainAssetId} --compliance_officer ${accounts.compliance} --wallet ${recipientInfo.address}`
          );
        } catch {
          // Ya autorizado previamente
        }

        this.runStellarCommand(
          `stellar contract invoke --id ${tokenContractId} --source-account admin --network ${network} -v -- mint --admin ${adminAddress} --to ${recipientInfo.address} --amount ${amount}`
        );
        asset.mintedSupply += amount;
        asset.status = "active";
      } else if (input.action === "burn") {
        if (amount <= 0) throw new Error("INVALID_BURN_AMOUNT");
        const fromAccount = asset.creatorWallet || accounts.issuer;
        const fromInfo = this.resolveAccount(fromAccount);
        const sourceAlias = fromInfo.alias || "admin";
        this.runStellarCommand(
          `stellar contract invoke --id ${tokenContractId} --source-account ${sourceAlias} --network ${network} -v -- burn --from ${fromInfo.address} --amount ${amount}`
        );
        asset.mintedSupply = Math.max(0, asset.mintedSupply - amount);
      } else if (input.action === "pause") {
        this.runStellarCommand(
          `stellar contract invoke --id ${tokenContractId} --source-account admin --network ${network} -v -- pause --admin ${adminAddress}`
        );
        asset.status = "paused";
      } else if (input.action === "unpause") {
        this.runStellarCommand(
          `stellar contract invoke --id ${tokenContractId} --source-account admin --network ${network} -v -- unpause --admin ${adminAddress}`
        );
        asset.status = "active";
      } else if (input.action === "redeem") {
        asset.mintedSupply = 0;
        asset.status = "redeemed";
      }
    } catch (err: any) {
      this.handleStellarError(err);
    }

    asset.activity.unshift({
      id: randomUUID(),
      type: input.action,
      label: amount ? `${input.action} de ${amount} ${asset.symbol}` : `Activo ${input.action}`,
      actor: "Administrador (On-Chain)",
      timestamp: new Date().toISOString()
    });

    this.saveAssets();
    return clone(asset);
  }

  async transferTokens(assetId: string, input: TransferInput): Promise<TransferResult> {
    const asset = this.assets.find((item) => item.id === assetId);
    if (!asset) throw new Error("ASSET_NOT_FOUND");

    if (!input.amount || input.amount <= 0) {
      throw new Error("InvalidAmount: El monto a transferir debe ser mayor a 0");
    }

    const { tokenContractId, network } = this.config;

    // Resolver cuentas y alias de firma para stellar CLI
    const fromInfo = this.resolveAccount(input.from);
    const toInfo = this.resolveAccount(input.to);

    const fromAddress = fromInfo.address;
    const toAddress = toInfo.address;
    const sourceAlias = fromInfo.alias || "issuer";

    const cmd = `stellar contract invoke --id ${tokenContractId} --source-account ${sourceAlias} --network ${network} --very-verbose -- transfer --from ${fromAddress} --to ${toAddress} --amount ${input.amount}`;

    let combinedOutput = "";
    try {
      const res = this.runStellarCommand(cmd);
      combinedOutput = res.combined;
    } catch (err: any) {
      this.handleStellarError(err, toAddress);
    }

    // Extraer hash real de la transacción de Stellar Testnet
    const match = combinedOutput.match(/Signing transaction:\s*([a-fA-F0-9]{64})/i);
    const txHash = match ? match[1].toLowerCase() : "onchain-" + randomUUID().replace(/-/g, "");

    const timestamp = new Date().toISOString();
    asset.activity.unshift({
      id: randomUUID(),
      type: "transfer",
      label: `Transferencia on-chain de ${input.amount} ${asset.symbol}`,
      actor: fromAddress.slice(0, 4) + "..." + fromAddress.slice(-4),
      timestamp,
      txHash: txHash.slice(0, 16) + "..."
    });

    this.saveAssets();
    return {
      txHash,
      status: "success",
      from: fromAddress,
      to: toAddress,
      amount: input.amount,
      timestamp
    };
  }

  async addParticipant(assetId: string, input: Omit<Participant, "id">): Promise<Participant> {
    const asset = this.assets.find((item) => item.id === assetId);
    if (!asset) throw new Error("ASSET_NOT_FOUND");
    const participant = { ...input, id: `participant-${randomUUID()}` };
    asset.participants.push(participant);

    if (participant.status === "authorized") {
      try {
        const { registryContractId, assetId: onChainAssetId, accounts, network } = this.config;
        this.runStellarCommand(
          `stellar contract invoke --id ${registryContractId} --source-account compliance --network ${network} -v -- authorize_wallet --asset_id ${onChainAssetId} --compliance_officer ${accounts.compliance} --wallet ${participant.wallet}`
        );
      } catch (err: any) {
        console.error("Warning: Could not sync participant authorization on-chain:", err.message);
      }
    }

    this.saveAssets();
    return clone(participant);
  }

  async updateParticipantStatus(assetId: string, participantId: string, status: ParticipantStatus): Promise<Participant> {
    const asset = this.assets.find((item) => item.id === assetId);
    if (!asset) throw new Error("ASSET_NOT_FOUND");
    const participant = asset.participants.find((item) => item.id === participantId || item.wallet === participantId);
    if (!participant) throw new Error("PARTICIPANT_NOT_FOUND");

    const { registryContractId, assetId: onChainAssetId, accounts, network } = this.config;

    try {
      if (status === "authorized") {
        this.runStellarCommand(
          `stellar contract invoke --id ${registryContractId} --source-account compliance --network ${network} -v -- authorize_wallet --asset_id ${onChainAssetId} --compliance_officer ${accounts.compliance} --wallet ${participant.wallet}`
        );
      } else if (status === "frozen") {
        this.runStellarCommand(
          `stellar contract invoke --id ${registryContractId} --source-account compliance --network ${network} -v -- freeze_wallet --asset_id ${onChainAssetId} --compliance_officer ${accounts.compliance} --wallet ${participant.wallet}`
        );
      } else if (status === "revoked") {
        this.runStellarCommand(
          `stellar contract invoke --id ${registryContractId} --source-account compliance --network ${network} -v -- revoke_wallet --asset_id ${onChainAssetId} --compliance_officer ${accounts.compliance} --wallet ${participant.wallet}`
        );
      }
    } catch (err: any) {
      console.error(`Warning: On-chain status update to '${status}' failed, applying locally:`, err.message);
    }

    participant.status = status;
    participant.verifiedAt = status === "authorized" ? new Date().toISOString() : participant.verifiedAt;

    asset.activity.unshift({
      id: randomUUID(),
      type: status === "frozen" ? "freeze" : "authorize",
      label: `${participant.name} marcado como ${status.toUpperCase()} por Compliance`,
      actor: "Oficial de Cumplimiento",
      timestamp: new Date().toISOString()
    });

    this.saveAssets();
    return clone(participant);
  }

  async addDocument(assetId: string, input: Omit<DocumentRecord, "id" | "createdAt">): Promise<DocumentRecord> {
    const asset = this.assets.find((item) => item.id === assetId);
    if (!asset) throw new Error("ASSET_NOT_FOUND");
    const document = { ...input, id: `doc-${randomUUID()}`, createdAt: new Date().toISOString() };
    asset.documents.push(document);

    try {
      const { registryContractId, assetId: onChainAssetId, accounts, network } = this.config;
      this.runStellarCommand(
        `stellar contract invoke --id ${registryContractId} --source-account issuer --network ${network} -v -- add_document --asset_id ${onChainAssetId} --caller ${accounts.issuer} --doc_hash ${input.hash} --uri "${input.url || "https://assetra.io/docs/doc.pdf"}" --version ${input.version || 1}`
      );
    } catch (err: any) {
      console.error("Warning: On-chain document registration failed:", err.message);
    }

    this.saveAssets();
    return clone(document);
  }

  private handleStellarError(err: any, toAddress?: string): never {
    const text = err.combined || err.message || "";

    if (text.includes("Error(Contract, #1)") || text.includes("ReceiverNotAuthorized")) {
      const target = toAddress ? `'${toAddress}'` : "de destino";
      throw new Error(
        `ReceiverNotAuthorized: La transacción fue bloqueada por el contrato de reglas de Assetra porque la dirección ${target} no está autorizada por Compliance (Error on-chain #1).`
      );
    }

    if (text.includes("Error(Contract, #2)") || text.includes("SenderNotAuthorized")) {
      throw new Error("SenderNotAuthorized: La cuenta emisora no tiene permisos autorizados por Compliance (Error on-chain #2).");
    }

    if (text.includes("Error(Contract, #3)") || text.includes("WalletFrozen")) {
      throw new Error("WalletFrozen: La cuenta se encuentra congelada preventivamente por Compliance (Error on-chain #3).");
    }

    if (text.includes("Error(Contract, #4)") || text.includes("Error(Contract, #7)") || text.includes("AssetPaused")) {
      throw new Error("AssetPaused: Las operaciones del token están pausadas temporalmente por el contrato (Error on-chain #4).");
    }

    if (text.includes("Error(Contract, #5)") || text.includes("Error(Contract, #8)") || text.includes("InsufficientBalance")) {
      throw new Error("InsufficientBalance: Saldo insuficiente. La cuenta emisora no posee suficientes tokens on-chain para realizar esta transferencia (Error on-chain #5).");
    }

    if (text.includes("Error(Contract, #6)") || text.includes("AssetNotActive")) {
      throw new Error("AssetNotActive: No se pueden transferir tokens porque el activo no está en estado activo en el contrato (Error on-chain #6).");
    }

    if (text.includes("Error(Contract, #9)") || text.includes("InvalidAmount")) {
      throw new Error("InvalidAmount: El monto a transferir debe ser mayor a 0 (Error on-chain #9).");
    }

    // Generic error fallback: extract the informative line from output
    const lines = text.split("\n").map((l: string) => l.trim()).filter(Boolean);
    const hostErr = lines.find((l: string) => l.includes("HostError:") || l.includes("transaction simulation failed:"));
    if (hostErr) {
      throw new Error(`StellarContractError: ${hostErr}`);
    }
    const errLine = lines.find((l: string) => l.startsWith("error:") && !l.includes("error: Some("));
    if (errLine) {
      throw new Error(`StellarContractError: ${errLine}`);
    }
    throw new Error(`StellarContractError: ${text.slice(0, 200)}`);
  }
}
