import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { ROUTES } from '../lib/routes';
import {
  resumeAll,
  type ResumeAllResult,
  type UserSwapDependencies,
} from '@ferry/user-flow';

export interface ResumeSwapsProps {
  /** Built lazily so a missing wallet never throws during render. */
  readonly createDeps: () => UserSwapDependencies;
  /** Replaced in tests. */
  readonly resume?: typeof resumeAll;
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
              <span>{STEP_TEXT[step] ?? step}</span>
              {actionable && (
                <Link
                  to={ROUTES.swapOrder(swap.orderId)}
                  data-testid="resume-open"
                  className="self-start rounded-lg border border-hairline bg-surface-2 px-3 py-1 text-xs font-medium hover:bg-surface-3"
                >
                  Open this swap
                </Link>
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
