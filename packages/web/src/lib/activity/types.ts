import type {
  BchActivityItem,
  BchActivityState,
  BchElectrum,
  MergedActivityEntry,
} from '@ferry/htlc-bch';
import type { Hex, Address } from 'viem';

export type {
  BchActivityItem,
  BchActivityState,
  BchElectrum,
  MergedActivityEntry,
};

export type ChainLockState = 'locked' | 'claimed' | 'refunded';

export interface ChainLock {
  readonly id: Hex;
  readonly role: 'sender' | 'recipient';
  readonly token: Address;
  readonly amount: bigint;
  readonly hashLock: Hex;
  readonly deadline: bigint;
  readonly blockNumber: bigint;
  readonly lockedAt: number;
  readonly lockTx: Hex;
  readonly state: ChainLockState;
}

export interface ActivityEntry {
  readonly key: string;
  readonly createdAt: number;
  readonly direction: 'COUNTER_TO_BCH' | 'BCH_TO_COUNTER';
  readonly bch: BchActivityItem | null;
  readonly chain: ChainLock | null;
  readonly hashLock?: string | undefined;
  readonly statusLabel: string;
  readonly amountDisplay: string;
  /** Set for entries from the solver's order list: the swap's page, and how to colour its state. */
  readonly orderId?: string | undefined;
  readonly tone?: 'ok' | 'warn' | 'neutral' | undefined;
}
