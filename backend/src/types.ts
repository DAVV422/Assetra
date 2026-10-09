export type AssetStatus = "draft" | "active" | "paused" | "redeemed";
export type ParticipantStatus = "pending" | "authorized" | "revoked" | "frozen";
export type AssetType = "invoice" | "bond" | "real-estate" | "commodity" | "carbon-credit";

export interface DocumentRecord {
  id: string;
  name: string;
  kind: string;
  hash: string;
  url?: string;
  version: number;
  createdAt: string;
}

export interface Participant {
  id: string;
  name: string;
  wallet: string;
  jurisdiction: string;
  status: ParticipantStatus;
  verifiedAt?: string;
}

export interface ActivityEvent {
  id: string;
  type: string;
  label: string;
  actor: string;
  timestamp: string;
  txHash?: string;
}

export interface Asset {
  id: string;
  name: string;
  symbol: string;
  type: AssetType;
  description: string;
  issuer: string;
  custodian: string;
  jurisdiction: string;
  totalValue: number;
  currency: string;
  supply: number;
  mintedSupply: number;
  holderCount: number;
  maturityDate: string;
  status: AssetStatus;
  /** Dirección del token del activo (desplegado por RwaRegistry) */
  contractId?: string;
  /** asset_id del activo en RwaRegistry (Symbol) */
  onChainId?: string;
  complianceOfficer?: string;
  creatorWallet?: string;
  documents: DocumentRecord[];
  participants: Participant[];
  activity: ActivityEvent[];
  createdAt: string;
}

export interface CreateAssetInput {
  name: string;
  symbol: string;
  type: AssetType;
  description: string;
  issuer: string;
  custodian: string;
  jurisdiction: string;
  creatorWallet?: string;
  totalValue: number;
  currency: string;
  supply: number;
  maturityDate: string;
  /** Modo live: asset_id on-chain y hash de la transacción create_asset firmada por el emisor */
  onChainId?: string;
  txHash?: string;
}

export type LifecycleAction = "activate" | "mint" | "burn" | "pause" | "unpause" | "redeem";
export interface LifecycleActionInput { action: LifecycleAction; amount?: number; txHash?: string; }

export interface TransferInput {
  from: string;
  to: string;
  amount: number;
  txHash?: string;
}

export interface TransferResult {
  txHash: string;
  status: "success";
  from: string;
  to: string;
  amount: number;
  timestamp: string;
}

