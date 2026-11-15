export interface TimingConfig {
  solverReactionSeconds: number;
  safetySeconds: number;
  blockMeanSeconds: number;
  minReverseRemainingBlocks: number;
}

export const DEFAULT_TIMING_CONFIG: Readonly<TimingConfig> = Object.freeze({
  solverReactionSeconds: 60,
  safetySeconds: 7200,
  blockMeanSeconds: 600,
  minReverseRemainingBlocks: 108,
});

export interface CounterLockTime {
  unixSeconds: number;
  bchTipHeight: number;
}

export interface DeadlineTerms {
  evmDeadlineSeconds: number;
  bchRefundHeight: number;
}

export type TimingFailureReason =
  'ok' | 'expired' | 'remaining-blocks' | 'insufficient-margin';

export interface TimingDecision {
  allowed: boolean;
  remainingBlocks: number;
  availableSeconds: number;
  requiredSeconds: number;
  marginSeconds: number;
  reason: TimingFailureReason;
}

/**
 * Invert the integer-shape Erlang (Gamma) CDF via bracketing and bisection.
 * Models wall-clock time for `blocks` Poisson block arrivals with mean `meanSeconds`.
 */
export function erlangQuantile(
  blocks: number,
  probability: number,
  meanSeconds = 600,
): number {
  if (
    !Number.isInteger(blocks) ||
    blocks < 0 ||
    blocks > 10_000 ||
    !(probability > 0 && probability < 1) ||
    !Number.isFinite(meanSeconds) ||
    meanSeconds <= 0
  ) {
    throw new RangeError('Invalid Erlang parameters');
  }
  if (blocks === 0) return 0;

  const cdf = (x: number): number => {
    if (x === 0) return 0;
    let term = 0;
    let sum = 0;
    for (let k = 1; k < blocks; k++) {
      term += Math.log(x) - Math.log(k);
      const largest = Math.max(sum, term);
      sum = largest + Math.log1p(Math.exp(Math.min(sum, term) - largest));
    }
    return -Math.expm1(Math.min(0, sum - x));
  };

  let low = 0;
  let high = blocks;
  while (cdf(high) < probability) high *= 2;
  for (let i = 0; i < 100; i++) {
    const mid = (low + high) / 2;
    if (cdf(mid) < probability) low = mid;
    else high = mid;
  }
  return ((low + high) / 2) * meanSeconds;
}

function validateTimingInputs(
  terms: DeadlineTerms,
  start: CounterLockTime,
  config: TimingConfig,
): number {
  for (const value of [
    terms.evmDeadlineSeconds,
    start.unixSeconds,
    config.safetySeconds,
    config.solverReactionSeconds,
  ]) {
    if (!Number.isFinite(value) || value < 0) {
      throw new RangeError('Invalid time value');
    }
  }
  for (const value of [
    terms.bchRefundHeight,
    start.bchTipHeight,
    config.minReverseRemainingBlocks,
  ]) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new RangeError('Invalid block height');
    }
  }
  if (
    !Number.isFinite(config.blockMeanSeconds) ||
    config.blockMeanSeconds <= 0
  ) {
    throw new RangeError('Invalid block mean seconds');
  }
  return terms.bchRefundHeight - start.bchTipHeight;
}

function makeDecision(
  remainingBlocks: number,
  availableSeconds: number,
  requiredSeconds: number,
  expired: boolean,
  minBlocks: number,
): TimingDecision {
  const marginSeconds = availableSeconds - requiredSeconds;
  const reason: TimingFailureReason = expired
    ? 'expired'
    : remainingBlocks < minBlocks
      ? 'remaining-blocks'
      : marginSeconds < 0
        ? 'insufficient-margin'
        : 'ok';
  return {
    allowed: reason === 'ok',
    remainingBlocks,
    availableSeconds,
    requiredSeconds,
    marginSeconds,
    reason,
  };
}

/**
 * Forward invariant (F): evmDeadlineSeconds - t0 >= P99.99[DeltaBCH(N)] + SOLVER_REACTION + SAFETY.
 */
export function invariantF(
  terms: DeadlineTerms,
  start: CounterLockTime,
  config: TimingConfig = DEFAULT_TIMING_CONFIG,
): TimingDecision {
  const remainingBlocks = validateTimingInputs(terms, start, config);
  const availableSeconds = terms.evmDeadlineSeconds - start.unixSeconds;
  const requiredSeconds =
    erlangQuantile(
      Math.max(0, remainingBlocks),
      0.9999,
      config.blockMeanSeconds,
    ) +
    config.solverReactionSeconds +
    config.safetySeconds;
  return makeDecision(
    remainingBlocks,
    availableSeconds,
    requiredSeconds,
    availableSeconds <= 0 || remainingBlocks <= 0,
    1,
  );
}

/**
 * Reverse invariant (R): P0.01[DeltaBCH(N)] >= (evmDeadlineSeconds - t0) + SOLVER_REACTION + SAFETY.
 */
export function invariantR(
  terms: DeadlineTerms,
  start: CounterLockTime,
  config: TimingConfig = DEFAULT_TIMING_CONFIG,
): TimingDecision {
  const remainingBlocks = validateTimingInputs(terms, start, config);
  const evmWindowSeconds = terms.evmDeadlineSeconds - start.unixSeconds;
  const availableSeconds = erlangQuantile(
    Math.max(0, remainingBlocks),
    0.0001,
    config.blockMeanSeconds,
  );
  const requiredSeconds =
    Math.max(0, evmWindowSeconds) +
    config.solverReactionSeconds +
    config.safetySeconds;
  return makeDecision(
    remainingBlocks,
    availableSeconds,
    requiredSeconds,
    evmWindowSeconds <= 0 || remainingBlocks <= 0,
    config.minReverseRemainingBlocks,
  );
}
