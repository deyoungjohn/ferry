import type { Direction } from './terms.js';

const USD_SCALE = 1_000_000n;
const BPS = 10_000n;

export interface PricingPolicy {
  spreadBps: number;
  fixedFeeUsdMicros: bigint;
}

function units(decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
    throw new RangeError('Decimals must be an integer from 0 to 36');
  }
  return 10n ** BigInt(decimals);
}

function assertNonNegative(amount: bigint): void {
  if (amount < 0n) throw new RangeError('Negative amount');
}

function assertValidSpread(value: number): void {
  if (!Number.isInteger(value) || value < 0 || value >= 10_000) {
    throw new RangeError('Invalid spreadBps');
  }
}

function validatePolicy(policy: PricingPolicy): void {
  assertValidSpread(policy.spreadBps);
  assertNonNegative(policy.fixedFeeUsdMicros);
}

function divCeil(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator - 1n) / denominator;
}

export function convertFloor(
  amount: bigint,
  fromDecimals: number,
  toDecimals: number,
): bigint {
  assertNonNegative(amount);
  return (amount * units(toDecimals)) / units(fromDecimals);
}

export function convertCeil(
  amount: bigint,
  fromDecimals: number,
  toDecimals: number,
): bigint {
  assertNonNegative(amount);
  return divCeil(amount * units(toDecimals), units(fromDecimals));
}

/**
 * Exact-input quote: out = in * (1 - spreadBps / 10_000) - fixedFee,
 * converted between arbitrary token decimals with floor rounding in the solver's favour.
 */
export function quoteExactIn(
  amountIn: bigint,
  fromDecimals: number,
  toDecimals: number,
  policy: PricingPolicy,
): bigint {
  assertNonNegative(amountIn);
  validatePolicy(policy);
  const fromUnit = units(fromDecimals);
  const toUnit = units(toDecimals);
  const numerator =
    (amountIn * (BPS - BigInt(policy.spreadBps)) * USD_SCALE -
      policy.fixedFeeUsdMicros * BPS * fromUnit) *
    toUnit;
  return numerator <= 0n ? 0n : numerator / (BPS * fromUnit * USD_SCALE);
}

/**
 * Minimal payer base units whose exact-input quote covers amountOut.
 */
export function quoteExactOut(
  amountOut: bigint,
  fromDecimals: number,
  toDecimals: number,
  policy: PricingPolicy,
): bigint {
  assertNonNegative(amountOut);
  validatePolicy(policy);
  if (amountOut === 0n) return 0n;
  const fromUnit = units(fromDecimals);
  const toUnit = units(toDecimals);
  return divCeil(
    (amountOut * USD_SCALE + policy.fixedFeeUsdMicros * toUnit) *
      BPS *
      fromUnit,
    USD_SCALE * toUnit * (BPS - BigInt(policy.spreadBps)),
  );
}

export function checkLimits(
  amount: bigint,
  decimals: number,
  limits: { minUsdMicros: bigint; maxUsdMicros: bigint },
): boolean {
  assertNonNegative(amount);
  assertNonNegative(limits.minUsdMicros);
  assertNonNegative(limits.maxUsdMicros);
  if (limits.minUsdMicros > limits.maxUsdMicros) {
    throw new RangeError('Invalid limits');
  }
  const unit = units(decimals);
  const scaled = amount * USD_SCALE;
  return (
    scaled >= limits.minUsdMicros * unit && scaled <= limits.maxUsdMicros * unit
  );
}

/**
 * Peg guard: every price (millionths of 1 USD) must be within tolerance of $1,
 * and inter-source spread must not exceed tolerance. Empty list fails closed.
 */
export function pegGuard(
  pricesUsdMicros: readonly bigint[],
  toleranceUsdMicros: bigint,
): boolean {
  if (toleranceUsdMicros < 0n || toleranceUsdMicros > USD_SCALE) {
    throw new RangeError('Invalid tolerance');
  }
  if (pricesUsdMicros.length === 0) return false;
  let low = pricesUsdMicros[0]!;
  let high = low;
  for (const price of pricesUsdMicros) {
    if (
      price <= 0n ||
      price < USD_SCALE - toleranceUsdMicros ||
      price > USD_SCALE + toleranceUsdMicros
    ) {
      return false;
    }
    if (price < low) low = price;
    if (price > high) high = price;
  }
  return high - low <= toleranceUsdMicros;
}

/** Positive shortageBps means BCH inventory is scarce; negative means EVM inventory is scarce. */
export function effectiveSpreadBps(
  baseSpreadBps: number,
  shortageBps: number,
  direction: Direction,
  capBps: number,
): number {
  assertValidSpread(baseSpreadBps);
  if (
    !Number.isInteger(shortageBps) ||
    !Number.isInteger(capBps) ||
    capBps < 0
  ) {
    throw new RangeError('Invalid inventory skew');
  }
  const skew =
    Math.max(-capBps, Math.min(capBps, shortageBps)) *
    (direction === 'EVM_TO_BCH' ? 1 : -1);
  return Math.max(0, Math.min(9999, baseSpreadBps + skew));
}

export const DEFAULT_HOLD_FEE_BPS_PER_DAY = 10;
export const MAX_SEND_LINK_WINDOW_SECONDS = 7 * 86_400;
/** The shortest claim window a send link may have: one hour. */
export const MIN_SEND_LINK_WINDOW_SECONDS = 3_600;

/**
 * Compute send-link hold fee in basis points: HOLD_FEE_BPS_PER_DAY * ceil(windowDays).
 * Window is capped at 7 days (604,800 seconds).
 */
export function holdFeeBps(
  windowSeconds: number,
  holdFeeBpsPerDay = DEFAULT_HOLD_FEE_BPS_PER_DAY,
): number {
  if (
    !Number.isFinite(windowSeconds) ||
    windowSeconds < 0 ||
    windowSeconds > MAX_SEND_LINK_WINDOW_SECONDS
  ) {
    throw new RangeError(
      `Invalid send-link windowSeconds: must be 0..${MAX_SEND_LINK_WINDOW_SECONDS}`,
    );
  }
  if (!Number.isInteger(holdFeeBpsPerDay) || holdFeeBpsPerDay < 0) {
    throw new RangeError('Invalid holdFeeBpsPerDay');
  }
  if (windowSeconds === 0) return 0;
  const days = Math.ceil(windowSeconds / 86_400);
  return days * holdFeeBpsPerDay;
}

export function effectiveSendLinkSpreadBps(
  baseSpreadBps: number,
  windowSeconds: number,
  holdFeeBpsPerDay = DEFAULT_HOLD_FEE_BPS_PER_DAY,
): number {
  assertValidSpread(baseSpreadBps);
  const feeBps = holdFeeBps(windowSeconds, holdFeeBpsPerDay);
  return Math.min(9999, baseSpreadBps + feeBps);
}

import type { OrderTerms, PricingEvidence } from './terms.js';

function validateEvidence(evidence: PricingEvidence): void {
  assertValidSpread(evidence.spreadBps);
  assertNonNegative(evidence.fixedFeeBase);
  if (evidence.rounding !== 'floor') {
    throw new RangeError('Only floor rounding is supported');
  }
}

/**
 * Compute receive base units from PricingEvidence (spreadBps + fixedFeeBase
 * in receive token base units), rounded down in the solver's favour.
 */
export function quoteOut(
  amountIn: bigint,
  fromDecimals: number,
  toDecimals: number,
  evidence: PricingEvidence,
): bigint {
  assertNonNegative(amountIn);
  validateEvidence(evidence);
  const fromUnit = units(fromDecimals);
  const toUnit = units(toDecimals);
  const grossOut =
    (amountIn * (BPS - BigInt(evidence.spreadBps)) * toUnit) / (BPS * fromUnit);
  return grossOut > evidence.fixedFeeBase
    ? grossOut - evidence.fixedFeeBase
    : 0n;
}

/**
 * Minimal payer base units whose quoteOut covers amountOut (for pay links).
 */
export function quoteInForExactOut(
  amountOut: bigint,
  fromDecimals: number,
  toDecimals: number,
  evidence: PricingEvidence,
): bigint {
  assertNonNegative(amountOut);
  validateEvidence(evidence);
  if (amountOut === 0n) return 0n;
  const fromUnit = units(fromDecimals);
  const toUnit = units(toDecimals);
  const neededGross = amountOut + evidence.fixedFeeBase;
  return divCeil(
    neededGross * BPS * fromUnit,
    (BPS - BigInt(evidence.spreadBps)) * toUnit,
  );
}

const PRICE_SCALE = 12;
const PRICE_FACTOR = 10n ** BigInt(PRICE_SCALE);

function parseScaledDecimal(input: string | number): bigint | null {
  const raw = typeof input === 'number' ? input.toString() : input.trim();
  const match = /^(\d+)(?:\.(\d+))?$/.exec(raw);
  if (!match) return null;
  const whole = match[1]!;
  const frac = (match[2] ?? '').slice(0, PRICE_SCALE).padEnd(PRICE_SCALE, '0');
  return BigInt(whole) * PRICE_FACTOR + BigInt(frac);
}

function formatScaledDecimal(value: bigint): string {
  const whole = value / PRICE_FACTOR;
  const frac = (value % PRICE_FACTOR).toString().padStart(PRICE_SCALE, '0');
  const trimmedFrac = frac.replace(/0+$/, '');
  return trimmedFrac.length > 0 ? `${whole}.${trimmedFrac}` : `${whole}`;
}

export interface VerifyPricingResult {
  status: 'ok' | 'warn';
  difference: string | null;
  quotedPrice: string | null;
  ownPrice: string | null;
  reason?: string;
}

/**
 * Cross-check the quote's BCH token reference price against the caller's own
 * live Cauldron read within tolerance.
 */
export function verifyPricing(
  terms: OrderTerms,
  ownPusdPrice: string | number,
  tolerance: string | number,
): VerifyPricingResult {
  const ownScaled = parseScaledDecimal(ownPusdPrice);
  const tolScaled = parseScaledDecimal(tolerance);
  const ownStr =
    typeof ownPusdPrice === 'number' ? ownPusdPrice.toString() : ownPusdPrice;

  if (ownScaled === null || ownScaled <= 0n) {
    return {
      status: 'warn',
      difference: null,
      quotedPrice: null,
      ownPrice: ownStr,
      reason: 'Invalid live reference price',
    };
  }
  if (tolScaled === null || tolScaled < 0n) {
    return {
      status: 'warn',
      difference: null,
      quotedPrice: null,
      ownPrice: ownStr,
      reason: 'Invalid tolerance',
    };
  }

  const ref = terms.pricing?.refs.find(
    (entry) => entry.asset.toUpperCase() === terms.bchToken,
  );
  if (!ref) {
    return {
      status: 'warn',
      difference: null,
      quotedPrice: null,
      ownPrice: ownStr,
      reason: `Missing ${terms.bchToken} pricing reference in terms`,
    };
  }

  const quotedScaled = parseScaledDecimal(ref.usdPrice);
  if (quotedScaled === null || quotedScaled <= 0n) {
    return {
      status: 'warn',
      difference: null,
      quotedPrice: ref.usdPrice,
      ownPrice: ownStr,
      reason: `Malformed ${terms.bchToken} reference price`,
    };
  }

  const diffScaled =
    quotedScaled >= ownScaled
      ? quotedScaled - ownScaled
      : ownScaled - quotedScaled;
  const difference = formatScaledDecimal(diffScaled);

  if (diffScaled > tolScaled) {
    return {
      status: 'warn',
      difference,
      quotedPrice: ref.usdPrice,
      ownPrice: ownStr,
      reason: `${terms.bchToken} quote price differs from live reference by ${difference}`,
    };
  }

  return {
    status: 'ok',
    difference,
    quotedPrice: ref.usdPrice,
    ownPrice: ownStr,
  };
}
