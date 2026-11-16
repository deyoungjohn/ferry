import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PEG_TOLERANCE_MICROS,
  evaluatePegGuard,
  planInventoryRebalance,
} from '../src/index.js';

const NOW = 1_794_835_200;

describe('evaluatePegGuard', () => {
  it('returns ok when readings are within warn threshold and spread', () => {
    const res = evaluatePegGuard({
      readings: [
        { usdPrice: 998_500n, source: 'cauldron', asOf: NOW - 5 },
        { usdPrice: 999_200n, source: 'paryon', asOf: NOW - 3 },
      ],
      nowSeconds: NOW,
      maxAgeSeconds: 30,
    });
    expect(res.status).toBe('ok');
    expect(res.maxPegDeviationMicros).toBe(1_500n);
    expect(res.maxSpreadMicros).toBe(700n);
  });

  it('returns warn when approaching tolerance (>= 0.5% and <= 1%)', () => {
    const res = evaluatePegGuard({
      readings: [{ usdPrice: 993_000n, source: 'cauldron', asOf: NOW }],
    });
    expect(res.status).toBe('warn');
    expect(res.reason).toBe('APPROACHING_TOLERANCE');
    expect(res.deviationMicros).toBe(7_000n);
  });

  it('refuses on empty, invalid, stale, peg deviation, or source divergence', () => {
    expect(evaluatePegGuard({ readings: [] })).toMatchObject({
      status: 'refuse',
      reason: 'NO_READINGS',
    });

    expect(
      evaluatePegGuard({
        readings: [{ usdPrice: 0n, source: 'cauldron', asOf: NOW }],
      }),
    ).toMatchObject({ status: 'refuse', reason: 'INVALID_PRICE' });

    expect(
      evaluatePegGuard({
        readings: [
          { usdPrice: 1_000_000n, source: 'cauldron', asOf: NOW - 60 },
        ],
        maxAgeSeconds: 30,
        nowSeconds: NOW,
      }),
    ).toMatchObject({ status: 'refuse', reason: 'STALE_READING' });

    expect(
      evaluatePegGuard({
        readings: [
          {
            usdPrice: 1_000_000n - DEFAULT_PEG_TOLERANCE_MICROS - 1n,
            source: 'cauldron',
            asOf: NOW,
          },
        ],
      }),
    ).toMatchObject({ status: 'refuse', reason: 'PEG_DEVIATION' });

    expect(
      evaluatePegGuard({
        readings: [
          { usdPrice: 994_000n, source: 'cauldron', asOf: NOW },
          { usdPrice: 1_006_000n, source: 'paryon', asOf: NOW },
        ],
      }),
    ).toMatchObject({ status: 'refuse', reason: 'SOURCE_DIVERGENCE' });
  });
});

describe('planInventoryRebalance', () => {
  const bchPerTokenSats = 485_000n; // ~0.00485 BCH per PUSD

  it('holds when available token balance is within target deadband', () => {
    const plan = planInventoryRebalance({
      bchToken: 'PUSD',
      tokenBalance: 102_000n, // 1020 PUSD
      tokenReserved: 0n,
      bchSatsBalance: 500_000_000n,
      bchSatsReserved: 0n,
      targetTokenBalance: 100_000n, // 1000 PUSD (5% deadband = 5000)
      bchPerTokenSats,
    });
    expect(plan.action).toBe('HOLD');
    expect(plan.direction).toBeNull();
    expect(plan.reason).toBe('WITHIN_TARGET_BAND');
  });

  it('recommends BUY_TOKEN with slippage cap when below target', () => {
    const plan = planInventoryRebalance({
      bchToken: 'PUSD',
      tokenBalance: 60_000n, // 600 PUSD
      tokenReserved: 10_000n, // 100 reserved -> 500 available
      bchSatsBalance: 500_000_000n,
      bchSatsReserved: 0n,
      targetTokenBalance: 100_000n, // 1000 target -> need 500 PUSD
      bchPerTokenSats,
      maxSlippageBps: 100,
    });
    expect(plan.action).toBe('BUY_TOKEN');
    expect(plan.direction).toBe('BCH_TO_TOKEN');
    expect(plan.amountToken).toBe(50_000n);
    expect(plan.estimatedBchSats).toBe(242_500_000n);
    expect(plan.maxInAmount).toBe(244_925_000n);
    expect(plan.cappedByAvailableBch).toBe(false);
  });

  it('caps BUY_TOKEN by available BCH and holds when BCH is insufficient', () => {
    const capped = planInventoryRebalance({
      bchToken: 'PUSD',
      tokenBalance: 0n,
      tokenReserved: 0n,
      bchSatsBalance: 100_000_000n, // 1 BCH
      bchSatsReserved: 0n,
      targetTokenBalance: 100_000n,
      bchPerTokenSats,
      maxSlippageBps: 100,
    });
    expect(capped.action).toBe('BUY_TOKEN');
    expect(capped.cappedByAvailableBch).toBe(true);
    expect(capped.maxInAmount).toBe(100_000_000n);

    const noBch = planInventoryRebalance({
      bchToken: 'PUSD',
      tokenBalance: 0n,
      tokenReserved: 0n,
      bchSatsBalance: 10_000n,
      bchSatsReserved: 10_000n,
      targetTokenBalance: 100_000n,
      bchPerTokenSats,
    });
    expect(noBch.action).toBe('HOLD');
    expect(noBch.reason).toBe('INSUFFICIENT_BCH');
  });

  it('recommends SELL_TOKEN with minBchOut slippage cap when above target', () => {
    const plan = planInventoryRebalance({
      bchToken: 'MUSD',
      tokenBalance: 150_000n, // 1500 MUSD
      tokenReserved: 0n,
      bchSatsBalance: 100_000_000n,
      bchSatsReserved: 0n,
      targetTokenBalance: 100_000n, // sell 500 MUSD
      bchPerTokenSats,
      maxSlippageBps: 100,
    });
    expect(plan.action).toBe('SELL_TOKEN');
    expect(plan.direction).toBe('TOKEN_TO_BCH');
    expect(plan.amountToken).toBe(50_000n);
    expect(plan.estimatedBchSats).toBe(242_500_000n);
    expect(plan.minOutAmount).toBe(240_075_000n);
  });
});
