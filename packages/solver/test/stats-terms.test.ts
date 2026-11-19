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
    expect(stats.volumeUsdMicros).toBe(1_000_000n);
    expect(stats.medianFastSeconds).toBe(120);

    const recent = db.getRecentSwaps(10);
    expect(recent).toHaveLength(1);
    expect(recent[0]?.counterAmount).toBe(1_000_000n);
    expect(recent[0]?.bchTokenAmount).toBe(99n);

    expect(db.getOpenExposureUsdMicros()).toBe(1_000_000n);
  });
});
