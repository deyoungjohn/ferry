import { useContext, useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router';
import {
  UserFlowError,
  UserSwapSession,
  type SwapState,
  type UserSwapDependencies,
} from '@ferry/user-flow';
import { parseRecoveryFileJson, type Hex32 } from '@ferry/core';
import { WalletContext } from '../lib/wallet/context';
import { createLiveDependencies } from '../lib/live/ports';
import { createLocalRecoveryStore } from '../lib/live/recovery-store';
import { WAIT_OPTIONS } from '../lib/live/run';
import { ROUTES } from '../lib/routes';

/** The steps a person sees, in order. A swap in either direction passes through all of them. */
const STEPS: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'quote', label: 'Price agreed' },
  { id: 'saveRecovery', label: 'Recovery file saved' },
  { id: 'lock', label: 'Your funds locked' },
  { id: 'waitCounterLock', label: "The solver's funds locked" },
  { id: 'claim', label: 'You claim your funds' },
  { id: 'done', label: 'Done' },
];

function stepIndex(step: string): number {
  if (step === 'refund' || step === 'refunded') return 3;
  const index = STEPS.findIndex((item) => item.id === step);
  return index < 0 ? 0 : index;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface LiveOrderViewProps {
  readonly orderId: string;
  /** Replaced in tests; production builds it from the connected wallets and the configured solver. */
  readonly dependencies?: UserSwapDependencies | undefined;
}

/**
 * The page for one swap, at /app/swap/<order id>: the step-by-step progress, with the actions each
 * step needs. It picks the swap up from the recovery file kept in this browser, so a reload or a
 * return later lands exactly where the swap is. A swap that was just started locks, waits and
 * claims by itself; one that was only opened waits and claims, and asks before it locks.
 */
export function LiveOrderView({ orderId, dependencies }: LiveOrderViewProps) {
  const wallets = useContext(WalletContext);
  const location = useLocation();
  const startedByUser =
    (location.state as { start?: boolean } | null)?.start === true;
  const [state, setState] = useState<SwapState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [fileJson, setFileJson] = useState<string | null>(null);
  const sessionRef = useRef<UserSwapSession | null>(null);
  const running = useRef(false);
  const [checking, setChecking] = useState(false);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);

  function depsFor(json: string): UserSwapDependencies {
    if (dependencies) return dependencies;
    if (!wallets)
      throw new Error('Connect your wallets to continue this swap.');
    const solverUrl = (import.meta.env?.VITE_SOLVER_URLS as string | undefined)
      ?.split(',')[0]
      ?.trim();
    if (!solverUrl) throw new Error('No solver is configured.');
    const file = parseRecoveryFileJson(json);
    return createLiveDependencies({
      wallets: { evm: wallets.evm, bch: wallets.bch },
      solverUrl,
      chainId: file.terms.evmChainId,
    });
  }

  // Pick the swap up from this browser, then carry on from where the chains say it is.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const json = await createLocalRecoveryStore().load(orderId as Hex32);
        if (!json) {
          if (active) setMissing(true);
          return;
        }
        if (active) setFileJson(json);
        if (!dependencies && !wallets?.bch.address) return; // waits for the wallets
        const session = await UserSwapSession.resume(
          depsFor(json),
          orderId as Hex32,
        );
        if (!active) return;
        sessionRef.current = session;
        session.subscribe((next) => active && setState(next));
        setState(session.state);
        await carryOn(session, startedByUser);
      } catch (cause) {
        if (active) setError(messageOf(cause));
      }
    })();
    return () => {
      active = false;
    };
    // The swap is picked up once per order, and again when the wallets arrive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId, wallets?.bch.address?.address]);

  async function carryOn(session: UserSwapSession, mayLock: boolean) {
    if (running.current) return;
    running.current = true;
    setError(null);
    try {
      const step = session.state.step;
      if (step === 'lock' && mayLock) await session.lock();
      const after = session.state.step;
      if (after === 'waitCounterLock') {
        await session.waitCounterLock(WAIT_OPTIONS);
      }
      if (session.state.step === 'claim') await session.claim();
    } catch (cause) {
      setError(messageOf(cause));
      if (cause instanceof UserFlowError)
        await session.refresh().catch(() => undefined);
    } finally {
      running.current = false;
      if (sessionRef.current) setState(sessionRef.current.state);
    }
  }

  // Looks at the chains now, even while the long wait is running, and shows when it looked.
  async function checkAgain() {
    const session = sessionRef.current;
    if (!session || checking) return;
    setChecking(true);
    setError(null);
    try {
      await session.refresh();
      setState(session.state);
      setCheckedAt(new Date());
      if (!running.current) await carryOn(session, false);
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setChecking(false);
    }
  }

  async function refund() {
    const session = sessionRef.current;
    if (!session) return;
    setError(null);
    try {
      await session.refund();
    } catch (cause) {
      setError(messageOf(cause));
    }
    setState(session.state);
  }

  function downloadFile() {
    if (!fileJson) return;
    const url = URL.createObjectURL(
      new Blob([fileJson], { type: 'application/json' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = `ferry-recovery-${orderId.slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  if (missing) {
    return (
      <div className="mx-auto max-w-lg px-4 py-10" data-testid="order-not-here">
        <h1 className="text-xl font-semibold text-text">
          This swap is not saved in this browser
        </h1>
        <p className="mt-2 text-sm text-text-muted">
          A swap is continued from its recovery file, which is kept in the
          browser that started it. Use the file you downloaded on the{' '}
          <Link className="text-lime underline" to={ROUTES.recover}>
            Recover page
          </Link>
          .
        </p>
      </div>
    );
  }

  const current = state ? stepIndex(state.step) : 0;
  const done = state?.step === 'done';
  const refundReady = state?.step === 'refund';
  const needsLockStart = state?.step === 'lock' && !running.current;
  const waitingForWallets = !dependencies && !wallets?.bch.address;

  return (
    <div
      className="mx-auto max-w-lg px-4 py-8 sm:px-6"
      data-testid="live-order"
    >
      <h1 className="text-2xl font-semibold tracking-[-0.03em] text-text">
        Your swap
      </h1>
      <p className="mt-1 break-all font-mono text-[11px] text-text-dim">
        {orderId}
      </p>

      {waitingForWallets && (
        <p
          className="mt-4 rounded-lg border border-warn/30 bg-warn/10 p-3 text-xs text-warn"
          data-testid="order-needs-wallets"
        >
          Connect your wallets (the pill at the top right) to carry on with this
          swap.
        </p>
      )}

      <ol className="mt-6 space-y-3" data-testid="order-steps">
        {STEPS.map((item, index) => {
          const reached = state ? index < current || done : false;
          const active = state ? index === current && !done : false;
          return (
            <li
              key={item.id}
              data-testid={`order-step-${item.id}`}
              data-state={reached ? 'done' : active ? 'active' : 'todo'}
              className={`flex items-start gap-3 rounded-lg border p-3 ${
                active
                  ? 'border-lime/40 bg-lime/5'
                  : 'border-hairline bg-surface-1'
              }`}
            >
              <span
                aria-hidden="true"
                className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full text-[11px] ${
                  reached
                    ? 'bg-lime text-lime-ink'
                    : active
                      ? 'border border-lime text-lime'
                      : 'border border-hairline text-text-dim'
                }`}
              >
                {reached ? '✓' : index + 1}
              </span>
              <div className="min-w-0">
                <p
                  className={
                    reached || active ? 'text-text' : 'text-text-muted'
                  }
                >
                  {item.label}
                </p>
                {active && state?.waiting && (
                  <p className="mt-0.5 text-xs text-text-muted">
                    {state.waiting}
                  </p>
                )}
                {item.id === 'lock' && state?.txids.userLock && (
                  <p className="mt-0.5 break-all font-mono text-[10px] text-text-dim">
                    {state.txids.userLock}
                  </p>
                )}
                {item.id === 'claim' && state?.txids.claim && (
                  <p className="mt-0.5 break-all font-mono text-[10px] text-text-dim">
                    {state.txids.claim}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {state?.step === 'refunded' && (
        <p className="mt-4 text-sm text-text" data-testid="order-refunded">
          Refunded. Your funds are back with you.
        </p>
      )}
      {done && (
        <p className="mt-4 text-sm text-ok" data-testid="order-done">
          Done. The claim was sent. The balance shows in your wallet once it
          confirms.
        </p>
      )}

      {error && (
        <p
          role="alert"
          className="mt-4 text-sm text-danger"
          data-testid="order-error"
        >
          {error}
        </p>
      )}

      <div className="mt-5 flex flex-wrap gap-2">
        {needsLockStart && sessionRef.current && (
          <button
            type="button"
            data-testid="order-lock-now"
            onClick={() => void carryOn(sessionRef.current!, true)}
            className="h-10 rounded-pill bg-olive px-5 font-semibold text-text"
          >
            Start swap: lock my funds
          </button>
        )}
        {refundReady && (
          <button
            type="button"
            data-testid="order-refund"
            onClick={() => void refund()}
            className="h-10 rounded-pill border border-hairline bg-surface-2 px-5 font-medium text-text"
          >
            Refund my funds
          </button>
        )}
        {!done &&
          state?.step !== 'refunded' &&
          state &&
          !refundReady &&
          state.step !== 'lock' && (
            <button
              type="button"
              data-testid="order-resume"
              disabled={checking}
              onClick={() => void checkAgain()}
              className="h-10 rounded-pill border border-hairline bg-surface-2 px-5 font-medium text-text"
            >
              {checking ? 'Checking…' : 'Check again'}
            </button>
          )}
        <button
          type="button"
          onClick={downloadFile}
          className="h-10 rounded-pill border border-hairline px-5 text-sm text-text-muted"
        >
          Download recovery file
        </button>
      </div>
      {checkedAt && (
        <p
          className="mt-3 text-xs text-text-dim"
          data-testid="order-checked-at"
        >
          Last checked {checkedAt.toLocaleTimeString()}
        </p>
      )}
      <p className="mt-4 text-xs text-text-dim">
        You can close this page and come back to it: the swap carries on from
        the chains. If anything stops, your own refund stays available.
      </p>
    </div>
  );
}
