export interface ActionIntent {
  txid: string;
  txHex: string;
  [key: string]: unknown;
}

export type ActionStatus = 'PENDING' | 'BROADCAST' | 'CONFIRMED' | 'FAILED';

export interface ActionRecord {
  orderId: string;
  action: string;
  status: ActionStatus;
  intentPayload: string;
  txid?: string | undefined;
  createdAt: number;
  updatedAt: number;
}

export interface OrderRecord {
  id: string;
  direction: 'BCH_TO_COUNTER' | 'COUNTER_TO_BCH';
  status: string;
  userCounterAddress: string;
  lockId: string;
  termsJson: string;
  hashLock: string;
  secret?: string | undefined;
  secretSource?: string | undefined;
  userLockTxId?: string | undefined;
  solverLockTxId?: string | undefined;
  userClaimTxId?: string | undefined;
  solverClaimTxId?: string | undefined;
  solverRefundTxId?: string | undefined;
  lane?: 'safe' | 'fast' | undefined;
  fastOptIn?: boolean | undefined;
  firstSeenAtMs?: number | undefined;
  needsAttention?: boolean | undefined;
  rejectionReason?: string | undefined;
  createdAt: number;
  updatedAt: number;
}
