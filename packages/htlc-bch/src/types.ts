import type { OrderTerms } from '@ferry/core';

export type { OrderTerms };

export type CashAddressNetwork = 'chipnet' | 'mainnet';

export interface BchHtlcParameters {
  hashLock: Uint8Array;
  recipientLockingBytecode: Uint8Array;
  refundLockingBytecode: Uint8Array;
  tokenCategory: Uint8Array; // 32 bytes in INTERNAL byte order
  tokenAmount: bigint;
  refundHeight: number;
  maxFee: bigint;
}

export interface HtlcInputTerms {
  secret?: Uint8Array | string;
  hashLock?: Uint8Array | string;
  recipientAddress?: string;
  recipientLockingBytecode?: Uint8Array | string;
  refundAddress?: string;
  refundLockingBytecode?: Uint8Array | string;
  tokenCategory: string | Uint8Array;
  tokenCategoryIsInternal?: boolean;
  tokenAmount: bigint | number;
  refundHeight: number;
  maxFee?: bigint | number;
}

export interface HtlcAddressDerivationResult {
  p2sh32Address: string;
  tokenAddress: string;
  redeemScript: Uint8Array;
  lockingBytecode: Uint8Array;
}
