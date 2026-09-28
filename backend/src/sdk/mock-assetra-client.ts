import { randomUUID } from "node:crypto";
import { demoAssets } from "../fixtures.js";
import type { AssetraClient } from "./assetra-client.js";
import type { Asset, CreateAssetInput, DocumentRecord, LifecycleActionInput, Participant, ParticipantStatus } from "../types.js";

const clone = <T>(value: T): T => structuredClone(value);

export class MockAssetraClient implements AssetraClient {
  private assets = clone(demoAssets);

  async listAssets(): Promise<Asset[]> { return clone(this.assets); }

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
    if (input.action === "pause") asset.status = "paused";
    if (input.action === "unpause") asset.status = "active";
    if (input.action === "redeem") { asset.mintedSupply = 0; asset.status = "redeemed"; }
    asset.activity.unshift({
      id: randomUUID(), type: input.action,
      label: amount ? `${input.action} de ${amount} ${asset.symbol}` : `Activo ${input.action}`,
      actor: "Administrador", timestamp: new Date().toISOString()
    });
    return clone(asset);
  }

  async addParticipant(assetId: string, input: Omit<Participant, "id">): Promise<Participant> {
    const asset = this.assets.find((item) => item.id === assetId);
    if (!asset) throw new Error("ASSET_NOT_FOUND");
    const participant = { ...input, id: `participant-${randomUUID()}` };
    asset.participants.push(participant);
    return clone(participant);
  }

  async updateParticipantStatus(assetId: string, participantId: string, status: ParticipantStatus): Promise<Participant> {
    const asset = this.assets.find((item) => item.id === assetId);
    if (!asset) throw new Error("ASSET_NOT_FOUND");
    const participant = asset.participants.find((item) => item.id === participantId);
    if (!participant) throw new Error("PARTICIPANT_NOT_FOUND");
    participant.status = status;
    participant.verifiedAt = status === "authorized" ? new Date().toISOString() : participant.verifiedAt;
    return clone(participant);
  }

  async addDocument(assetId: string, input: Omit<DocumentRecord, "id" | "createdAt">): Promise<DocumentRecord> {
    const asset = this.assets.find((item) => item.id === assetId);
    if (!asset) throw new Error("ASSET_NOT_FOUND");
    const document = { ...input, id: `doc-${randomUUID()}`, createdAt: new Date().toISOString() };
    asset.documents.push(document);
    return clone(document);
  }
}
