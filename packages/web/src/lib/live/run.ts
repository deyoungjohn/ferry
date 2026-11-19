import {
  UserFlowError,
  UserSwapSession,
  type QuoteInput,
  type SwapState,
  type UserSwapDependencies,
} from '@ferry/user-flow';
import type { VerifiedQuote } from '@ferry/solver-client';
import { recoveryFileName } from '@ferry/core';

export interface LivePreview {
  readonly quote: VerifiedQuote;
}

/** A price only: nothing is reserved and nothing can be locked from this session. */
export async function previewSwap(
  deps: UserSwapDependencies,
  input: QuoteInput,
): Promise<VerifiedQuote> {
  const session = new UserSwapSession(deps);
  return session.quote({ ...input, dryRun: true });
}

/**
 * Starts the real swap up to the point where the user must keep the recovery
 * file. Nothing is locked yet: the secret and the file exist first.
 */
export async function prepareSwap(
  deps: UserSwapDependencies,
  input: QuoteInput,
): Promise<{
  readonly session: UserSwapSession;
  readonly recovery: { readonly filename: string; readonly json: string };
}> {
  const session = new UserSwapSession(deps);
  await session.quote({ ...input, dryRun: false });
  const file = await session.saveRecovery();
  const json = await deps.store.load(file.orderId);
  if (json === null) {
    throw new UserFlowError(
      'RECOVERY_NOT_SAVED',
      'The recovery file could not be read back, so nothing was locked.',
    );
  }
  return {
    session,
    recovery: { filename: recoveryFileName(file.orderId), json },
  };
}

export const WAIT_OPTIONS = {
  pollIntervalMs: 3_000,
  timeoutMs: 25 * 60_000,
} as const;

/** Lock, wait for the solver's lock, and claim. Each step updates the session state. */
export async function executeSwap(
  session: UserSwapSession,
  onState: (state: SwapState) => void,
): Promise<SwapState> {
  const off = session.subscribe(onState);
  try {
    await session.lock();
    await session.waitCounterLock(WAIT_OPTIONS);
    await session.claim();
    return session.state;
  } finally {
    off();
  }
}
