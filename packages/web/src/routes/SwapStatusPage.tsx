import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router';
import { useSolver } from '../lib/solver/useSolver';
import type { SwapOrder } from '../lib/solver/types';
import { getModeCopy } from '../lib/copy';
import { AlertTriangleIcon, CheckIcon, CopyIcon } from '../components/icons';

function truncateHash(hash: string, head = 10, tail = 8): string {
  if (hash.length <= head + tail + 3) return hash;
  return `${hash.slice(0, head)}…${hash.slice(-tail)}`;
}

export function SwapStatusPage() {
  const { orderId } = useParams<{ orderId: string }>();
  const solver = useSolver();
  const [order, setOrder] = useState<SwapOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [copiedHash, setCopiedHash] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (!orderId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    solver
      .getOrder(orderId)
      .then((res) => {
        if (active) {
          setOrder(res);
          setLoading(false);
        }
      })
      .catch(() => {
        if (active) {
          setOrder(null);
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [orderId, solver]);

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedHash(text);
      setTimeout(() => setCopiedHash(null), 2000);
    } catch {
      // Ignore clipboard write failures in non-secure contexts
    }
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center" role="status">
        <div className="inline-block size-8 animate-spin rounded-full border-2 border-lime border-t-transparent" />
        <p className="mt-4 text-sm text-text-muted">Loading swap status…</p>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center">
        <div className="rounded-card border border-hairline bg-surface-1 p-8 text-center">
          <AlertTriangleIcon className="mx-auto size-10 text-warn mb-4" />
          <h1 className="text-xl font-semibold text-text mb-2">
            Order Not Found
          </h1>
          <p className="text-sm text-text-muted mb-6">
            The requested swap order{' '}
            <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs text-text">
              {orderId}
            </code>{' '}
            could not be found or has not been indexed yet.
          </p>
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-pill bg-text px-5 py-2.5 text-xs font-semibold text-bg hover:bg-lime hover:text-lime-ink transition-colors cursor-pointer"
          >
            Return to Swap
          </Link>
        </div>
      </div>
    );
  }

  const copy = getModeCopy(order.mode);
  const isDone = order.status === 'DONE';
  const isRefunded = order.status === 'REFUNDED';
  const isQuoted = order.status === 'QUOTED';

  // Determine stage progress
  const userLockConfirmed =
    order.status !== 'QUOTED' && order.status !== 'USER_LOCK_SEEN';
  const solverLockConfirmed =
    order.status === 'SOLVER_LOCK_FINAL' ||
    order.status === 'USER_CLAIM_SEEN' ||
    order.status === 'DONE';
  const userClaimConfirmed = order.status === 'DONE';

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 sm:py-8">
      {/* Mock Indicator */}
      {order.isMock && (
        <div
          data-testid="mock-order-badge"
          className="mb-4 flex items-center justify-between rounded-lg border border-warn/30 bg-warn/10 px-3.5 py-1.5 text-xs text-warn"
        >
          <div className="flex items-center gap-2">
            <span className="size-2 rounded-full bg-warn shadow-[0_0_8px_var(--warn)]" />
            <span className="font-semibold">Mock Swap Order</span>
          </div>
          <span>Simulated state machine · No explorer links</span>
        </div>
      )}

      {/* Main Glass Order Card */}
      <div className="rounded-card border border-hairline bg-surface-1 p-5 sm:p-6 shadow-elev-card">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-hairline pb-4 mb-5">
          <div>
            <span className="text-xs uppercase tracking-wider font-semibold text-lime">
              {order.lane === 'fast'
                ? 'Fast Lane (≤ $25)'
                : 'Safe Lane (1-conf)'}
            </span>
            <h1 className="text-2xl font-semibold tracking-[-0.03em] text-text mt-0.5">
              {copy.statusTitle}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 rounded-pill px-3 py-1 text-xs font-semibold ${
                isDone
                  ? 'bg-ok/10 text-ok border border-ok/30'
                  : isRefunded
                    ? 'bg-warn/10 text-warn border border-warn/30'
                    : 'bg-lime/10 text-lime border border-lime/30'
              }`}
            >
              {isDone && <CheckIcon className="size-3.5" />}
              {order.status}
            </span>
          </div>
        </div>

        {/* Amounts and Direction Well */}
        <div className="rounded-well border border-hairline bg-surface-2 p-4 mb-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
            <div>
              <span className="text-xs text-text-muted block mb-1">
                {copy.sendLabel}
              </span>
              <div className="text-xl font-bold text-text">
                {order.fromAmount.toFixed(2)} {order.fromToken}
              </div>
              <span className="text-xs text-text-dim block mt-0.5">
                on {order.fromChain}
              </span>
            </div>

            <div className="border-t sm:border-t-0 sm:border-l border-hairline sm:pl-4 pt-3 sm:pt-0">
              <span className="text-xs text-text-muted block mb-1">
                {copy.receiveLabel}
              </span>
              <div className="text-xl font-bold text-lime">
                {order.toAmount.toFixed(2)} {order.toToken}
              </div>
              <span className="text-xs text-text-dim block mt-0.5">
                on {order.toChain}
              </span>
            </div>
          </div>
        </div>

        {/* Current Wait State / Action Banner */}
        <div
          data-testid="wait-state-banner"
          className={`rounded-xl border p-4 mb-6 ${
            isDone
              ? 'border-ok/30 bg-ok/10 text-ok'
              : isRefunded
                ? 'border-warn/30 bg-warn/10 text-warn'
                : 'border-lime/30 bg-surface-2 text-text'
          }`}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <span className="text-xs font-semibold uppercase tracking-wider block text-text-dim mb-1">
                Current Status
              </span>
              <p className="text-sm font-medium">{order.waitDescription}</p>
            </div>
            {!isDone && !isRefunded && (
              <div className="shrink-0 text-right">
                <span className="font-mono text-xs text-lime">
                  ~{order.estimatedSecondsRemaining}s remaining
                </span>
                <span className="block text-[11px] text-text-dim">
                  elapsed: {order.elapsedSeconds}s
                </span>
              </div>
            )}
          </div>

          {!isDone && !isRefunded && order.requiredConfirmations > 0 && (
            <div className="mt-3 flex items-center justify-between border-t border-hairline pt-2.5 text-xs text-text-muted">
              <span>Required Block Confirmations:</span>
              <span className="font-semibold text-text">
                {order.currentConfirmations} of {order.requiredConfirmations}
              </span>
            </div>
          )}
        </div>

        {/* Step Timeline: User Steps vs Solver Steps */}
        <div className="space-y-6">
          {/* USER STEPS SECTION */}
          <div>
            <h2 className="text-xs font-bold uppercase tracking-wider text-text-muted mb-3 flex items-center gap-2">
              <span className="size-2 rounded-full bg-lime" />
              Your Steps (User)
            </h2>

            <div className="space-y-3 pl-4 border-l-2 border-hairline">
              {/* Step 1: User Lock */}
              <div className="relative">
                <div
                  className={`absolute -left-[23px] top-1 size-3 rounded-full border-2 ${
                    userLockConfirmed
                      ? 'border-ok bg-ok'
                      : order.status === 'USER_LOCK_SEEN'
                        ? 'border-lime bg-lime animate-pulse'
                        : 'border-surface-4 bg-surface-2'
                  }`}
                />
                <div className="flex items-center justify-between text-xs font-semibold text-text">
                  <span>
                    1. Lock {order.fromToken} on {order.fromChain}
                  </span>
                  <span
                    className={
                      userLockConfirmed
                        ? 'text-ok'
                        : order.status === 'USER_LOCK_SEEN'
                          ? 'text-lime'
                          : 'text-text-dim'
                    }
                  >
                    {userLockConfirmed
                      ? 'Confirmed'
                      : order.status === 'USER_LOCK_SEEN'
                        ? 'Confirming (0/1)'
                        : isQuoted
                          ? 'Awaiting lock'
                          : 'Pending'}
                  </span>
                </div>
                <p className="text-[11px] text-text-muted mt-0.5">
                  Deposit funds into trustless Hash-Time-Locked Contract (HTLC).
                </p>
              </div>

              {/* Step 2: User Claim */}
              <div className="relative pt-2">
                <div
                  className={`absolute -left-[23px] top-3 size-3 rounded-full border-2 ${
                    userClaimConfirmed
                      ? 'border-ok bg-ok'
                      : solverLockConfirmed
                        ? 'border-lime bg-lime animate-pulse'
                        : 'border-surface-4 bg-surface-2'
                  }`}
                />
                <div className="flex items-center justify-between text-xs font-semibold text-text">
                  <span>
                    2. Claim {order.toToken} on {order.toChain}
                  </span>
                  <span
                    className={
                      userClaimConfirmed
                        ? 'text-ok'
                        : solverLockConfirmed
                          ? 'text-lime'
                          : 'text-text-dim'
                    }
                  >
                    {userClaimConfirmed
                      ? 'Settled'
                      : solverLockConfirmed
                        ? 'Ready to claim'
                        : 'Waiting for solver'}
                  </span>
                </div>
                <p className="text-[11px] text-text-muted mt-0.5">
                  Reveal secret to claim funds directly to your wallet.
                </p>
              </div>
            </div>
          </div>

          {/* SOLVER STEPS SECTION */}
          <div>
            <h2 className="text-xs font-bold uppercase tracking-wider text-text-muted mb-3 flex items-center gap-2">
              <span className="size-2 rounded-full bg-surface-4" />
              Solver Steps (Counterparty)
            </h2>

            <div className="space-y-3 pl-4 border-l-2 border-hairline">
              {/* Solver Step 1: Counter-Lock */}
              <div className="relative">
                <div
                  className={`absolute -left-[23px] top-1 size-3 rounded-full border-2 ${
                    solverLockConfirmed
                      ? 'border-ok bg-ok'
                      : userLockConfirmed
                        ? 'border-lime bg-lime animate-pulse'
                        : 'border-surface-4 bg-surface-2'
                  }`}
                />
                <div className="flex items-center justify-between text-xs font-semibold text-text">
                  <span>
                    1. Counter-Lock {order.toToken} on {order.toChain}
                  </span>
                  <span
                    className={
                      solverLockConfirmed
                        ? 'text-ok'
                        : userLockConfirmed
                          ? 'text-lime'
                          : 'text-text-dim'
                    }
                  >
                    {solverLockConfirmed
                      ? 'Confirmed'
                      : userLockConfirmed
                        ? 'Counter-locking...'
                        : 'Awaiting user lock'}
                  </span>
                </div>
                <p className="text-[11px] text-text-muted mt-0.5">
                  Solver deposits {order.toAmount.toFixed(2)} {order.toToken}{' '}
                  into covenant bound to your hashlock.
                </p>
              </div>

              {/* Solver Step 2: Final Settlement */}
              <div className="relative pt-2">
                <div
                  className={`absolute -left-[23px] top-3 size-3 rounded-full border-2 ${
                    isDone ? 'border-ok bg-ok' : 'border-surface-4 bg-surface-2'
                  }`}
                />
                <div className="flex items-center justify-between text-xs font-semibold text-text">
                  <span>2. Solver Finalises Settlement</span>
                  <span className={isDone ? 'text-ok' : 'text-text-dim'}>
                    {isDone ? 'Completed' : 'Pending'}
                  </span>
                </div>
                <p className="text-[11px] text-text-muted mt-0.5">
                  Solver sweeps initial user deposit with revealed preimage.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Transactions Section */}
        {order.transactions.length > 0 && (
          <div className="mt-8 border-t border-hairline pt-6">
            <h2 className="text-xs font-bold uppercase tracking-wider text-text-muted mb-3">
              On-Chain Transactions
            </h2>

            <div className="space-y-2">
              {order.transactions.map((tx) => (
                <div
                  key={tx.id}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-xl border border-hairline bg-surface-2 p-3 text-xs"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-text">
                        {tx.label}
                      </span>
                      <span className="rounded bg-surface-3 px-1.5 py-0.5 text-[10px] text-text-dim">
                        {tx.chainName}
                      </span>
                    </div>
                    <div className="font-mono text-text-dim text-[11px] mt-0.5">
                      {truncateHash(tx.hash, 12, 10)}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleCopy(tx.hash)}
                      className="inline-flex items-center gap-1 rounded-pill bg-surface-3 border border-hairline px-2.5 py-1 text-[11px] text-text-muted hover:text-text cursor-pointer transition-colors"
                    >
                      <CopyIcon className="size-3" />
                      <span>{copiedHash === tx.hash ? 'Copied' : 'Copy'}</span>
                    </button>

                    {tx.isMock ? (
                      <span className="rounded-pill bg-surface-3 px-2 py-1 text-[10px] text-text-dim">
                        Mock Tx
                      </span>
                    ) : tx.explorerUrl ? (
                      <a
                        href={tx.explorerUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="inline-flex items-center gap-1 rounded-pill bg-lime/10 px-2.5 py-1 text-[11px] font-semibold text-lime hover:bg-lime/20 cursor-pointer"
                      >
                        Explorer ↗
                      </a>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Navigation & Actions */}
        <div className="mt-8 flex items-center justify-between border-t border-hairline pt-5 text-xs text-text-muted">
          <Link
            to="/"
            className="text-text hover:text-lime transition-colors font-medium flex items-center gap-1"
          >
            ← New Swap
          </Link>
          <span className="font-mono text-text-dim text-[11px]">
            Order ID: {truncateHash(order.id, 8, 6)}
          </span>
        </div>
      </div>
    </div>
  );
}
