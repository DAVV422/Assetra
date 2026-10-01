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

export interface StellarAssetraConfig {
  network: "testnet" | "mainnet";
  rpcUrl: string;
  registryContractId: string;
  tokenContractId: string;
}

export class StellarAssetraClient implements AssetraClient {
  constructor(private readonly config: StellarAssetraConfig) {}
  private unavailable(): never {
    throw new Error(`Stellar adapter pending contract ABI for ${this.config.network}. Use MockAssetraClient until generated bindings are available.`);
  }
  listAssets(): Promise<Asset[]> { return this.unavailable(); }
  getAsset(_assetId: string): Promise<Asset> { return this.unavailable(); }
  createAsset(_input: CreateAssetInput): Promise<Asset> { return this.unavailable(); }
  runLifecycleAction(_assetId: string, _input: LifecycleActionInput): Promise<Asset> { return this.unavailable(); }
  transferTokens(_assetId: string, _input: TransferInput): Promise<TransferResult> { return this.unavailable(); }
  addParticipant(_assetId: string, _participant: Omit<Participant, "id">): Promise<Participant> { return this.unavailable(); }
  updateParticipantStatus(_assetId: string, _participantId: string, _status: ParticipantStatus): Promise<Participant> { return this.unavailable(); }
  addDocument(_assetId: string, _document: Omit<DocumentRecord, "id" | "createdAt">): Promise<DocumentRecord> { return this.unavailable(); }
}

