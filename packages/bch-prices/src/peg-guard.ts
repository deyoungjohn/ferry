import { USD_MICROS_SCALE, type AssetPriceReading } from './types.js';

/** Default peg tolerance: 1% ($0.01 = 10,000 micro-USD). */
export const DEFAULT_PEG_TOLERANCE_MICROS = 10_000n;
/** Default warning threshold: 0.5% ($0.005 = 5,000 micro-USD). */
export const DEFAULT_PEG_WARN_MICROS = 5_000n;

export type PegGuardStatus = 'ok' | 'warn' | 'refuse';

export type PegGuardReason =
  | 'NO_READINGS'
  | 'INVALID_PRICE'
  | 'STALE_READING'
  | 'PEG_DEVIATION'
  | 'SOURCE_DIVERGENCE'
  | 'APPROACHING_TOLERANCE';

export interface PegGuardInput {
  readonly readings: readonly AssetPriceReading[];
  readonly toleranceUsdMicros?: bigint;
  readonly warnThresholdUsdMicros?: bigint;
  readonly maxAgeSeconds?: number;
  readonly nowSeconds?: number;
}

export interface PegGuardEvaluation {
  readonly status: PegGuardStatus;
  readonly reason?: PegGuardReason;
  readonly deviationMicros: bigint;
  readonly maxPegDeviationMicros: bigint;
  readonly maxSpreadMicros: bigint;
}

function absDiff(a: bigint, b: bigint): bigint {
  return a >= b ? a - b : b - a;
}

/**
 * Pure peg guard evaluation matching PEG_TOLERANCE.
 * Returns 'ok', 'warn', or 'refuse' with exact micro-USD deviation metrics.
 */
export function evaluatePegGuard(input: PegGuardInput): PegGuardEvaluation {
  const tolerance = input.toleranceUsdMicros ?? DEFAULT_PEG_TOLERANCE_MICROS;
  const warnThreshold =
    input.warnThresholdUsdMicros ??
    (tolerance / 2n > 0n ? tolerance / 2n : tolerance);

  if (tolerance < 0n || tolerance > USD_MICROS_SCALE) {
    throw new RangeError(`Invalid peg tolerance: ${tolerance.toString()}`);
  }
  if (warnThreshold < 0n || warnThreshold > tolerance) {
    throw new RangeError(
      `Invalid peg warn threshold: ${warnThreshold.toString()}`,
    );
  }

  if (input.readings.length === 0) {
    return {
      status: 'refuse',
      reason: 'NO_READINGS',
      deviationMicros: 0n,
      maxPegDeviationMicros: 0n,
      maxSpreadMicros: 0n,
    };
  }

  for (const reading of input.readings) {
    if (reading.usdPrice <= 0n) {
      return {
        status: 'refuse',
        reason: 'INVALID_PRICE',
        deviationMicros: 0n,
        maxPegDeviationMicros: 0n,
        maxSpreadMicros: 0n,
      };
    }
    if (input.maxAgeSeconds !== undefined && input.nowSeconds !== undefined) {
      const age = input.nowSeconds - reading.asOf;
      if (age < 0 || age > input.maxAgeSeconds) {
        return {
          status: 'refuse',
          reason: 'STALE_READING',
          deviationMicros: 0n,
          maxPegDeviationMicros: 0n,
          maxSpreadMicros: 0n,
        };
      }
    }
  }

  let low = input.readings[0]!.usdPrice;
  let high = low;
  let maxPegDeviationMicros = 0n;

  for (const reading of input.readings) {
    if (reading.usdPrice < low) low = reading.usdPrice;
    if (reading.usdPrice > high) high = reading.usdPrice;
    const pegDev = absDiff(reading.usdPrice, USD_MICROS_SCALE);
    if (pegDev > maxPegDeviationMicros) {
      maxPegDeviationMicros = pegDev;
    }
  }

  const maxSpreadMicros = high - low;
  const deviationMicros =
    maxPegDeviationMicros >= maxSpreadMicros
      ? maxPegDeviationMicros
      : maxSpreadMicros;

  if (maxPegDeviationMicros > tolerance) {
    return {
      status: 'refuse',
      reason: 'PEG_DEVIATION',
      deviationMicros,
      maxPegDeviationMicros,
      maxSpreadMicros,
    };
  }

  if (maxSpreadMicros > tolerance) {
    return {
      status: 'refuse',
      reason: 'SOURCE_DIVERGENCE',
      deviationMicros,
      maxPegDeviationMicros,
      maxSpreadMicros,
    };
  }

  if (deviationMicros >= warnThreshold) {
    return {
      status: 'warn',
      reason: 'APPROACHING_TOLERANCE',
      deviationMicros,
      maxPegDeviationMicros,
      maxSpreadMicros,
    };
  }

  return {
    status: 'ok',
    deviationMicros,
    maxPegDeviationMicros,
    maxSpreadMicros,
  };
}
