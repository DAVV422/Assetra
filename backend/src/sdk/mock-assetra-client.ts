import fs from "node:fs";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
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

const clone = <T>(value: T): T => structuredClone(value);

export class MockAssetraClient implements AssetraClient {
  private assets: Asset[];

  constructor() {
    this.assets = this.loadAssets();
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
    if (process.env.NODE_ENV === "test") return clone(demoAssets);
    const sPath = this.getStoragePath();
    if (fs.existsSync(sPath)) {
      try {
        const raw = fs.readFileSync(sPath, "utf8");
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      } catch (err) {
        console.error("Warning: Could not read mock assets storage:", err);
      }
    }
    return clone(demoAssets);
  }

  private saveAssets() {
    if (process.env.NODE_ENV === "test") return;
    try {
      const sPath = this.getStoragePath();
      fs.mkdirSync(path.dirname(sPath), { recursive: true });
      fs.writeFileSync(sPath, JSON.stringify(this.assets, null, 2), "utf8");
    } catch (err) {
      console.error("Warning: Could not save mock assets:", err);
    }
  }

  async listAssets(): Promise<Asset[]> {
    if (process.env.NODE_ENV !== "test") {
      const fresh = this.loadAssets();
      if (fresh && fresh.length > 0) this.assets = fresh;
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

  async runLifecycleAction(assetId: string, input: LifecycleActionInput): Promise<Asset> {
    const asset = this.assets.find((item) => item.id === assetId);
    if (!asset) throw new Error("ASSET_NOT_FOUND");
    const amount = input.amount ?? 0;
    if (input.action === "mint") {
      if (amount <= 0 || asset.mintedSupply + amount > asset.supply) throw new Error("INVALID_MINT_AMOUNT");
      asset.mintedSupply += amount;
      asset.status = "active";
    }
    if (input.action === "burn") {
      if (amount <= 0 || amount > asset.mintedSupply) throw new Error("INVALID_BURN_AMOUNT");
      asset.mintedSupply -= amount;
    }
    if (input.action === "activate") {
      if (asset.status !== "draft") throw new Error("InvalidStatusTransition: Solo un activo en borrador puede activarse");
      asset.status = "active";
    }
    if (input.action === "pause") asset.status = "paused";
    if (input.action === "unpause") asset.status = "active";
    if (input.action === "redeem") { asset.mintedSupply = 0; asset.status = "redeemed"; }
    asset.activity.unshift({
      id: randomUUID(), type: input.action,
      label: amount ? `${input.action} de ${amount} ${asset.symbol}` : `Activo ${input.action}`,
      actor: "Administrador", timestamp: new Date().toISOString()
    });
    this.saveAssets();
    return clone(asset);
  }

  async transferTokens(assetId: string, input: TransferInput): Promise<TransferResult> {
    const asset = this.assets.find((item) => item.id === assetId);
    if (!asset) throw new Error("ASSET_NOT_FOUND");

    if (asset.status !== "active") {
      throw new Error(`AssetNotActive: No se pueden transferir tokens porque el activo está en estado '${asset.status}'`);
    }

    if (!input.amount || input.amount <= 0) {
      throw new Error("InvalidAmount: El monto a transferir debe ser mayor a 0");
    }

    if (input.amount > asset.mintedSupply) {
      throw new Error("InsufficientBalance: El saldo disponible es insuficiente para esta transferencia");
    }

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
      throw new Error("WalletFrozen: La cuenta emisora se encuentra congelada preventivamente por Compliance.");
    }
    if (senderParticipant && senderParticipant.status === "revoked") {
      throw new Error("SenderNotAuthorized: La cuenta emisora fue revocada por Compliance.");
    }

    const txHash = randomBytes(32).toString("hex");
    const timestamp = new Date().toISOString();

    asset.activity.unshift({
      id: randomUUID(),
      type: "transfer",
      label: `Transferencia de ${input.amount} ${asset.symbol} a ${targetParticipant.name}`,
      actor: input.from.length > 10 ? input.from.slice(0, 4) + "..." + input.from.slice(-4) : input.from,
      timestamp,
      txHash: txHash.slice(0, 16) + "..."
    });

    this.saveAssets();
    return {
      txHash,
      status: "success",
      from: input.from,
      to: targetParticipant.wallet,
      amount: input.amount,
      timestamp
    };
  }


  async addParticipant(assetId: string, input: Omit<Participant, "id">): Promise<Participant> {
    const asset = this.assets.find((item) => item.id === assetId);
    if (!asset) throw new Error("ASSET_NOT_FOUND");
    const participant = { ...input, id: `participant-${randomUUID()}` };
    asset.participants.push(participant);
    this.saveAssets();
    return clone(participant);
  }

  async updateParticipantStatus(assetId: string, participantId: string, status: ParticipantStatus): Promise<Participant> {
    const asset = this.assets.find((item) => item.id === assetId);
    if (!asset) throw new Error("ASSET_NOT_FOUND");
    const participant = asset.participants.find((item) => item.id === participantId);
    if (!participant) throw new Error("PARTICIPANT_NOT_FOUND");
    participant.status = status;
    participant.verifiedAt = status === "authorized" ? new Date().toISOString() : participant.verifiedAt;
    this.saveAssets();
    return clone(participant);
  }

  async addDocument(assetId: string, input: Omit<DocumentRecord, "id" | "createdAt">): Promise<DocumentRecord> {
    const asset = this.assets.find((item) => item.id === assetId);
    if (!asset) throw new Error("ASSET_NOT_FOUND");
    const document = { ...input, id: `doc-${randomUUID()}`, createdAt: new Date().toISOString() };
    asset.documents.push(document);
    this.saveAssets();
    return clone(document);
  }
}
