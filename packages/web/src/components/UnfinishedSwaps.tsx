import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import {
  resumeAll,
  type ResumeAllResult,
  type UserSwapDependencies,
} from '@ferry/user-flow';
import { GlassModal } from './GlassModal';
import { ROUTES } from '../lib/routes';

export interface UnfinishedSwapsProps {
  /** Built lazily so a missing wallet never throws during render. */
  readonly createDeps: () => UserSwapDependencies;
  readonly solverUrl: string;
  /** The EVM address: it does not change after each payment, unlike a Bitcoin Cash one. */
  readonly evmAddress: string | null;
  /** Replaced in tests. */
  readonly resume?: typeof resumeAll;
  readonly fetchFn?: typeof fetch;
}

interface Row {
  readonly orderId: string;
  readonly text: string;
}

const STEP_TEXT: Record<string, string> = {
  waitCounterLock: "Locked. Waiting for the solver's lock, then you claim.",
  claim: 'Ready to claim your funds.',
  refund: 'Ready to refund your lock.',
};

const SERVER_TEXT: Record<string, string> = {
  USER_LOCK_SEEN: 'Your lock is seen. Waiting for the solver.',
  USER_LOCK_FINAL: 'Your lock is final. Waiting for the solver.',
  SOLVER_LOCK_BROADCAST: "The solver's lock is on its way.",
  SOLVER_LOCK_SEEN: 'Ready to claim your funds.',
  SECRET_KNOWN: 'Finishing.',
};

/**
 * A button with a counter for the swaps that are not finished (this browser's saved swaps and the
 * solver's list for the connected EVM address, joined by order id). It opens a dialog that links
 * each to its order page. A swap that was never locked is not counted: nothing is at stake.
 */
export function UnfinishedSwaps({
  createDeps,
  solverUrl,
  evmAddress,
  resume = resumeAll,
  fetchFn = fetch,
}: UnfinishedSwapsProps) {
  const [local, setLocal] = useState<ResumeAllResult | null>(null);
  const [server, setServer] = useState<readonly Row[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    resume(createDeps())
      .then((found) => !cancelled && setLocal(found))
      .catch(() => !cancelled && setLocal({ resumed: [], failed: [] }));
    return () => {
      cancelled = true;
    };
    // Runs once when the swap card opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!evmAddress || !solverUrl) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetchFn(
          `${solverUrl.replace(/\/+$/, '')}/v1/orders?address=${encodeURIComponent(evmAddress)}`,
        );
        if (!res.ok) return;
        const body = (await res.json()) as {
          orders?: Array<{ orderId: string; status: string }>;
        };
        const rows = (body.orders ?? [])
          .filter((order) => SERVER_TEXT[order.status] !== undefined)
          .map((order) => ({
            orderId: order.orderId,
            text: SERVER_TEXT[order.status]!,
          }));
        if (!cancelled) setServer(rows);
      } catch {
        // the list is a convenience; the swap card works without it
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [solverUrl, evmAddress, fetchFn]);

  const rows = new Map<string, Row>();
  for (const row of server) rows.set(row.orderId, row);
  for (const swap of local?.resumed ?? []) {
    const step = swap.session.state.step;
    if (swap.settled || STEP_TEXT[step] === undefined) continue;
    rows.set(swap.orderId, { orderId: swap.orderId, text: STEP_TEXT[step]! });
  }
  const list = [...rows.values()];
  if (list.length === 0) return null;

  return (
    <>
      <button
        type="button"
        data-testid="unfinished-open"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-pill border border-warn/40 bg-warn/10 px-2.5 py-0.5 text-[11px] font-medium text-warn"
      >
        Unfinished
        <span
          data-testid="unfinished-count"
          className="inline-flex min-w-4 items-center justify-center rounded-full bg-warn px-1 text-[10px] font-semibold text-bg"
        >
          {list.length}
        </span>
      </button>
      <GlassModal
        open={open}
        onOpenChange={setOpen}
        title="Unfinished swaps"
        description="Open a swap to carry it on, claim, or refund."
      >
        <ul className="space-y-3" data-testid="unfinished-list">
          {list.map((row) => (
            <li
              key={row.orderId}
              className="flex items-center justify-between gap-3 text-xs"
            >
              <span className="min-w-0">
                <span className="block font-mono text-[11px] text-text-muted">
                  {row.orderId.slice(0, 10)}…
                </span>
                <span className="text-text">{row.text}</span>
              </span>
              <Link
                to={ROUTES.swapOrder(row.orderId)}
                data-testid="unfinished-link"
                onClick={() => setOpen(false)}
                className="shrink-0 rounded-lg border border-hairline bg-surface-2 px-3 py-1 text-xs font-medium"
              >
                Open
              </Link>
            </li>
          ))}
        </ul>
      </GlassModal>
    </>
  );
}
