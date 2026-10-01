import { HttpAssetraClient } from "./http-client";
import { MockAssetraClient } from "./mock-client";
import type { AssetraClient } from "./assetra-client";
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

export type ClientMode = "mock" | "http";

const envDefault = import.meta.env.VITE_ASSETRA_CLIENT === "http" ? "http" : "mock";
const stored = typeof window !== "undefined" ? localStorage.getItem("assetra_client_mode") as ClientMode | null : null;
let currentMode: ClientMode = stored || envDefault;

export const apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

const mockInstance = new MockAssetraClient();
const httpInstance = new HttpAssetraClient(apiUrl);

function getActiveClient(): AssetraClient {
  return currentMode === "http" ? httpInstance : mockInstance;
}

export const assetraClient: AssetraClient = {
  listAssets(): Promise<Asset[]> {
    return getActiveClient().listAssets();
  },
  getAsset(assetId: string): Promise<Asset> {
    return getActiveClient().getAsset(assetId);
  },
  createAsset(input: CreateAssetInput): Promise<Asset> {
    return getActiveClient().createAsset(input);
  },
  runLifecycleAction(assetId: string, input: LifecycleActionInput): Promise<Asset> {
    return getActiveClient().runLifecycleAction(assetId, input);
  },
  transferTokens(assetId: string, input: TransferInput): Promise<TransferResult> {
    return getActiveClient().transferTokens(assetId, input);
  },
  addParticipant(assetId: string, participant: Omit<Participant, "id">): Promise<Participant> {
    return getActiveClient().addParticipant(assetId, participant);
  },
  updateParticipantStatus(assetId: string, participantId: string, status: ParticipantStatus): Promise<Participant> {
    return getActiveClient().updateParticipantStatus(assetId, participantId, status);
  },
  addDocument(assetId: string, document: Omit<DocumentRecord, "id" | "createdAt">): Promise<DocumentRecord> {
    return getActiveClient().addDocument(assetId, document);
  }
};

export function getClientMode(): ClientMode {
  return currentMode;
}

export function setClientMode(mode: ClientMode): void {
  currentMode = mode;
  if (typeof window !== "undefined") {
    localStorage.setItem("assetra_client_mode", mode);
  }
}

export async function checkBackendHealth(): Promise<{ ok: boolean; mode?: string }> {
  try {
    const res = await fetch(`${apiUrl}/health`);
    if (!res.ok) return { ok: false };
    const data = await res.json();
    return { ok: true, mode: data.mode };
  } catch {
    return { ok: false };
  }
}
