import { describe, expect, it } from 'vitest';
import { SolverDatabase } from '../src/db/database.js';

describe('recent swaps leave out link orders', () => {
  it('lists a plain swap but not a pay link or send link order', () => {
    const db = new SolverDatabase();
    const now = Math.floor(Date.now() / 1000);
    const make = (id: string, extra: Record<string, unknown> = {}) =>
      db.saveOrder({
        id,
        direction: 'COUNTER_TO_BCH',
        status: 'DONE',
        userCounterAddress: '0xuser',
        lockId: '0x' + id,
        termsJson: '{}',
        hashLock: '0x' + id,
        createdAt: now,
        updatedAt: now,
        ...extra,
      } as never);
    make('plain');
    make('paylink', { payLinkId: 'pl-1' });
    make('sendlink');
    db.markSendLinkOrder('sendlink');
    const ids = db.getRecentSwaps(50).map((s) => s.orderId);
    expect(ids).toEqual(['plain']);
  });
});
