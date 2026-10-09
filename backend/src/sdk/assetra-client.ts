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

/** Parámetros públicos de red y contratos que el frontend necesita para firmar transacciones. */
export interface ChainPublicConfig {
  network: string;
  rpcUrl: string;
  networkPassphrase: string;
  registryContractId: string;
  adminAddress: string;
}

/**
 * Frontera estable entre la API y la capa de datos. En modo live, las escrituras reciben el
 * `txHash` de la transacción que el usuario firmó con su wallet y la implementación la verifica.
 */
export interface AssetraClient {
  listAssets(): Promise<Asset[]>;
  getAsset(assetId: string): Promise<Asset>;
  createAsset(input: CreateAssetInput): Promise<Asset>;
  runLifecycleAction(assetId: string, input: LifecycleActionInput): Promise<Asset>;
  transferTokens(assetId: string, input: TransferInput): Promise<TransferResult>;
  addParticipant(assetId: string, participant: Omit<Participant, "id">, txHash?: string): Promise<Participant>;
  updateParticipantStatus(assetId: string, participantId: string, status: ParticipantStatus, txHash?: string): Promise<Participant>;
  addDocument(assetId: string, document: Omit<DocumentRecord, "id" | "createdAt">, txHash?: string): Promise<DocumentRecord>;
  /** Solo en modo live. */
  config?(): ChainPublicConfig;
}

export { ChainAssetraClient } from "./chain-assetra-client.js";
