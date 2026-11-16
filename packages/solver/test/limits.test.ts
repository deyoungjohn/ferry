import { describe, expect, it } from 'vitest';
import {
  calculateOpenExposureUsdMicros,
  countGlobalUnfundedQuotes,
  countUnfundedQuotesByAddress,
  isExposureWithinCap,
  isInventoryAboveFloor,
  isUnfundedQuoteAllowed,
} from '../src/engine/limits.js';

describe('Exposure and limits pure functions', () => {
  describe('calculateOpenExposureUsdMicros', () => {
    it('does NOT count QUOTED orders toward exposure until user lock is seen', () => {
      const orders = [
        { status: 'QUOTED', amountUsdMicros: 25_000_000n },
        { status: 'QUOTED', amountUsdMicros: 50_000_000n },
      ];
      expect(calculateOpenExposureUsdMicros(orders)).toBe(0n);
    });

    it('counts orders from USER_LOCK_SEEN up to SOLVER_CLAIM_FINAL', () => {
      const orders = [
        { status: 'QUOTED', amountUsdMicros: 10_000_000n },
        { status: 'USER_LOCK_SEEN', amountUsdMicros: 20_000_000n },
        { status: 'USER_LOCK_FINAL', amountUsdMicros: 30_000_000n },
        { status: 'SOLVER_LOCK_BROADCAST', amountUsdMicros: 15_000_000n },
        { status: 'SOLVER_LOCK_SEEN', amountUsdMicros: 25_000_000n },
        { status: 'SECRET_KNOWN', amountUsdMicros: 5_000_000n },
        { status: 'USER_CLAIM_SEEN', amountUsdMicros: 12_000_000n },
        { status: 'SOLVER_CLAIM_BROADCAST', amountUsdMicros: 18_000_000n },
        { status: 'SOLVER_CLAIM_FINAL', amountUsdMicros: 22_000_000n },
      ];
      // Sum: 20 + 30 + 15 + 25 + 5 + 12 + 18 + 22 = 147M
      expect(calculateOpenExposureUsdMicros(orders)).toBe(147_000_000n);
    });

    it('excludes terminal states (DONE, EXPIRED, REJECTED, SOLVER_REFUNDED)', () => {
      const orders = [
        { status: 'DONE', amountUsdMicros: 100_000_000n },
        { status: 'EXPIRED', amountUsdMicros: 50_000_000n },
        { status: 'REJECTED', amountUsdMicros: 20_000_000n },
        { status: 'SOLVER_REFUNDED', amountUsdMicros: 30_000_000n },
        { status: 'USER_LOCK_FINAL', amountUsdMicros: 25_000_000n },
      ];
      expect(calculateOpenExposureUsdMicros(orders)).toBe(25_000_000n);
    });
  });

  describe('isExposureWithinCap', () => {
    it('returns true when new order does not exceed cap, false otherwise', () => {
      const maxCap = 100_000_000n; // $100
      expect(isExposureWithinCap(70_000_000n, 30_000_000n, maxCap)).toBe(true);
      expect(isExposureWithinCap(70_000_000n, 30_000_001n, maxCap)).toBe(false);
      expect(isExposureWithinCap(100_000_000n, 1n, maxCap)).toBe(false);
    });
  });

  describe('isInventoryAboveFloor', () => {
    it('enforces per-token inventory floor', () => {
      const floor = 10_000_000n; // 10 units
      // Current 50, locking 30 -> remaining 20 >= 10 -> true
      expect(isInventoryAboveFloor(50_000_000n, 30_000_000n, floor)).toBe(true);
      // Current 50, locking 40 -> remaining 10 >= 10 -> true
      expect(isInventoryAboveFloor(50_000_000n, 40_000_000n, floor)).toBe(true);
      // Current 50, locking 41 -> remaining 9 < 10 -> false
      expect(isInventoryAboveFloor(50_000_000n, 41_000_000n, floor)).toBe(
        false,
      );
      // Current balance less than amount to lock
      expect(isInventoryAboveFloor(30_000_000n, 40_000_000n, floor)).toBe(
        false,
      );
    });
  });

  describe('unfunded quote counting and cap', () => {
    const now = 1000;
    const quotes = [
      { userAddress: '0xAlice', status: 'QUOTED', quoteExpiry: 1050 }, // active alice
      { userAddress: '0xALICE', status: 'QUOTED', quoteExpiry: 1100 }, // active alice (case-insensitive)
      { userAddress: '0xAlice', status: 'QUOTED', quoteExpiry: 950 }, // expired alice
      { userAddress: '0xAlice', status: 'USER_LOCK_FINAL', quoteExpiry: 1200 }, // locked, not QUOTED
      { userAddress: '0xBob', status: 'QUOTED', quoteExpiry: 1020 }, // active bob
    ];

    it('counts active unexpired unfunded quotes per address (case-insensitive)', () => {
      expect(countUnfundedQuotesByAddress(quotes, '0xalice', now)).toBe(2);
      expect(countUnfundedQuotesByAddress(quotes, '0xbob', now)).toBe(1);
      expect(countUnfundedQuotesByAddress(quotes, '0xcharlie', now)).toBe(0);
    });

    it('counts total active unexpired unfunded quotes globally', () => {
      expect(countGlobalUnfundedQuotes(quotes, now)).toBe(3);
    });

    it('enforces unfunded quote cap per address and globally', () => {
      const caps = { maxPerAddress: 3, maxGlobal: 5 };
      expect(isUnfundedQuoteAllowed(2, 3, caps)).toBe(true);
      expect(isUnfundedQuoteAllowed(3, 3, caps)).toBe(false); // hits address cap
      expect(isUnfundedQuoteAllowed(1, 5, caps)).toBe(false); // hits global cap
    });
  });
});
