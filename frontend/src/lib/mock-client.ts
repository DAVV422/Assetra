import { demoAssets } from "../data";
import { cacheCustomAssetLocally, getCachedCustomAssets, mergeWithCachedAssets } from "./http-client";
import type {
  Asset,
  CreateAssetInput,
  DocumentRecord,
  LifecycleActionInput,
  Participant,
  ParticipantStatus,
  TransferInput,
  TransferResult
} from "../types";
import type { AssetraClient } from "./assetra-client";

const clone = <T,>(value: T): T => structuredClone(value);
const id = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;

export class MockAssetraClient implements AssetraClient {
  private assets: Asset[];

  constructor() {
    this.assets = this.loadAssets();
  }

  private loadAssets(): Asset[] {
    let list: Asset[] = clone(demoAssets);
    if (typeof window !== "undefined" && window.localStorage) {
      try {
        const stored = window.localStorage.getItem("assetra_mock_assets");
        if (stored) {
          const parsed = JSON.parse(stored);
          if (Array.isArray(parsed) && parsed.length > 0) list = parsed;
        }
      } catch {
        // fallback to default
      }
    }
    return mergeWithCachedAssets(list);
  }

  private saveAssets() {
    if (typeof window !== "undefined" && window.localStorage) {
      try {
        window.localStorage.setItem("assetra_mock_assets", JSON.stringify(this.assets));
      } catch {
        // fallback
      }
    }
  }

  private wait() { return new Promise((resolve) => setTimeout(resolve, 180)); }

  async listAssets() {
    await this.wait();
    return clone(this.assets);
  }

  async getAsset(assetId: string) {
    await this.wait();
    const asset = this.assets.find((item) => item.id === assetId);
    if (!asset) throw new Error("Activo no encontrado");
    return clone(asset);
  }

  async createAsset(input: CreateAssetInput) {
    await this.wait();
    const createdAt = new Date().toISOString();
    const asset: Asset = {
      ...input,
      id: id("asset"),
      symbol: input.symbol.toUpperCase(),
      mintedSupply: 0,
      holderCount: 0,
      status: "draft",
      documents: [],
      participants: [],
      activity: [
        {
          id: id("evt"),
          type: "create",
          label: "Activo registrado en estado Borrador",
          actor: "Emisor",
          timestamp: createdAt
        }
      ],
      createdAt
    };
    this.assets.unshift(asset);
    this.saveAssets();
    cacheCustomAssetLocally(asset);
    return clone(asset);
  }

  async runLifecycleAction(assetId: string, input: LifecycleActionInput) {
    await this.wait();
    const asset = this.assets.find((item) => item.id === assetId);
    if (!asset) throw new Error("Activo no encontrado");
    const amount = input.amount ?? 0;

    if (input.action === "mint") {
      if (asset.status !== "active") {
        throw new Error("AssetNotActive: No se pueden emitir tokens mientras el activo esté en estado '" + asset.status + "'");
      }
      if (!amount || amount <= 0) {
        throw new Error("El monto a emitir debe ser mayor a 0");
      }
      if (asset.mintedSupply + amount > asset.supply) {
        throw new Error("No puedes emitir más del suministro total configurado (" + asset.supply + " " + asset.symbol + ")");
      }
      asset.mintedSupply += amount;
      asset.holderCount = Math.max(1, asset.holderCount);
    }

    if (input.action === "burn") {
      if (asset.status !== "active") {
        throw new Error("AssetNotActive: No se pueden quemar tokens mientras el activo esté en estado '" + asset.status + "'");
      }
      if (!amount || amount <= 0) {
        throw new Error("El monto a quemar debe ser mayor a 0");
      }
      if (amount > asset.mintedSupply) {
        throw new Error("No puedes quemar más del saldo actualmente emitido (" + asset.mintedSupply + " " + asset.symbol + ")");
      }
      asset.mintedSupply -= amount;
    }

    if (input.action === "pause") {
      if (asset.status !== "active") {
        throw new Error("Solo activos en estado Activo pueden ser pausados");
      }
      asset.status = "paused";
    }

    if (input.action === "unpause") {
      if (asset.status !== "paused") {
        throw new Error("Solo activos pausados pueden ser reactivados");
      }
      asset.status = "active";
    }

    if (input.action === "redeem") {
      if (asset.status !== "active" && asset.status !== "paused") {
        throw new Error("El activo no se encuentra en condiciones de ser redimido");
      }
      asset.status = "redeemed";
      asset.mintedSupply = 0;
    }

    const actionLabels: Record<string, string> = {
      mint: `Emisión de ${amount} ${asset.symbol}`,
      burn: `Quema de ${amount} ${asset.symbol}`,
      pause: "Activo pausado por el emisor",
      unpause: "Activo reactivado",
      redeem: "Liquidación y redención final del activo"
    };

    asset.activity.unshift({
      id: id("evt"),
      type: input.action,
      label: actionLabels[input.action] ?? `Acción ${input.action}`,
      actor: "Administrador",
      timestamp: new Date().toISOString()
    });

    this.saveAssets();
    cacheCustomAssetLocally(asset);
    return clone(asset);
  }

  async transferTokens(assetId: string, input: TransferInput): Promise<TransferResult> {
    await this.wait();
    const asset = this.assets.find((item) => item.id === assetId);
    if (!asset) throw new Error("Activo no encontrado");

    if (asset.status !== "active") {
      throw new Error(`AssetNotActive: No se pueden transferir tokens porque el activo está en estado '${asset.status}'`);
    }

    if (!input.amount || input.amount <= 0) {
      throw new Error("InvalidAmount: El monto a transferir debe ser mayor a 0");
    }

    if (input.amount > asset.mintedSupply) {
      throw new Error("InsufficientBalance: El saldo disponible del emisor es insuficiente para esta transferencia");
    }

    // Regla de Oro de Compliance de Assetra:
    const targetParticipant = asset.participants.find(
      (p) => p.wallet.toLowerCase() === input.to.toLowerCase() || p.id === input.to
    );

    if (!targetParticipant || targetParticipant.status !== "authorized") {
      const statusNote = targetParticipant ? `(estado actual: '${targetParticipant.status.toUpperCase()}')` : "(no registrada en Whitelist)";
      throw new Error(`ReceiverNotAuthorized: La transacción fue bloqueada por el contrato de reglas de Assetra porque la dirección de destino '${input.to}' no está autorizada por Compliance ${statusNote}.`);
    }

    const senderParticipant = asset.participants.find(
      (p) => p.wallet.toLowerCase() === input.from.toLowerCase() || p.id === input.from
    );

    if (senderParticipant && senderParticipant.status === "frozen") {
      throw new Error("WalletFrozen: La cuenta emisora se encuentra congelada cautelarmente por Compliance");
    }
    if (senderParticipant && senderParticipant.status === "revoked") {
      throw new Error("SenderNotAuthorized: La autorización de la cuenta emisora fue revocada por Compliance");
    }

    const txHash = Array.from(crypto.getRandomValues(new Uint8Array(32)))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const timestamp = new Date().toISOString();

    asset.activity.unshift({
      id: id("evt"),
      type: "transfer",
      label: `Transferencia de ${input.amount} ${asset.symbol} a ${targetParticipant.name}`,
      actor: input.from.length > 10 ? input.from.slice(0, 4) + "..." + input.from.slice(-4) : input.from,
      timestamp,
      txHash: txHash.slice(0, 16) + "..."
    });

    this.saveAssets();
    cacheCustomAssetLocally(asset);
    return {
      txHash,
      status: "success",
      from: input.from,
      to: targetParticipant.wallet,
      amount: input.amount,
      timestamp
    };
  }

  async addParticipant(assetId: string, input: Omit<Participant, "id">) {
    const asset = this.assets.find((item) => item.id === assetId);
    if (!asset) throw new Error("Activo no encontrado");
    const participant = { ...input, id: id("participant") };
    asset.participants.push(participant);
    this.saveAssets();
    cacheCustomAssetLocally(asset);
    return clone(participant);
  }

  async updateParticipantStatus(assetId: string, participantId: string, status: ParticipantStatus) {
    const asset = this.assets.find((item) => item.id === assetId);
    const participant = asset?.participants.find((item) => item.id === participantId);
    if (!participant) throw new Error("Participante no encontrado");
    participant.status = status;
    participant.verifiedAt = status === "authorized" ? new Date().toISOString() : participant.verifiedAt;
    this.saveAssets();
    if (asset) cacheCustomAssetLocally(asset);
    return clone(participant);
  }

  async addDocument(assetId: string, input: Omit<DocumentRecord, "id" | "createdAt">) {
    const asset = this.assets.find((item) => item.id === assetId);
    if (!asset) throw new Error("Activo no encontrado");
    const document = { ...input, id: id("doc"), createdAt: new Date().toISOString() };
    asset.documents.push(document);
    this.saveAssets();
    cacheCustomAssetLocally(asset);
    return clone(document);
  }
}
