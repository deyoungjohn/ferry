import { describe, expect, it } from 'vitest';
import {
  deriveRecoveryRoot,
  swapSecretAt,
  swapTagAt,
  type Hex32,
} from '@ferry/core';
import { viewTagSchema, type SendLinkQueryMatch } from '@ferry/core/api';
import { sha256 } from 'viem';
import {
  chainNameFromId,
  matchToSendLinkData,
  scanWalletSendLinks,
  sendLinkViewTag,
} from '../lib/send/wallet-send-links';

const SIGNATURE = `0x${'33'.repeat(65)}` as const;
const ROOT = deriveRecoveryRoot(SIGNATURE);

describe('wallet-send-links logic and tag derivation', () => {
  it('pads an 8-byte tag to 32 bytes and satisfies viewTagSchema', () => {
    const rawTag = swapTagAt(ROOT, 0); // 8 bytes -> 0x + 16 chars = 18 chars
    expect(rawTag).toMatch(/^0x[0-9a-f]{16}$/);

    const viewTag = sendLinkViewTag(rawTag);
    expect(viewTag).toHaveLength(66);
    expect(viewTag).toMatch(/^0x[0-9a-f]{64}$/);
    expect(viewTag.slice(0, 18)).toBe(rawTag.toLowerCase());

    const parsed = viewTagSchema.parse(viewTag);
    expect(parsed).toBe(viewTag.toLowerCase());
  });

  it('keeps an already 32-byte tag intact', () => {
    const fullTag = `0x${'55'.repeat(32)}`;
    expect(sendLinkViewTag(fullTag)).toBe(fullTag);
  });

  it('throws on tags longer than 32 bytes', () => {
    const longTag = `0x${'66'.repeat(33)}`;
    expect(() => sendLinkViewTag(longTag)).toThrow(RangeError);
  });

  it('maps known chain IDs to chain names', () => {
    expect(chainNameFromId(8453)).toBe('Base');
    expect(chainNameFromId(42161)).toBe('Arbitrum One');
    expect(chainNameFromId(10)).toBe('OP Mainnet');
    expect(chainNameFromId(137)).toBe('Polygon');
    expect(chainNameFromId(4663)).toBe('Robinhood');
    expect(chainNameFromId(99999)).toBe('Chain 99999');
  });

  it('scans wallet send links, matches tags, rebuilds secrets, and verifies hashLocks', async () => {
    // Generate 3 sample orders at indices 0, 1, and 5
    const indices = [0, 1, 5];
    const mockOrders: Record<string, SendLinkQueryMatch> = {};

    for (const idx of indices) {
      const secret = swapSecretAt(ROOT, idx);
      const hashLock = sha256(secret);
      const tag = sendLinkViewTag(swapTagAt(ROOT, idx));

      mockOrders[tag.toLowerCase()] = {
        id: `sl-${idx}`,
        orderId: `0x${idx.toString(16).padStart(64, '0')}` as Hex32,
        status: idx === 1 ? 'claimed' : idx === 5 ? 'refunded' : 'locked',
        token: 'PUSD',
        chainId: 8453,
        evmToken: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        amountIn: '2500', // 25.00 PUSD
        recipientEvmAddress: '0x1111111111111111111111111111111111111111',
        hashLock,
        evmDeadline: 1_790_000_000,
        bchRefundHeight: 850_000,
        note: `Transfer #${idx}`,
        createdAt: 1_780_000_000 + idx * 100,
        updatedAt: 1_780_000_000 + idx * 100 + 10,
        tag,
      };
    }

    const queriedBatches: (readonly Hex32[])[] = [];

    const result = await scanWalletSendLinks({
      root: ROOT,
      queryFn: async (tags) => {
        queriedBatches.push(tags);
        const matches: SendLinkQueryMatch[] = [];
        for (const t of tags) {
          const match = mockOrders[t.toLowerCase()];
          if (match) matches.push(match);
        }
        return matches;
      },
    });

    expect(result.links).toHaveLength(3);

    // Sorted newest first: idx 5, idx 1, idx 0
    expect(result.links[0]?.id).toBe('sl-5');
    expect(result.links[0]?.status).toBe('open');
    expect(result.links[0]?.lockStatus).toBe('refunded');
    expect(result.links[0]?.amount).toBe(25.0);

    expect(result.links[1]?.id).toBe('sl-1');
    expect(result.links[1]?.status).toBe('claimed');
    expect(result.links[1]?.lockStatus).toBe('claimed');

    expect(result.links[2]?.id).toBe('sl-0');
    expect(result.links[2]?.status).toBe('open');
    expect(result.links[2]?.lockStatus).toBe('locked');

    // Every secret matches swapSecretAt and sha256(secret) === order.hashLock
    for (const link of result.links) {
      const idx = link.id === 'sl-0' ? 0 : link.id === 'sl-1' ? 1 : 5;
      expect(link.secret).toBe(swapSecretAt(ROOT, idx));
      expect(sha256(link.secret as Hex32).toLowerCase()).toBe(
        mockOrders[
          sendLinkViewTag(swapTagAt(ROOT, idx)).toLowerCase()
        ]!.hashLock.toLowerCase(),
      );
    }

    // The scan stopped after RECOVERY_SCAN_GAP misses after index 5 (index 6..25 = 20 misses)
    expect(result.scannedCount).toBeGreaterThanOrEqual(25);
  });

  it('stops scan when the gap limit is reached with zero links', async () => {
    let callCount = 0;
    const result = await scanWalletSendLinks({
      root: ROOT,
      gap: 10,
      batchSize: 10,
      queryFn: async () => {
        callCount += 1;
        return [];
      },
    });

    expect(result.links).toHaveLength(0);
    expect(callCount).toBe(1);
    expect(result.scannedCount).toBe(10);
  });

  it('ignores orders where secret does not hash to hashLock', async () => {
    const rawTag = swapTagAt(ROOT, 0);
    const tag = sendLinkViewTag(rawTag);

    const result = await scanWalletSendLinks({
      root: ROOT,
      gap: 5,
      batchSize: 5,
      queryFn: async () => [
        {
          id: 'sl-corrupted',
          orderId: `0x${'0'.repeat(64)}` as Hex32,
          status: 'locked',
          token: 'PUSD',
          chainId: 8453,
          evmToken: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
          amountIn: '1000',
          recipientEvmAddress: '0x1111111111111111111111111111111111111111',
          hashLock: `0x${'99'.repeat(32)}` as Hex32, // Does not match swapSecretAt(ROOT, 0)
          evmDeadline: 1_790_000_000,
          bchRefundHeight: 850_000,
          createdAt: 1_780_000_000,
          updatedAt: 1_780_000_000,
          tag,
        },
      ],
    });

    expect(result.links).toHaveLength(0);
  });

  it('matchToSendLinkData formats all details and refund date properly', () => {
    const secret = swapSecretAt(ROOT, 2);
    const hashLock = sha256(secret);
    const tag = sendLinkViewTag(swapTagAt(ROOT, 2));

    const match: SendLinkQueryMatch = {
      id: 'sl-2',
      orderId: `0x${'02'.repeat(32)}` as Hex32,
      status: 'pending_lock',
      token: 'PUSD',
      chainId: 8453,
      evmToken: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      amountIn: '5000', // 50.00
      recipientEvmAddress: '0x1111111111111111111111111111111111111111',
      hashLock,
      evmDeadline: 1_790_000_000,
      bchRefundHeight: 850_000,
      note: 'Hello receiver',
      createdAt: 1_780_000_000,
      updatedAt: 1_780_000_000,
      tag,
    };

    const link = matchToSendLinkData(match, secret);
    expect(link.id).toBe('sl-2');
    expect(link.orderId).toBe(`0x${'02'.repeat(32)}`);
    expect(link.amount).toBe(50.0);
    expect(link.destinationChain).toBe('Base');
    expect(link.lockStatus).toBe('pending_lock');
    expect(link.note).toBe('Hello receiver');
    expect(link.secret).toBe(secret);
    expect(link.refundDate).toContain('BCH block 850000');
  });
});
