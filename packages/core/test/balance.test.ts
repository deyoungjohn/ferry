import { describe, expect, it } from 'vitest';
import {
  checkBalanceShortfall,
  formatTokenUnits,
  sumUtxoBalances,
} from '../src/index.js';

describe('balance and shortfall helpers', () => {
  const catA = 'aa'.repeat(32);
  const catB = 'bb'.repeat(32);

  it('sums satoshis and token amounts from a UTXO list', () => {
    const utxos = [
      { satoshis: 1000n },
      { satoshis: 2000n, token: { category: catA, amount: 150n } },
      {
        satoshis: 800n,
        token: { category: `0x${catA.toUpperCase()}`, amount: 38n },
      },
      { satoshis: 800n, token: { category: catB, amount: 999n } },
    ];

    expect(sumUtxoBalances(utxos, catA)).toEqual({
      satoshis: 4600n,
      tokenAmount: 188n,
    });
    expect(sumUtxoBalances(utxos, catB)).toEqual({
      satoshis: 4600n,
      tokenAmount: 999n,
    });
    expect(sumUtxoBalances(utxos)).toEqual({
      satoshis: 4600n,
      tokenAmount: 1187n,
    });
  });

  it('formats token units for arbitrary decimals', () => {
    expect(formatTokenUnits(500n, 2)).toBe('5.00');
    expect(formatTokenUnits(188n, 2)).toBe('1.88');
    expect(formatTokenUnits(5n, 2)).toBe('0.05');
    expect(formatTokenUnits(0n, 2)).toBe('0.00');
    expect(formatTokenUnits(1_500_000n, 6)).toBe('1.500000');
    expect(formatTokenUnits(42n, 0)).toBe('42');
    expect(() => formatTokenUnits(-1n, 2)).toThrow(RangeError);
    expect(() => formatTokenUnits(1n, -1)).toThrow(RangeError);
  });

  it('reports balance shortfalls with readable messages', () => {
    expect(
      checkBalanceShortfall({
        required: 500n,
        available: 500n,
        decimals: 2,
        symbol: 'tPUSD',
      }),
    ).toEqual({
      sufficient: true,
      shortfall: 0n,
      message: null,
    });

    expect(
      checkBalanceShortfall({
        required: 500n,
        available: 188n,
        decimals: 2,
        symbol: 'tPUSD',
      }),
    ).toEqual({
      sufficient: false,
      shortfall: 312n,
      message: 'You need 5.00 tPUSD; this wallet has 1.88',
    });
  });
});
