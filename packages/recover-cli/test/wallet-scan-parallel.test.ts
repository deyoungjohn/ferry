import { describe, expect, it } from 'vitest';
import { scanEvmRoot, type WalletChain } from '../src/wallet-scan.js';

const root = ('0x' + '42'.repeat(32)) as `0x${string}`;
const owner = '0x1111111111111111111111111111111111111111' as const;
const chain = (chainId: number): WalletChain => ({
  chainId,
  name: `chain-${chainId}`,
  rpcUrls: ['https://rpc.example'],
  htlcAddresses: ['0x2222222222222222222222222222222222222222'],
});

describe('wallet scan', () => {
  it('reads in parallel, keeps the gap rule and reports progress', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const progress: number[] = [];
    let call = 0;
    const result = await scanEvmRoot({
      root,
      owner,
      chains: [chain(1), chain(2)],
      gap: 5,
      concurrency: 4,
      onProgress: (p) => progress.push(p.scanned),
      readLock: async ({ chain: c }) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight -= 1;
        call += 1;
        // A lock on chain 2 at index 0 only.
        return c.chainId === 2 && call <= 2 ? { status: 'locked' } : null;
      },
    });
    expect(maxInFlight).toBeGreaterThan(1);
    expect(result.swaps.length).toBeGreaterThanOrEqual(1);
    expect(result.scanned).toBeLessThanOrEqual(1 + 5);
    expect(progress.length).toBeGreaterThan(0);
  });

  it('skips a chain that keeps failing and reports it once', async () => {
    let badCalls = 0;
    const result = await scanEvmRoot({
      root,
      owner,
      chains: [chain(1), chain(99)],
      gap: 20,
      concurrency: 1,
      readLock: async ({ chain: c }) => {
        if (c.chainId === 99) {
          badCalls += 1;
          throw new Error('rate limited');
        }
        return null;
      },
    });
    expect(badCalls).toBe(3);
    expect(result.errors).toEqual([
      { chain: 'chain-99', message: 'rate limited' },
    ]);
  });
});
