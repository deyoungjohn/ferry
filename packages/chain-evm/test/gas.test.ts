import { describe, expect, it } from 'vitest';
import {
  estimateDeployFunding,
  formatDeployFundingTable,
  relayCostUsd,
} from '../src/index.js';

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

describe('estimateDeployFunding', () => {
  it('computes required wei, formatted native units, and optional USD across chains', () => {
    const est = estimateDeployFunding({
      chain: 'base',
      nativeGasSymbol: 'ETH',
      deployGas: 1_250_000n,
      gasPriceWei: 50_000_000n, // 0.05 gwei
      safetyMarginBps: 2000, // +20%
      nativeUsd: 3000,
    });

    // 1_250_000 * 50_000_000 = 62_500_000_000_000 wei; * 1.2 = 75_000_000_000_000 wei
    expect(est.requiredWei).toBe(75_000_000_000_000n);
    expect(est.requiredNative).toBe('0.000075');
    expect(est.estimatedUsd).toBeCloseTo(0.225, 6);

    const table = formatDeployFundingTable([est]);
    expect(table).toContain('base | ETH | 1250000 | 50000000 | 0.000075 ETH');
    expect(table).toContain('$0.2250');
  });

  it('rejects invalid gas or safety margin inputs', () => {
    expect(() =>
      estimateDeployFunding({
        chain: 'bnb',
        nativeGasSymbol: 'BNB',
        deployGas: -1n,
        gasPriceWei: 1n,
      }),
    ).toThrow(RangeError);
    expect(() =>
      estimateDeployFunding({
        chain: 'bnb',
        nativeGasSymbol: 'BNB',
        deployGas: 1_000_000n,
        gasPriceWei: 1n,
        safetyMarginBps: -5,
      }),
    ).toThrow(RangeError);
  });
});
