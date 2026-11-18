import type { Hex32 } from '@ferry/core';
import {
  UserSwapSession,
  type SwapState,
  type UserSwapDependencies,
} from './session.js';

export interface ResumedSwap {
  readonly orderId: Hex32;
  readonly session: UserSwapSession;
  readonly state: SwapState;
  /** True once the swap is over (claimed or refunded): nothing more to do. */
  readonly settled: boolean;
}

export interface ResumeAllResult {
  /** Swaps picked up again, open ones first. */
  readonly resumed: readonly ResumedSwap[];
  /** Saved files that could not be resumed, with the reason in plain words. */
  readonly failed: readonly {
    readonly orderId: Hex32;
    readonly error: string;
  }[];
}

/**
 * After a reload: pick up every swap that has a saved recovery file. One bad
 * file or one failed chain read never hides the others; it is listed under
 * `failed` so the page can still offer the file for download.
 */
export async function resumeAll(
  deps: UserSwapDependencies,
): Promise<ResumeAllResult> {
  const resumed: ResumedSwap[] = [];
  const failed: { orderId: Hex32; error: string }[] = [];
  for (const orderId of await deps.store.list()) {
    try {
      const session = await UserSwapSession.resume(deps, orderId);
      const state = session.state;
      resumed.push({
        orderId,
        session,
        state,
        settled: state.step === 'done' || state.step === 'refunded',
      });
    } catch (error) {
      failed.push({
        orderId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  resumed.sort((a, b) => Number(a.settled) - Number(b.settled));
  return { resumed, failed };
}
