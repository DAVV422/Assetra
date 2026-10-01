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

export interface AssetraClient {
  listAssets(): Promise<Asset[]>;
  getAsset(assetId: string): Promise<Asset>;
  createAsset(input: CreateAssetInput): Promise<Asset>;
  runLifecycleAction(assetId: string, input: LifecycleActionInput): Promise<Asset>;
  transferTokens(assetId: string, input: TransferInput): Promise<TransferResult>;
  addParticipant(assetId: string, participant: Omit<Participant, "id">): Promise<Participant>;
  updateParticipantStatus(assetId: string, participantId: string, status: ParticipantStatus): Promise<Participant>;
  addDocument(assetId: string, document: Omit<DocumentRecord, "id" | "createdAt">): Promise<DocumentRecord>;
}
