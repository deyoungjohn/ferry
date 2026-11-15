import type { EvmChainId } from './chains.js';

export type Lane = 'fast' | 'safe';

export interface LockEvidence {
  exists: boolean;
  confirmations: number;
  safe?: boolean;
  finalized?: boolean;
  ageSeconds?: number;
  dsproof?: 'clear' | 'detected' | 'unavailable';
  dsproofElapsedMs?: number;
}

export interface RevealInput {
  chain: 'bch' | EvmChainId;
  lane: Lane;
  fastOptIn: boolean;
  amountUsdMicros: bigint;
  evidence: LockEvidence;
}

export interface RevealConfig {
  zeroConfMaxUsdMicros: bigint;
  dsproofWindowMs: number;
  baseConfirmations: number;
  ethereumConfirmations: number;
  arbitrumAgeSeconds: number;
}

export const DEFAULT_REVEAL_CONFIG: Readonly<RevealConfig> = Object.freeze({
  zeroConfMaxUsdMicros: 25_000_000n,
  dsproofWindowMs: 5000,
  baseConfirmations: 10,
  ethereumConfirmations: 3,
  arbitrumAgeSeconds: 10,
});

export type RevealReason =
  | 'ready'
  | 'missing-lock'
  | 'fast-consent'
  | 'fast-cap'
  | 'dsproof'
  | 'waiting-finality';

export interface RevealDecision {
  allowed: boolean;
  reason: RevealReason;
}

/**
 * Secret reveal policy (§4.3): determines whether a counterparty lock is
 * irreversible enough to reveal the preimage or counter-lock.
 */
export function revealPolicy(
  input: RevealInput,
  config: RevealConfig = DEFAULT_REVEAL_CONFIG,
): RevealDecision {
  const e = input.evidence;
  if (input.amountUsdMicros < 0n || config.zeroConfMaxUsdMicros < 0n) {
    throw new RangeError('Invalid reveal amount');
  }
  for (const value of [
    e.confirmations,
    config.dsproofWindowMs,
    config.baseConfirmations,
    config.ethereumConfirmations,
    config.arbitrumAgeSeconds,
  ]) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new RangeError('Invalid confirmation policy');
    }
  }
  for (const value of [e.ageSeconds, e.dsproofElapsedMs]) {
    if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
      throw new RangeError('Invalid observation age');
    }
  }
  for (const threshold of [
    config.dsproofWindowMs,
    config.baseConfirmations,
    config.ethereumConfirmations,
    config.arbitrumAgeSeconds,
  ]) {
    if (threshold === 0) {
      throw new RangeError('Finality thresholds must be positive');
    }
  }

  if (!e.exists) return { allowed: false, reason: 'missing-lock' };
  if (input.lane === 'fast' && !input.fastOptIn) {
    return { allowed: false, reason: 'fast-consent' };
  }
  if (
    input.lane === 'fast' &&
    input.amountUsdMicros > config.zeroConfMaxUsdMicros
  ) {
    return { allowed: false, reason: 'fast-cap' };
  }
  if (input.chain === 'bch' && e.dsproof === 'detected') {
    return { allowed: false, reason: 'dsproof' };
  }

  let ready = false;
  switch (input.chain) {
    case 'bch':
      ready =
        e.confirmations >= 1 ||
        (input.lane === 'fast' &&
          e.dsproof === 'clear' &&
          (e.dsproofElapsedMs ?? -1) >= config.dsproofWindowMs);
      break;
    case 'base':
      ready =
        e.confirmations >= config.baseConfirmations &&
        (input.lane === 'fast' || e.safe === true || e.finalized === true);
      break;
    case 'ethereum':
      ready =
        e.confirmations >= config.ethereumConfirmations &&
        (input.lane === 'fast' || e.finalized === true);
      break;
    case 'arbitrum':
      ready =
        e.confirmations >= 1 &&
        (e.ageSeconds ?? -1) >= config.arbitrumAgeSeconds &&
        (input.lane === 'fast' || e.safe === true || e.finalized === true);
      break;
    case 'arc':
    case 'bnb':
    case 'robinhood':
      ready = e.confirmations >= 1 && e.finalized === true;
      break;
  }

  return { allowed: ready, reason: ready ? 'ready' : 'waiting-finality' };
}
