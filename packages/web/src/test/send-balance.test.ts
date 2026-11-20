import { describe, expect, it } from 'vitest';
import { floorUnitsToText } from '../lib/wallet/send-balance';

describe('floorUnitsToText', () => {
  it('cuts off, never rounds up: 24.9875 is 24.98, not 24.99', () => {
    expect(floorUnitsToText(24_987_500n, 6, 2)).toBe('24.98');
    expect(floorUnitsToText(24_990_000n, 6, 2)).toBe('24.99');
    expect(floorUnitsToText(999_999n, 6, 2)).toBe('0.99');
    expect(floorUnitsToText(1_000_000n, 6, 2)).toBe('1.00');
    expect(floorUnitsToText(2_487n, 2, 2)).toBe('24.87');
    expect(floorUnitsToText(5n, 0, 2)).toBe('5');
  });
});
