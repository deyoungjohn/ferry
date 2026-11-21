import { describe, expect, it } from 'vitest';
import { SolverDatabase } from '../src/db/database.js';

// Terms are stored with bigint amounts written as "1000000n"; stats, the recent list and the
// open-exposure sum must read them (they once threw on the suffix and counted nothing).
describe('amounts in stored terms', () => {
  it('count in stats, the recent list and the open exposure', () => {
    const db = new SolverDatabase(':memory:');
    const now = Math.floor(Date.now() / 1000);
    const terms = JSON.stringify({
      evmAmount: '1000000n',
      bchTokenAmount: '99n',
      bchToken: 'PUSD',
      quoteExpiry: now + 300,
    });
    const base = {
      direction: 'EVM_TO_BCH' as const,
      userCounterAddress: '0x1111111111111111111111111111111111111111',
      termsJson: terms,
      createdAt: now - 120,
      updatedAt: now,
    };
    db.saveOrder({
      ...base,
      id: '0x' + 'd1'.repeat(32),
      status: 'DONE',
      lockId: '0x' + 'd1'.repeat(32),
      hashLock: '0x' + 'd1'.repeat(32),
      lane: 'safe',
      // far enough ahead to count towards the median whatever the date
      createdAt: 4_000_000_000 - 120,
      updatedAt: 4_000_000_000,
    });
    db.saveOrder({
      ...base,
      id: '0x' + 'd2'.repeat(32),
      status: 'USER_LOCK_FINAL',
      lockId: '0x' + 'd2'.repeat(32),
      hashLock: '0x' + 'd2'.repeat(32),
    });

    const stats = db.getStatsSummary(40, 0n);
    expect(stats.completedSwaps).toBe(1);
    expect(stats.volumeUsdMicros).toBe(990_000n);
    expect(stats.medianFastSeconds).toBe(120);

    const recent = db.getRecentSwaps(10);
    expect(recent).toHaveLength(1);
    expect(recent[0]?.counterAmount).toBe(1_000_000n);
    expect(recent[0]?.bchTokenAmount).toBe(99n);

    expect(db.getOpenExposureUsdMicros()).toBe(990_000n);

    // Swaps that began before the cut-off do not count towards the median.
    db.saveOrder({
      ...base,
      id: '0x' + 'd3'.repeat(32),
      status: 'DONE',
      lockId: '0x' + 'd3'.repeat(32),
      hashLock: '0x' + 'd3'.repeat(32),
      lane: 'safe',
      createdAt: 1_700_000_000,
      updatedAt: 1_700_003_566,
    });
    expect(db.getStatsSummary(40, 0n).medianFastSeconds).toBe(120);
    expect(db.getStatsSummary(40, 0n).completedSwaps).toBe(2);

    // A swap into Bitcoin Cash from Robinhood Chain waits about 15 minutes for that chain's
    // finality: it counts as a completed swap and in the volume, but not in the median.
    const robinhood = (id: string, direction: 'EVM_TO_BCH' | 'BCH_TO_EVM') =>
      db.saveOrder({
        ...base,
        direction,
        termsJson: JSON.stringify({
          evmAmount: '1000000n',
          bchTokenAmount: '99n',
          bchToken: 'PUSD',
          evmChainId: 4663,
          quoteExpiry: now + 300,
        }),
        id: '0x' + id.repeat(32),
        status: 'DONE',
        lockId: '0x' + id.repeat(32),
        hashLock: '0x' + id.repeat(32),
        lane: 'safe',
        createdAt: 4_000_000_000 - 900,
        updatedAt: 4_000_000_000,
      });
    robinhood('e1', 'EVM_TO_BCH');
    expect(db.getStatsSummary(40, 0n).medianFastSeconds).toBe(120);
    expect(db.getStatsSummary(40, 0n).completedSwaps).toBe(3);
    // Out of Bitcoin Cash to Robinhood Chain is quick and still counts.
    robinhood('e2', 'BCH_TO_EVM');
    expect(db.getStatsSummary(40, 0n).medianFastSeconds).toBe(510);
  });
});

describe('liquidity units', () => {
  it('open exposure in USD micros is converted to PUSD atoms before it is subtracted', async () => {
    const { exposureInAssetUnits } =
      await import('../src/pricing/liquidity.js');
    expect(exposureInAssetUnits('PUSD', 1_000_000n)).toBe(100n);
    expect(exposureInAssetUnits('tMUSD', 5_000_000n)).toBe(500n);
    expect(exposureInAssetUnits('USDC', 1_000_000n)).toBe(1_000_000n);
  });
});

describe('dollar figures for an 18-decimal token', () => {
  it('count a $5 BNB USDT swap as five dollars, in volume and in open exposure', () => {
    const db = new SolverDatabase(':memory:');
    const now = Math.floor(Date.now() / 1000);
    const terms = JSON.stringify({
      evmAmount: '4990000000000000000n',
      bchTokenAmount: '498n',
      bchToken: 'PUSD',
      evmChainId: 56,
    });
    const base = {
      direction: 'EVM_TO_BCH' as const,
      userCounterAddress: '0x1111111111111111111111111111111111111111',
      termsJson: terms,
      createdAt: now - 60,
      updatedAt: now,
    };
    db.saveOrder({
      ...base,
      id: '0x' + 'e1'.repeat(32),
      status: 'DONE',
      lockId: '0x' + 'e1'.repeat(32),
      hashLock: '0x' + 'e1'.repeat(32),
      lane: 'safe',
    });
    db.saveOrder({
      ...base,
      id: '0x' + 'e2'.repeat(32),
      status: 'USER_LOCK_FINAL',
      lockId: '0x' + 'e2'.repeat(32),
      hashLock: '0x' + 'e2'.repeat(32),
    });
    expect(db.getStatsSummary(40, 0n).volumeUsdMicros).toBe(4_980_000n);
    expect(db.getOpenExposureUsdMicros()).toBe(4_980_000n);
  });
});

describe('open exposure of a dead order', () => {
  it('ignores a forward order whose own deadline has passed', () => {
    const db = new SolverDatabase(':memory:');
    const now = Math.floor(Date.now() / 1000);
    const make = (id: string, deadline: number) =>
      db.saveOrder({
        id: '0x' + id.repeat(32),
        direction: 'EVM_TO_BCH',
        status: 'USER_LOCK_SEEN',
        userCounterAddress: '0x1111111111111111111111111111111111111111',
        lockId: '0x' + id.repeat(32),
        hashLock: '0x' + id.repeat(32),
        termsJson: JSON.stringify({
          evmAmount: '1000000n',
          bchTokenAmount: '99n',
          bchToken: 'PUSD',
          evmDeadline: deadline,
        }),
        createdAt: now - 100,
        updatedAt: now - 100,
      });
    make('f1', now - 3600);
    make('f2', now + 3600);
    expect(db.getOpenExposureUsdMicros()).toBe(990_000n);
  });
});
