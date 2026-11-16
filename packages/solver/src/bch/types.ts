export interface ElectrumUtxo {
  height: number;
  tx_hash: string;
  tx_pos: number;
  value: number;
  token_data?: {
    category: string;
    amount: string;
    nft?: {
      capability: string;
      commitment: string;
    };
  };
}

export interface ElectrumHistoryEntry {
  height: number;
  tx_hash: string;
  fee?: number;
}

export type QuotingState =
  | 'HEALTHY'
  | 'STALE_LIVENESS'
  | 'STALE_BLOCK_AGE'
  | 'SPLIT_TIP'
  | 'INSUFFICIENT_SERVERS';

export interface BchQuorumStatus {
  quorumTip: number;
  tips: Record<string, number>;
  isQuorumHealthy: boolean;
  ageSeconds: number;
  lastConfirmedAt: number;
  livenessAgeSeconds: number;
  isLivenessHealthy: boolean;
  healthyServersCount: number;
  quotingAllowed: boolean;
  quotingState: QuotingState;
  failedHosts?: Record<string, string> | undefined;
  quorumFailureMessage?: string | undefined;
}

export interface DSProofEvidence {
  txid: string;
  hasProof: boolean;
  proofData?: unknown;
}

export interface DSProofWatcher {
  subscribe(txid: string, callback: (evidence: DSProofEvidence) => void): void;
  unsubscribe(txid: string): void;
}
