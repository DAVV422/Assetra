import { demoAssets } from "../data";
import type { Asset, CreateAssetInput, DocumentRecord, LifecycleActionInput, Participant, ParticipantStatus } from "../types";
import type { AssetraClient } from "./assetra-client";

const clone = <T,>(value: T): T => structuredClone(value);
const id = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;

export class MockAssetraClient implements AssetraClient {
  private assets = clone(demoAssets);
  private wait() { return new Promise((resolve) => setTimeout(resolve, 180)); }

  async listAssets() { await this.wait(); return clone(this.assets); }
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
      ...input, id: id("asset"), symbol: input.symbol.toUpperCase(), mintedSupply: 0, holderCount: 0,
      status: "draft", documents: [], participants: [],
      activity: [{ id: id("evt"), type: "create", label: "Activo registrado", actor: "Emisor", timestamp: createdAt }], createdAt
    };
    this.assets.unshift(asset);
    return clone(asset);
  }
  async runLifecycleAction(assetId: string, input: LifecycleActionInput) {
    await this.wait();
    const asset = this.assets.find((item) => item.id === assetId);
    if (!asset) throw new Error("Activo no encontrado");
    const amount = input.amount ?? 0;
    if (input.action === "mint") {
      if (!amount || asset.mintedSupply + amount > asset.supply) throw new Error("El monto supera el suministro disponible");
      asset.mintedSupply += amount; asset.status = "active";
    }
    if (input.action === "burn") {
      if (!amount || amount > asset.mintedSupply) throw new Error("El monto supera el balance emitido");
      asset.mintedSupply -= amount;
    }
    if (input.action === "pause") asset.status = "paused";
    if (input.action === "unpause") asset.status = "active";
    if (input.action === "redeem") { asset.mintedSupply = 0; asset.status = "redeemed"; }
    asset.activity.unshift({ id: id("evt"), type: input.action, label: amount ? `${input.action} de ${amount} ${asset.symbol}` : `Activo ${input.action}`, actor: "Administrador", timestamp: new Date().toISOString() });
    return clone(asset);
  }
  async addParticipant(assetId: string, input: Omit<Participant, "id">) {
    const asset = this.assets.find((item) => item.id === assetId);
    if (!asset) throw new Error("Activo no encontrado");
    const participant = { ...input, id: id("participant") };
    asset.participants.push(participant); return clone(participant);
  }
  async updateParticipantStatus(assetId: string, participantId: string, status: ParticipantStatus) {
    const asset = this.assets.find((item) => item.id === assetId);
    const participant = asset?.participants.find((item) => item.id === participantId);
    if (!participant) throw new Error("Participante no encontrado");
    participant.status = status;
    participant.verifiedAt = status === "authorized" ? new Date().toISOString() : participant.verifiedAt;
    return clone(participant);
  }
  async addDocument(assetId: string, input: Omit<DocumentRecord, "id" | "createdAt">) {
    const asset = this.assets.find((item) => item.id === assetId);
    if (!asset) throw new Error("Activo no encontrado");
    const document = { ...input, id: id("doc"), createdAt: new Date().toISOString() };
    asset.documents.push(document); return clone(document);
  }
}
