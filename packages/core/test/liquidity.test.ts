import { describe, expect, it } from 'vitest';
import {
  availableLiquidity,
  pruneExpiredReservations,
  reservedByAddress,
  tryReserveLiquidity,
  type LiquidityReservation,
} from '../src/index.js';

describe('liquidity math and reservation ledger', () => {
  const now = 1_794_764_200;
  const ledger: LiquidityReservation[] = [
    { id: 'r1', address: '0xaaa', amount: 1500n, expiresAt: now + 30 },
    { id: 'r2', address: '0xbbb', amount: 1000n, expiresAt: now - 1 }, // expired
    { id: 'r3', address: '0xAAA', amount: 500n, expiresAt: now + 60 },
  ];

  it('computes availableLiquidity = max(0, inventory - exposure - activeReservations - floor)', () => {
    expect(availableLiquidity(10_000n, 2_000n, 1_500n, 500n)).toBe(6_000n);
    expect(availableLiquidity(2_000n, 2_000n, 500n, 500n)).toBe(0n);

    // With reservation ledger and current timestamp, expired r2 is ignored
    expect(availableLiquidity(10_000n, 2_000n, ledger, 500n, now)).toBe(5_500n);
  });

  it('prunes expired reservations and sums per-address active reservations case-insensitively', () => {
    const active = pruneExpiredReservations(ledger, now);
    expect(active.map((r) => r.id)).toEqual(['r1', 'r3']);
    expect(reservedByAddress(ledger, '0xaaa', now)).toBe(2000n);
    expect(reservedByAddress(ledger, '0xbbb', now)).toBe(0n);
  });

  it('enforces available liquidity and per-address reservation cap in tryReserveLiquidity', () => {
    const policy = { ttlSeconds: 60, maxReservedPerAddress: 2500n };

    const ok = tryReserveLiquidity(
      ledger,
      { id: 'r4', address: '0xaaa', amount: 500n },
      10_000n,
      2_000n,
      500n,
      policy,
      now,
    );
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.reservation.expiresAt).toBe(now + 60);
      expect(reservedByAddress(ok.ledger, '0xaaa', now)).toBe(2500n);
    }

    const capHit = tryReserveLiquidity(
      ledger,
      { id: 'r5', address: '0xaaa', amount: 501n },
      10_000n,
      2_000n,
      500n,
      policy,
      now,
    );
    expect(capHit).toEqual({
      ok: false,
      reason: 'ADDRESS_CAP_EXCEEDED',
      available: 5500n,
      addressRemaining: 500n,
    });

    const liqHit = tryReserveLiquidity(
      ledger,
      { id: 'r6', address: '0xccc', amount: 6000n },
      10_000n,
      2_000n,
      500n,
      { ttlSeconds: 60, maxReservedPerAddress: 10_000n },
      now,
    );
    expect(liqHit).toEqual({
      ok: false,
      reason: 'INSUFFICIENT_LIQUIDITY',
      available: 5500n,
      addressRemaining: 10_000n,
    });
  });
});
