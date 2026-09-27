import type { Asset, CreateAssetInput, DocumentRecord, LifecycleActionInput, Participant, ParticipantStatus } from "../types";
import type { AssetraClient } from "./assetra-client";

export class HttpAssetraClient implements AssetraClient {
  constructor(private readonly baseUrl: string) {}
  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers }
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "No fue posible completar la operación");
    return body;
  }
  listAssets() { return this.request<Asset[]>("/api/assets"); }
  getAsset(assetId: string) { return this.request<Asset>(`/api/assets/${assetId}`); }
  createAsset(input: CreateAssetInput) { return this.request<Asset>("/api/assets", { method: "POST", body: JSON.stringify(input) }); }
  runLifecycleAction(assetId: string, input: LifecycleActionInput) { return this.request<Asset>(`/api/assets/${assetId}/actions`, { method: "POST", body: JSON.stringify(input) }); }
  addParticipant(assetId: string, participant: Omit<Participant, "id">) { return this.request<Participant>(`/api/assets/${assetId}/participants`, { method: "POST", body: JSON.stringify(participant) }); }
  updateParticipantStatus(assetId: string, participantId: string, status: ParticipantStatus) { return this.request<Participant>(`/api/assets/${assetId}/participants/${participantId}`, { method: "PATCH", body: JSON.stringify({ status }) }); }
  addDocument(assetId: string, document: Omit<DocumentRecord, "id" | "createdAt">) { return this.request<DocumentRecord>(`/api/assets/${assetId}/documents`, { method: "POST", body: JSON.stringify(document) }); }
}
