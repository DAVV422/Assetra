// Cliente "live": cada operación la firma la wallet conectada (Freighter) directamente contra
// los contratos Soroban. Después se informa al backend el hash de la transacción confirmada,
// que el backend verifica on-chain antes de actualizar los metadatos del activo.
import { Address } from "@stellar/stellar-sdk";
import type {
  Asset,
  AssetType,
  CreateAssetInput,
  DocumentRecord,
  LifecycleActionInput,
  Participant,
  ParticipantStatus,
  TransferInput,
  TransferResult
} from "../types";
import type { AssetraClient } from "./assetra-client";
import { SorobanGateway, describeChainError, scv, sha256Hex, type ChainConfig } from "./soroban";

const statusCodes = { activate: 1, unpause: 1, pause: 2, redeem: 3 } as const;
const walletMethods: Partial<Record<ParticipantStatus, string>> = {
  authorized: "authorize_wallet",
  revoked: "revoke_wallet",
  frozen: "freeze_wallet"
};

/** Symbol de Soroban: solo [a-zA-Z0-9_]. */
const assetTypeSymbol = (type: AssetType) => type.replace(/-/g, "_");

export function toOnChainId(symbol: string): string {
  const id = symbol.trim().toUpperCase();
  if (!/^[A-Z0-9_]{2,12}$/.test(id)) {
    throw new Error("El símbolo solo puede contener letras, números y guion bajo (2 a 12 caracteres).");
  }
  return id;
}

function assertAddress(value: string, label: string): string {
  const clean = value.trim();
  try {
    new Address(clean);
  } catch {
    throw new Error(`${label} no es una dirección Stellar válida (G... o C...).`);
  }
  return clean;
}

export class ChainAssetraClient implements AssetraClient {
  private gatewayPromise?: Promise<SorobanGateway>;

  constructor(
    private readonly baseUrl: string,
    private readonly getWallet: () => string | null
  ) {}

  private async api<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers }
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.message ?? body.error ?? "No fue posible completar la operación");
    return body;
  }

  private gateway(): Promise<SorobanGateway> {
    this.gatewayPromise ??= this.api<ChainConfig>("/api/config").then((config) => new SorobanGateway(config));
    this.gatewayPromise.catch(() => (this.gatewayPromise = undefined));
    return this.gatewayPromise;
  }

  private requireWallet(): string {
    const wallet = this.getWallet();
    if (!wallet) throw new Error("Conecta tu wallet Freighter para firmar esta operación.");
    return wallet;
  }

  private onChainId(asset: Asset): string {
    if (!asset.onChainId || !asset.contractId) throw new Error("Este activo no está registrado on-chain.");
    return asset.onChainId;
  }

  listAssets(): Promise<Asset[]> {
    return this.api<Asset[]>("/api/assets");
  }

  getAsset(assetId: string): Promise<Asset> {
    return this.api<Asset>(`/api/assets/${encodeURIComponent(assetId)}`);
  }

  async createAsset(input: CreateAssetInput): Promise<Asset> {
    const wallet = this.requireWallet();
    const gw = await this.gateway();
    const registry = gw.config.registryContractId;
    const onChainId = toOnChainId(input.symbol);

    const approved = await gw.read<boolean>(registry, "is_approved_issuer", [scv.address(wallet)], "registry");
    if (!approved) throw describeChainError("Error(Contract, #7)", "registry");

    const metadata = { ...input, symbol: onChainId, creatorWallet: wallet };
    const assetKey = `asset-${onChainId.toLowerCase()}`;
    const dueDate = Math.floor(Date.parse(input.maturityDate) / 1000);
    if (!Number.isFinite(dueDate)) throw new Error("Fecha de vencimiento inválida.");

    const params = scv.struct({
      asset_type: scv.symbol(assetTypeSymbol(input.type)),
      metadata_uri: scv.string(`${this.baseUrl}/api/assets/${assetKey}`),
      // Huella de los metadatos declarados al crear el activo
      main_hash: scv.bytes32(await sha256Hex(JSON.stringify(metadata))),
      due_date: scv.u64(dueDate),
      name: scv.string(input.name),
      symbol: scv.string(onChainId),
      decimals: scv.u32(0),
      max_supply: scv.i128(input.supply)
    });

    // El emisor actúa también como oficial de compliance de su activo
    const { txHash } = await gw.invoke<string>(
      wallet,
      registry,
      "create_asset",
      [scv.symbol(onChainId), scv.address(wallet), scv.address(wallet), params],
      "registry"
    );

    return this.api<Asset>("/api/assets", {
      method: "POST",
      body: JSON.stringify({ ...metadata, onChainId, txHash })
    });
  }

  async runLifecycleAction(assetId: string, input: LifecycleActionInput): Promise<Asset> {
    const wallet = this.requireWallet();
    const gw = await this.gateway();
    const asset = await this.getAsset(assetId);
    const onChainId = this.onChainId(asset);
    const registry = gw.config.registryContractId;
    const amount = input.amount ?? 0;
    let txHash: string;

    if (input.action === "mint" || input.action === "burn") {
      if (!Number.isInteger(amount) || amount <= 0) throw new Error("El monto debe ser un entero mayor a 0.");

      if (input.action === "mint") {
        // El token solo emite hacia wallets autorizadas: el emisor-compliance se autoriza a sí mismo si hace falta
        const status = await gw.read<number>(registry, "wallet_status", [scv.symbol(onChainId), scv.address(wallet)], "registry");
        if (status !== 1) {
          if (asset.complianceOfficer !== wallet) {
            throw new Error("Tu wallet no está autorizada en la whitelist de este activo. Pide al oficial de compliance que la autorice.");
          }
          await gw.invoke(wallet, registry, "authorize_wallet", [scv.symbol(onChainId), scv.address(wallet), scv.address(wallet)], "registry");
        }
        ({ txHash } = await gw.invoke(wallet, asset.contractId!, "mint", [scv.address(wallet), scv.i128(amount)], "token"));
      } else {
        ({ txHash } = await gw.invoke(wallet, asset.contractId!, "burn", [scv.address(wallet), scv.i128(amount)], "token"));
      }
    } else {
      const code = statusCodes[input.action];
      ({ txHash } = await gw.invoke(
        wallet,
        registry,
        "set_asset_status",
        [scv.symbol(onChainId), scv.address(wallet), scv.u32(code)],
        "registry"
      ));
    }

    return this.api<Asset>(`/api/assets/${encodeURIComponent(assetId)}/actions`, {
      method: "POST",
      body: JSON.stringify({ ...input, txHash })
    });
  }

  async transferTokens(assetId: string, input: TransferInput): Promise<TransferResult> {
    const wallet = this.requireWallet();
    if (input.from.trim() !== wallet) throw new Error("Solo puedes transferir desde tu wallet conectada.");
    const to = assertAddress(input.to, "La dirección de destino");
    if (!Number.isInteger(input.amount) || input.amount <= 0) throw new Error("InvalidAmount: El monto debe ser un entero mayor a 0.");

    const gw = await this.gateway();
    const asset = await this.getAsset(assetId);
    this.onChainId(asset);
    const { txHash } = await gw.invoke(
      wallet,
      asset.contractId!,
      "transfer",
      [scv.address(wallet), scv.address(to), scv.i128(input.amount)],
      "token"
    );

    return this.api<TransferResult>(`/api/assets/${encodeURIComponent(assetId)}/transfers`, {
      method: "POST",
      body: JSON.stringify({ from: wallet, to, amount: input.amount, txHash })
    });
  }

  async addParticipant(assetId: string, participant: Omit<Participant, "id">): Promise<Participant> {
    const wallet = this.requireWallet();
    const target = assertAddress(participant.wallet, "La wallet del participante");
    const gw = await this.gateway();
    const asset = await this.getAsset(assetId);
    const onChainId = this.onChainId(asset);

    // En la cadena no existe "pendiente": registrar un participante es autorizarlo en la whitelist
    const { txHash } = await gw.invoke(
      wallet,
      gw.config.registryContractId,
      "authorize_wallet",
      [scv.symbol(onChainId), scv.address(wallet), scv.address(target)],
      "registry"
    );

    return this.api<Participant>(`/api/assets/${encodeURIComponent(assetId)}/participants`, {
      method: "POST",
      body: JSON.stringify({ ...participant, wallet: target, status: "authorized", txHash })
    });
  }

  async updateParticipantStatus(assetId: string, participantId: string, status: ParticipantStatus): Promise<Participant> {
    const method = walletMethods[status];
    if (!method) throw new Error("El estado 'pendiente' no existe on-chain.");
    const wallet = this.requireWallet();
    const gw = await this.gateway();
    const asset = await this.getAsset(assetId);
    const onChainId = this.onChainId(asset);
    const participant = asset.participants.find((p) => p.id === participantId);
    if (!participant) throw new Error("Participante no encontrado");

    const { txHash } = await gw.invoke(
      wallet,
      gw.config.registryContractId,
      method,
      [scv.symbol(onChainId), scv.address(wallet), scv.address(participant.wallet)],
      "registry"
    );

    return this.api<Participant>(`/api/assets/${encodeURIComponent(assetId)}/participants/${encodeURIComponent(participantId)}`, {
      method: "PATCH",
      body: JSON.stringify({ status, txHash })
    });
  }

  async addDocument(assetId: string, document: Omit<DocumentRecord, "id" | "createdAt">): Promise<DocumentRecord> {
    const wallet = this.requireWallet();
    const gw = await this.gateway();
    const asset = await this.getAsset(assetId);
    const onChainId = this.onChainId(asset);
    const hash = document.hash.trim().toLowerCase();

    const { txHash, result: version } = await gw.invoke<number>(
      wallet,
      gw.config.registryContractId,
      "add_document",
      [scv.symbol(onChainId), scv.address(wallet), scv.bytes32(hash), scv.string(document.url ?? "")],
      "registry"
    );

    return this.api<DocumentRecord>(`/api/assets/${encodeURIComponent(assetId)}/documents`, {
      method: "POST",
      body: JSON.stringify({ ...document, hash, version: Number(version), txHash })
    });
  }
}
