import { useEffect, useState } from 'react';
import {
  resumeAll,
  type ResumeAllResult,
  type ResumedSwap,
  type UserSwapDependencies,
} from '@ferry/user-flow';
import { WAIT_OPTIONS } from '../lib/live/run';

export interface ResumeSwapsProps {
  /** Built lazily so a missing wallet never throws during render. */
  readonly createDeps: () => UserSwapDependencies;
  /** Replaced in tests. */
  readonly resume?: typeof resumeAll;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const STEP_TEXT: Record<string, string> = {
  lock: 'Not locked yet. Nothing is at risk.',
  waitCounterLock: "Locked. Waiting for the solver's lock, then you claim.",
  claim: 'Ready to claim your funds.',
  refund: 'Ready to refund your lock.',
  done: 'Finished.',
  refunded: 'Refunded.',
};

/**
 * After a reload the page finds every swap saved in this browser and lets the user
 * carry on: wait and claim, claim, or refund. A swap that is not locked is only listed.
 */
export function ResumeSwaps({
  createDeps,
  resume = resumeAll,
}: ResumeSwapsProps) {
  const [result, setResult] = useState<ResumeAllResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    resume(createDeps())
      .then((found) => {
        if (!cancelled) setResult(found);
      })
      .catch(() => {
        if (!cancelled) setResult({ resumed: [], failed: [] });
      });
    return () => {
      cancelled = true;
    };
    // Runs once when the swap page opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function carryOn(swap: ResumedSwap) {
    const id = swap.orderId;
    setBusy(id);
    try {
      const { step } = swap.session.state;
      if (step === 'waitCounterLock') {
        await swap.session.waitCounterLock(WAIT_OPTIONS);
        await swap.session.claim();
      } else if (step === 'claim') {
        await swap.session.claim();
      } else if (step === 'refund') {
        await swap.session.refund();
      }
      setNotes((n) => ({
        ...n,
        [id]: STEP_TEXT[swap.session.state.step] ?? '',
      }));
    } catch (cause) {
      setNotes((n) => ({ ...n, [id]: messageOf(cause) }));
    } finally {
      setBusy(null);
    }
  }

  if (!result) return null;
  const open = result.resumed.filter((swap) => !swap.settled);
  if (open.length === 0 && result.failed.length === 0) return null;

  return (
    <section
      data-testid="resume-swaps"
      aria-label="Unfinished swaps"
      className="mt-3 rounded-lg border border-warn/30 bg-warn/10 p-3 text-xs text-text"
    >
      <p className="font-medium">Unfinished swaps in this browser</p>
      <ul className="mt-2 space-y-2">
        {open.map((swap) => {
          const step = swap.session.state.step;
          const actionable =
            step === 'waitCounterLock' || step === 'claim' || step === 'refund';
          return (
            <li key={swap.orderId} className="flex flex-col gap-1">
              <span className="font-mono text-[11px] text-text-muted">
                {swap.orderId.slice(0, 10)}…
              </span>
              <span>{notes[swap.orderId] ?? STEP_TEXT[step] ?? step}</span>
              {actionable && (
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void carryOn(swap)}
                  className="self-start rounded-lg border border-hairline bg-surface-2 px-3 py-1 text-xs font-medium hover:bg-surface-3 disabled:opacity-50"
                >
                  {busy === swap.orderId ? 'Working…' : 'Continue'}
                </button>
              )}
            </li>
          );
        })}
        {result.failed.map((f) => (
          <li key={f.orderId} className="text-text-muted">
            <span className="font-mono text-[11px]">
              {f.orderId.slice(0, 10)}…
            </span>{' '}
            could not be checked: {f.error}
          </li>
        ))}
      </ul>
    </section>
  );
}
