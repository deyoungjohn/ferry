import { describe, expect, it, vi } from 'vitest';
import type { EvmChainAdapter } from '@ferry/chain-evm';
import { createEvmPort } from '../src/ports.js';

const LOCK = `0x${'11'.repeat(32)}`;
const TX = `0x${'22'.repeat(32)}`;

function fakeAdapter(id: string, lock: unknown) {
  return {
    id,
    htlcAddress: '0x8b968625F983420B571C102eC0b57F7e509c916e',
    assets: [],
    getLock: vi.fn(async () => lock),
    isFinal: vi.fn(async () => true),
    claim: vi.fn(async () => ({ txId: TX })),
    lock: vi.fn(async () => ({ txId: TX })),
    getTip: vi.fn(async () => ({ height: 1, ageSeconds: 1 })),
  } as unknown as EvmChainAdapter;
}

describe('the EVM port serves every chain', () => {
  const base = fakeAdapter('base', { status: 'absent' });
  const arbitrum = fakeAdapter('arbitrum', {
    status: 'locked',
    lockTx: { txId: TX },
  });
  const port = createEvmPort({
    evmAdapter: base,
    evmAdapters: new Map([
      ['8453', base],
      ['42161', arbitrum],
    ]),
  });

  it('reads a lock on the order chain, not on Base', async () => {
    expect((await port.getLock(LOCK, 42161)).status).toBe('locked');
    expect((await port.getLock(LOCK, 8453)).status).toBe('none');
    expect(arbitrum.getLock).toHaveBeenCalledTimes(1);
  });

  it('checks finality and claims on the order chain', async () => {
    await port.isFinal(TX, 'safe', 42161);
    expect(arbitrum.isFinal).toHaveBeenCalledTimes(1);
    expect(base.isFinal).not.toHaveBeenCalled();
    await port.claim!(LOCK, `0x${'33'.repeat(32)}`, 42161);
    expect(arbitrum.claim).toHaveBeenCalledTimes(1);
    expect(base.claim).not.toHaveBeenCalled();
  });

  it('refuses a chain it has no adapter for instead of reading Base', async () => {
    await expect(port.getLock(LOCK, 999)).rejects.toThrow(/chain 999/);
  });
});

describe('the reveal policy accepts what each chain really reports', () => {
  const tx = `0x${'44'.repeat(32)}`;
  const client = {
    getTransactionReceipt: vi.fn(async () => ({
      status: 'success',
      blockNumber: 100n,
    })),
    getBlockNumber: vi.fn(async () => 130n),
    getBlock: vi.fn(async () => ({
      timestamp: BigInt(Math.floor(Date.now() / 1000) - 60),
    })),
  };
  const withClient = (id: string, safe: boolean) => {
    const adapter = fakeAdapter(id, { status: 'absent' });
    (adapter as unknown as { client: unknown }).client = client;
    (adapter.isFinal as ReturnType<typeof vi.fn>).mockResolvedValue(safe);
    return adapter;
  };

  it('reports confirmations, age and the safe point from the order chain', async () => {
    const arb = withClient('arbitrum', true);
    const port = createEvmPort({
      evmAdapter: arb,
      evmAdapters: new Map([['42161', arb]]),
    });
    const evidence = await port.getLockEvidence!(tx, 42161);
    expect(evidence).toMatchObject({ confirmations: 31, finalized: true });
    expect(evidence!.ageSeconds).toBeGreaterThanOrEqual(59);
  });

  it('lets a finalized lock through on Arbitrum, Ethereum, BNB, Arc and Robinhood', async () => {
    const { revealPolicy } = await import('@ferry/core');
    for (const chain of [
      'arbitrum',
      'ethereum',
      'bnb',
      'arc',
      'robinhood',
      'base',
    ] as const) {
      const decision = revealPolicy({
        chain,
        lane: 'safe',
        fastOptIn: false,
        amountUsdMicros: 5_000_000n,
        evidence: {
          exists: true,
          confirmations: 31,
          ageSeconds: 60,
          safe: true,
          finalized: true,
        },
      });
      expect(decision, chain).toEqual({ allowed: true, reason: 'ready' });
    }
  });
});
