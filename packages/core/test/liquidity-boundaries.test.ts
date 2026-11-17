import { describe, expect, it } from 'vitest';
import {
  availableLiquidity,
  pruneExpiredReservations,
  reservedByAddress,
  tryReserveLiquidity,
  type LiquidityReservation,
} from '../src/index.js';

const now = 1_000;
const policy = { ttlSeconds: 60, maxReservedPerAddress: 1000n };
const reserve = (
  amount: bigint,
  ledger: readonly LiquidityReservation[] = [],
  inventory = 10_000n,
  p = policy,
  address = '0xAbC',
) =>
  tryReserveLiquidity(
    ledger,
    { id: 'new', address, amount },
    inventory,
    0n,
    0n,
    p,
    now,
  );

describe('liquidity boundaries', () => {
  it('treats a reservation expiring exactly now as expired', () => {
    const ledger: LiquidityReservation[] = [
      { id: 'a', address: '0x1', amount: 5n, expiresAt: now },
      { id: 'b', address: '0x1', amount: 7n, expiresAt: now + 1 },
    ];
    expect(pruneExpiredReservations(ledger, now).map((r) => r.id)).toEqual([
      'b',
    ]);
    expect(reservedByAddress(ledger, '0x1', now)).toBe(7n);
    expect(availableLiquidity(100n, 0n, ledger, 0n, now)).toBe(93n);
  });

  it('accepts zero and rejects negative or non-integer seconds, with named messages', () => {
    expect(() => pruneExpiredReservations([], 0)).toThrow(
      'nowSeconds must be a positive integer in seconds',
    );
    expect(() => pruneExpiredReservations([], -1)).toThrow(RangeError);
    expect(() => pruneExpiredReservations([], 1.5)).toThrow(
      'nowSeconds must be a positive integer in seconds',
    );
    expect(() => pruneExpiredReservations([], 1)).not.toThrow();
    expect(() => reserve(1n, [], 10n, { ...policy, ttlSeconds: 0 })).toThrow(
      'policy.ttlSeconds must be a positive integer in seconds',
    );
    expect(() => reserve(1n, [], 10n, { ...policy, ttlSeconds: 2.5 })).toThrow(
      'policy.ttlSeconds',
    );
  });

  it('accepts zero but rejects negative inputs, naming the argument', () => {
    expect(availableLiquidity(0n, 0n, 0n, 0n)).toBe(0n);
    expect(() => availableLiquidity(-1n, 0n, 0n)).toThrow(
      'inventory must be non-negative',
    );
    expect(() => availableLiquidity(1n, -1n, 0n)).toThrow(
      'exposure must be non-negative',
    );
    expect(() => availableLiquidity(1n, 0n, -1n)).toThrow(
      'reservations must be non-negative',
    );
    expect(() => availableLiquidity(1n, 0n, 0n, -1n)).toThrow(
      'floor must be non-negative',
    );
    const bad: LiquidityReservation[] = [
      { id: 'x', address: '0x1', amount: -1n, expiresAt: now + 1 },
    ];
    expect(() => availableLiquidity(10n, 0n, bad)).toThrow(
      'reservation.amount must be non-negative',
    );
    expect(() => reservedByAddress(bad, '0x1', now)).toThrow(
      'reservation.amount must be non-negative',
    );
    expect(() => reserve(-1n)).toThrow('request.amount must be non-negative');
    expect(() => reserve(0n)).toThrow('request.amount must be positive');
    expect(() =>
      reserve(1n, [], 10n, { ...policy, maxReservedPerAddress: -1n }),
    ).toThrow('policy.maxReservedPerAddress must be non-negative');
    expect(
      reserve(1n, [], 10n, { ...policy, maxReservedPerAddress: 0n }),
    ).toMatchObject({ ok: false, reason: 'ADDRESS_CAP_EXCEEDED' });
  });

  it('available is zero when committed equals inventory, and positive just below', () => {
    expect(availableLiquidity(100n, 60n, 30n, 10n)).toBe(0n);
    expect(availableLiquidity(100n, 60n, 30n, 9n)).toBe(1n);
    expect(availableLiquidity(100n, 60n, 30n, 11n)).toBe(0n);
  });

  it('allows a request exactly equal to available liquidity, rejects one more', () => {
    expect(reserve(1000n, [], 1000n).ok).toBe(true);
    expect(reserve(1001n, [], 1000n)).toMatchObject({
      ok: false,
      reason: 'INSUFFICIENT_LIQUIDITY',
      available: 1000n,
    });
  });

  it('allows a request exactly equal to the remaining address cap, rejects one more', () => {
    const ledger: LiquidityReservation[] = [
      { id: 'a', address: '0xabc', amount: 400n, expiresAt: now + 10 },
    ];
    expect(reserve(600n, ledger).ok).toBe(true);
    expect(reserve(601n, ledger)).toMatchObject({
      ok: false,
      reason: 'ADDRESS_CAP_EXCEEDED',
      addressRemaining: 600n,
    });
  });

  it('reports zero remaining when the address is exactly at its cap', () => {
    const ledger: LiquidityReservation[] = [
      { id: 'a', address: '0xabc', amount: 1000n, expiresAt: now + 10 },
    ];
    expect(reserve(1n, ledger)).toMatchObject({
      ok: false,
      reason: 'ADDRESS_CAP_EXCEEDED',
      addressRemaining: 0n,
    });
  });

  it('stores the reservation lower-cased and expiring ttl seconds after now', () => {
    const result = reserve(10n, [], 10_000n, policy, '0xAbC');
    if (!result.ok) throw new Error('expected success');
    expect(result.reservation).toEqual({
      id: 'new',
      address: '0xabc',
      amount: 10n,
      expiresAt: now + 60,
    });
    expect(result.ledger).toEqual([result.reservation]);
  });

  it('matches addresses case-insensitively in both directions', () => {
    const ledger: LiquidityReservation[] = [
      { id: 'a', address: '0xABC', amount: 3n, expiresAt: now + 10 },
      { id: 'b', address: '0xdef', amount: 9n, expiresAt: now + 10 },
    ];
    expect(reservedByAddress(ledger, '0xabc', now)).toBe(3n);
    expect(reservedByAddress(ledger, '0xAbC', now)).toBe(3n);
    expect(reservedByAddress(ledger, '0xDEF', now)).toBe(9n);
  });
});
