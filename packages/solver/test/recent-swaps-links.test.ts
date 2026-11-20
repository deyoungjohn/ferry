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

  const save = (
    db: SolverDatabase,
    id: string,
    bytecode: string,
    extra: Record<string, unknown> = {},
  ) => {
    const now = Math.floor(Date.now() / 1000);
    db.saveOrder({
      id,
      direction: 'EVM_TO_BCH',
      status: 'DONE',
      userCounterAddress: '0xuser',
      lockId: '0x' + id,
      termsJson: JSON.stringify({
        bchToken: 'PUSD',
        bchTokenAmount: '195n',
        evmAmount: '1960000n',
        userBchLockingBytecode: bytecode,
      }),
      hashLock: '0x' + id,
      createdAt: now,
      updatedAt: now,
      ...extra,
    } as never);
  };
  const makeLink = (db: SolverDatabase, recipient: string, createdAt: number) =>
    db.savePayLink({
      id: 'pl-real',
      kind: 'open',
      recipientCashaddr: 'bitcoincash:zq',
      recipientLockingBytecode: recipient,
      token: 'PUSD',
      status: 'open',
      verified: true,
      createdAt,
      updatedAt: createdAt,
    } as never);
  const recipient = '0x76a914' + '11'.repeat(20) + '88ac';

  it('a link made after marking began is tied only to a swap that carries its mark', () => {
    const db = new SolverDatabase();
    const now = Math.floor(Date.now() / 1000);
    db.setSetting('pay_link_tagging_from', String(now - 1000));
    makeLink(db, recipient, now - 100);
    // The owner's own plain swap to the same address: not the link's payment.
    save(db, 'ownswap', recipient);
    expect(db.getRecentSwaps(50).map((s) => s.orderId)).toEqual(['ownswap']);
    expect(db.findOrderForPayLink(db.getPayLink('pl-real')!)).toBeNull();
    // The payment that names the link.
    save(db, 'linkpay', recipient, { payLinkId: 'pl-real' });
    expect(db.findOrderForPayLink(db.getPayLink('pl-real')!)?.id).toBe(
      'linkpay',
    );
    expect(db.getRecentSwaps(50).map((s) => s.orderId)).toEqual(['ownswap']);
  });

  it('a link made before marking hides only the order the product attached to it', () => {
    const db = new SolverDatabase();
    const now = Math.floor(Date.now() / 1000);
    makeLink(db, recipient, now - 100);
    save(db, 'oldpay', recipient);
    save(db, 'otherown', recipient);
    db.setSetting('pay_link_tagging_from', String(now + 10));
    const link = db.getPayLink('pl-real')!;
    expect(db.findOrderForPayLink(link)?.id).toBeDefined();
    // The product attached one order to the link (stored when the page read it): only that one is
    // hidden; the owner's other swap to the same address stays in the list.
    db.savePayLink({ ...link, orderId: 'oldpay', status: 'paid' } as never);
    expect(db.getRecentSwaps(50).map((s) => s.orderId)).toEqual(['otherown']);
  });
});
