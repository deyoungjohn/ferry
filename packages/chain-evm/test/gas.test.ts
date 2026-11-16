import { describe, expect, it } from 'vitest';
import { relayCostUsd } from '../src/index.js';

describe('relayCostUsd', () => {
  it('computes USD relay cost from gas, gasPriceWei, and nativeUsd inputs', () => {
    // 258,166 gas * 0.05 gwei (50_000_000 wei) * $3000/ETH = 0.0387249 USD
    const cost = relayCostUsd(258_166n, 50_000_000n, 3000);
    expect(cost).toBeCloseTo(0.0387249, 7);

    // With L1 data fee included
    const withL1 = relayCostUsd(258_166n, 50_000_000n, 3000, 0.01);
    expect(withL1).toBeCloseTo(0.0487249, 7);

    // Zero gas or zero price yields zero
    expect(relayCostUsd(0n, 50_000_000n, 3000)).toBe(0);
    expect(relayCostUsd(258_166n, 0n, 3000)).toBe(0);
  });

  it('rejects negative or non-finite inputs', () => {
    expect(() => relayCostUsd(-1n, 1n, 3000)).toThrow(RangeError);
    expect(() => relayCostUsd(1n, -1n, 3000)).toThrow(RangeError);
    expect(() => relayCostUsd(1n, 1n, -1)).toThrow(RangeError);
    expect(() => relayCostUsd(1n, 1n, Number.NaN)).toThrow(RangeError);
    expect(() => relayCostUsd(1n, 1n, 3000, -0.01)).toThrow(RangeError);
  });
});
