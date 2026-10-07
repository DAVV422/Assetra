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

export const STORAGE_KEY_CUSTOM_ASSETS = "assetra_cached_custom_assets";

export function getCachedCustomAssets(): Asset[] {
  if (typeof window === "undefined" || !window.localStorage) return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_CUSTOM_ASSETS);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function cacheCustomAssetLocally(asset: Asset): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    const current = getCachedCustomAssets();
    const filtered = current.filter((a) => a.id !== asset.id);
    filtered.unshift(asset);
    window.localStorage.setItem(STORAGE_KEY_CUSTOM_ASSETS, JSON.stringify(filtered));
  } catch {
    // ignore
  }
}

export function mergeWithCachedAssets(remoteAssets: Asset[]): Asset[] {
  const cached = getCachedCustomAssets();
  if (cached.length === 0) return remoteAssets;

  const remoteMap = new Map(remoteAssets.map((a) => [a.id, a]));
  const merged: Asset[] = [...remoteAssets];

  for (const c of cached) {
    if (!remoteMap.has(c.id)) {
      merged.unshift(c);
    }
  }
  return merged;
}

export class HttpAssetraClient implements AssetraClient {
  constructor(private readonly baseUrl: string) {}
  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers }
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.message ?? body.error ?? "No fue posible completar la operación");
    return body;
  }

  async listAssets(): Promise<Asset[]> {
    try {
      const data = await this.request<Asset[]>("/api/assets");
      return mergeWithCachedAssets(data);
    } catch (err) {
      const cached = getCachedCustomAssets();
      if (cached.length > 0) {
        return cached;
      }
      throw err;
    }
  }

  async getAsset(assetId: string): Promise<Asset> {
    try {
      const data = await this.request<Asset>(`/api/assets/${assetId}`);
      cacheCustomAssetLocally(data);
      return data;
    } catch (err) {
      const cached = getCachedCustomAssets().find((a) => a.id === assetId);
      if (cached) return cached;
      throw err;
    }
  }

  async createAsset(input: CreateAssetInput): Promise<Asset> {
    const asset = await this.request<Asset>("/api/assets", { method: "POST", body: JSON.stringify(input) });
    cacheCustomAssetLocally(asset);
    return asset;
  }

  async runLifecycleAction(assetId: string, input: LifecycleActionInput): Promise<Asset> {
    const asset = await this.request<Asset>(`/api/assets/${assetId}/actions`, { method: "POST", body: JSON.stringify(input) });
    cacheCustomAssetLocally(asset);
    return asset;
  }

  async transferTokens(assetId: string, input: TransferInput): Promise<TransferResult> {
    return this.request<TransferResult>(`/api/assets/${assetId}/transfers`, { method: "POST", body: JSON.stringify(input) });
  }

  async addParticipant(assetId: string, participant: Omit<Participant, "id">): Promise<Participant> {
    const res = await this.request<Participant>(`/api/assets/${assetId}/participants`, { method: "POST", body: JSON.stringify(participant) });
    try {
      const updated = await this.getAsset(assetId);
      cacheCustomAssetLocally(updated);
    } catch {
      // ignore
    }
    return res;
  }

  async updateParticipantStatus(assetId: string, participantId: string, status: ParticipantStatus): Promise<Participant> {
    const res = await this.request<Participant>(`/api/assets/${assetId}/participants/${participantId}`, { method: "PATCH", body: JSON.stringify({ status }) });
    try {
      const updated = await this.getAsset(assetId);
      cacheCustomAssetLocally(updated);
    } catch {
      // ignore
    }
    return res;
  }

  async addDocument(assetId: string, document: Omit<DocumentRecord, "id" | "createdAt">): Promise<DocumentRecord> {
    const res = await this.request<DocumentRecord>(`/api/assets/${assetId}/documents`, { method: "POST", body: JSON.stringify(document) });
    try {
      const updated = await this.getAsset(assetId);
      cacheCustomAssetLocally(updated);
    } catch {
      // ignore
    }
    return res;
  }
}

