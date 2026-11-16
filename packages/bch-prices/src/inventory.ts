import type { BchStableToken } from './types.js';

export type RebalanceAction = 'HOLD' | 'BUY_TOKEN' | 'SELL_TOKEN';
export type RebalanceDirection = 'BCH_TO_TOKEN' | 'TOKEN_TO_BCH' | null;

export interface InventoryRebalanceInput {
  readonly bchToken: BchStableToken;
  /** Current on-chain token balance in base units (2 decimals for PUSD/MUSD). */
  readonly tokenBalance: bigint;
  /** Reserved token amount for open quotes/swaps in base units. */
  readonly tokenReserved: bigint;
  /** Current on-chain BCH balance in satoshis. */
  readonly bchSatsBalance: bigint;
  /** Reserved BCH satoshis (e.g. fees/carry/open locks). */
  readonly bchSatsReserved: bigint;
  /** Target available token inventory in base units. */
  readonly targetTokenBalance: bigint;
  /** Spot price in satoshis per 1 display token (10^tokenDecimals base units). */
  readonly bchPerTokenSats: bigint;
  readonly tokenDecimals?: number;
  /** Max allowed slippage in basis points (default 100 = 1%). */
  readonly maxSlippageBps?: number;
  /** Deadband around target in basis points (default 500 = 5%). */
  readonly deadbandBps?: number;
  /** Minimum trade size in token base units (default 100 = 1.00 token). */
  readonly minTradeTokenUnits?: bigint;
}

export interface InventoryRebalancePlan {
  readonly bchToken: BchStableToken;
  readonly action: RebalanceAction;
  readonly direction: RebalanceDirection;
  readonly availableToken: bigint;
  readonly availableBchSats: bigint;
  readonly amountToken: bigint;
  readonly estimatedBchSats: bigint;
  /** Minimum output expected (tokens for BUY_TOKEN, sats for SELL_TOKEN) with slippage cap. */
  readonly minOutAmount: bigint;
  /** Maximum input budget (sats for BUY_TOKEN, tokens for SELL_TOKEN) with slippage cap. */
  readonly maxInAmount: bigint;
  readonly maxSlippageBps: number;
  readonly cappedByAvailableBch: boolean;
  readonly reason:
    | 'WITHIN_TARGET_BAND'
    | 'BELOW_MIN_TRADE'
    | 'INSUFFICIENT_BCH'
    | 'REBALANCE_RECOMMENDED';
}

const BPS = 10_000n;

/**
 * Pure inventory rebalance planner for the operator view (PUSD/MUSD <-> BCH via Cauldron).
 * Produces a recommended direction, amount, and slippage-capped bounds; builds no transactions.
 */
export function planInventoryRebalance(
  input: InventoryRebalanceInput,
): InventoryRebalancePlan {
  const tokenDecimals = input.tokenDecimals ?? 2;
  const maxSlippageBps = input.maxSlippageBps ?? 100;
  const deadbandBps = input.deadbandBps ?? 500;
  const minTradeTokenUnits = input.minTradeTokenUnits ?? 100n;

  if (
    !Number.isInteger(maxSlippageBps) ||
    maxSlippageBps < 0 ||
    maxSlippageBps >= 10_000
  ) {
    throw new RangeError(`Invalid maxSlippageBps: ${String(maxSlippageBps)}`);
  }
  if (
    !Number.isInteger(deadbandBps) ||
    deadbandBps < 0 ||
    deadbandBps > 10_000
  ) {
    throw new RangeError(`Invalid deadbandBps: ${String(deadbandBps)}`);
  }
  if (input.bchPerTokenSats <= 0n) {
    throw new RangeError('bchPerTokenSats must be positive');
  }
  if (input.targetTokenBalance < 0n) {
    throw new RangeError('targetTokenBalance must be non-negative');
  }

  const tokenScale = 10n ** BigInt(tokenDecimals);
  const availableToken =
    input.tokenBalance > input.tokenReserved
      ? input.tokenBalance - input.tokenReserved
      : 0n;
  const availableBchSats =
    input.bchSatsBalance > input.bchSatsReserved
      ? input.bchSatsBalance - input.bchSatsReserved
      : 0n;

  const delta = input.targetTokenBalance - availableToken;
  const absDelta = delta >= 0n ? delta : -delta;
  const deadbandUnits = (input.targetTokenBalance * BigInt(deadbandBps)) / BPS;

  if (absDelta <= deadbandUnits) {
    return {
      bchToken: input.bchToken,
      action: 'HOLD',
      direction: null,
      availableToken,
      availableBchSats,
      amountToken: 0n,
      estimatedBchSats: 0n,
      minOutAmount: 0n,
      maxInAmount: 0n,
      maxSlippageBps,
      cappedByAvailableBch: false,
      reason: 'WITHIN_TARGET_BAND',
    };
  }

  if (absDelta < minTradeTokenUnits) {
    return {
      bchToken: input.bchToken,
      action: 'HOLD',
      direction: null,
      availableToken,
      availableBchSats,
      amountToken: 0n,
      estimatedBchSats: 0n,
      minOutAmount: 0n,
      maxInAmount: 0n,
      maxSlippageBps,
      cappedByAvailableBch: false,
      reason: 'BELOW_MIN_TRADE',
    };
  }

  const slip = BigInt(maxSlippageBps);

  if (delta > 0n) {
    // Need more PUSD/MUSD -> buy token with BCH
    const rawEstSats = (delta * input.bchPerTokenSats) / tokenScale;
    const rawMaxBchIn = (rawEstSats * (BPS + slip)) / BPS;

    if (availableBchSats === 0n) {
      return {
        bchToken: input.bchToken,
        action: 'HOLD',
        direction: null,
        availableToken,
        availableBchSats,
        amountToken: 0n,
        estimatedBchSats: 0n,
        minOutAmount: 0n,
        maxInAmount: 0n,
        maxSlippageBps,
        cappedByAvailableBch: true,
        reason: 'INSUFFICIENT_BCH',
      };
    }

    if (rawMaxBchIn > availableBchSats) {
      const maxEstSats = (availableBchSats * BPS) / (BPS + slip);
      const cappedToken = (maxEstSats * tokenScale) / input.bchPerTokenSats;
      if (cappedToken < minTradeTokenUnits) {
        return {
          bchToken: input.bchToken,
          action: 'HOLD',
          direction: null,
          availableToken,
          availableBchSats,
          amountToken: 0n,
          estimatedBchSats: 0n,
          minOutAmount: 0n,
          maxInAmount: 0n,
          maxSlippageBps,
          cappedByAvailableBch: true,
          reason: 'INSUFFICIENT_BCH',
        };
      }
      return {
        bchToken: input.bchToken,
        action: 'BUY_TOKEN',
        direction: 'BCH_TO_TOKEN',
        availableToken,
        availableBchSats,
        amountToken: cappedToken,
        estimatedBchSats: maxEstSats,
        minOutAmount: cappedToken,
        maxInAmount: availableBchSats,
        maxSlippageBps,
        cappedByAvailableBch: true,
        reason: 'REBALANCE_RECOMMENDED',
      };
    }

    return {
      bchToken: input.bchToken,
      action: 'BUY_TOKEN',
      direction: 'BCH_TO_TOKEN',
      availableToken,
      availableBchSats,
      amountToken: delta,
      estimatedBchSats: rawEstSats,
      minOutAmount: delta,
      maxInAmount: rawMaxBchIn,
      maxSlippageBps,
      cappedByAvailableBch: false,
      reason: 'REBALANCE_RECOMMENDED',
    };
  }

  // Surplus PUSD/MUSD -> sell token for BCH
  const sellAmount = -delta;
  const estBchOut = (sellAmount * input.bchPerTokenSats) / tokenScale;
  const minBchOut = (estBchOut * (BPS - slip)) / BPS;

  return {
    bchToken: input.bchToken,
    action: 'SELL_TOKEN',
    direction: 'TOKEN_TO_BCH',
    availableToken,
    availableBchSats,
    amountToken: sellAmount,
    estimatedBchSats: estBchOut,
    minOutAmount: minBchOut,
    maxInAmount: sellAmount,
    maxSlippageBps,
    cappedByAvailableBch: false,
    reason: 'REBALANCE_RECOMMENDED',
  };
}
