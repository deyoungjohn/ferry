import { describe, expect, it } from 'vitest';
import {
  deriveRecoveryRoot,
  evmLockId,
  swapHashLockAt,
  swapTagAt,
} from '@ferry/core';
import type { Address } from 'viem';
import {
  encodeTermsOutput,
  parseTermsOutput,
  scanBchFry1Transactions,
  scanEvmRoot,
  type WalletChain,
} from '../src/wallet-scan.js';

const SIGNATURE = `0x${'11'.repeat(64)}` as const;
const ROOT = deriveRecoveryRoot(SIGNATURE);
const OWNER = '0x1111111111111111111111111111111111111111' as Address;
const CHAIN: WalletChain = {
  chainId: 8453,
  name: 'Base',
  rpcUrls: [],
  htlcAddresses: ['0x2222222222222222222222222222222222222222'],
};

describe('wallet-derived recovery scan', () => {
  it('finds locks by index, resets the gap, and stops after the gap', async () => {
    const result = await scanEvmRoot({
      root: ROOT,
      owner: OWNER,
      chains: [CHAIN],
      gap: 2,
      maxIndex: 20,
      readLock: async ({ lockId }) => {
        if (lockId === evmLockId(OWNER, swapHashLockAt(ROOT, 0))) {
          return { status: 'locked' as const };
        }
        if (lockId === evmLockId(OWNER, swapHashLockAt(ROOT, 2))) {
          return { status: 'claimed' as const };
        }
        return { status: 'none' as const };
      },
    });
    expect(result.swaps.map((swap) => swap.index)).toEqual([0, 2]);
    expect(result.scanned).toBe(5);
    expect(result.errors).toEqual([]);
  });

  it('round-trips the FRY1 terms output', () => {
    const terms = {
      tag: Uint8Array.from(Buffer.from(swapTagAt(ROOT, 7).slice(2), 'hex')),
      token: 1 as const,
      tokenAmount: 12345n,
      refundHeight: 800_000,
      maxFee: 1500,
      recipientLockingBytecode: Uint8Array.from([0x76, 0xa9, 0x14]),
      refundLockingBytecode: Uint8Array.from([0x76, 0xa9, 0x14]),
    };
    expect(parseTermsOutput(encodeTermsOutput(terms))).toEqual(terms);
  });

  it('finds a BCH lock from the FRY1 tag and stops at the gap', () => {
    const terms = {
      tag: Uint8Array.from(Buffer.from(swapTagAt(ROOT, 1).slice(2), 'hex')),
      token: 2 as const,
      tokenAmount: 500n,
      refundHeight: 800_000,
      maxFee: 1500,
      recipientLockingBytecode: Uint8Array.from([0x76, 0xa9, 0x14]),
      refundLockingBytecode: Uint8Array.from([0x76, 0xa9, 0x14]),
    };
    const result = scanBchFry1Transactions({
      root: ROOT,
      gap: 2,
      transactions: [
        {
          txid: 'aa'.repeat(32),
          outputs: [{ lockingBytecode: encodeTermsOutput(terms) }],
        },
      ],
    });
    expect(result.swaps).toHaveLength(1);
    expect(result.swaps[0]?.index).toBe(1);
    expect(result.scanned).toBe(4);
  });
});
