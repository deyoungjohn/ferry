import { useContext, useEffect, useRef, useState } from 'react';
import { cashAddressOfLocking } from '../lib/bch/address';
import { plainWalletMessage } from '@ferry/user-flow';
import { finishWithWallet } from '../lib/recovery/finish-with-wallet';
import { isCancelled, markCancelled } from '../lib/live/cancelled';
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
import { latestWallet } from '../lib/live/latest-wallets';
import { readSnapshot, writeSnapshot } from '../lib/paylink/snapshot-cache';
import {
  readOrderTxids,
  swapEnds,
  swapMilestones,
  swapSteps,
  type OrderSnapshot,
} from '../lib/paylink/order-steps';
import { ProcessSteps } from './links/ProcessSteps';
import { SwapEnds } from './SwapEnds';
import { bchTxUrl, evmTokenInfo, evmTxUrl } from '../lib/explorer';
import { TxLink } from './TxLink';

const POLL_MS = 15_000;
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
  /** Lock and carry on by itself (as when "Start swap" was pressed). */
  readonly start?: boolean | undefined;
  /** Inside another page: no title of its own. */
  readonly embedded?: boolean | undefined;
  /** Other words for the steps (a payment to a pay link says "the owner is paid"). */
  readonly labels?: Readonly<Record<string, string>> | undefined;
  /** Initial wait seconds for testing long wait offers. */
  readonly initialWaitSeconds?: number | undefined;
}

/**
 * The page for one swap, at /app/swap/<order id>: the step-by-step progress, with the actions each
 * step needs. It picks the swap up from the recovery file kept in this browser, so a reload or a
 * return later lands exactly where the swap is. A swap that was just started locks, waits and
 * claims by itself; one that was only opened waits and claims, and asks before it locks.
 */
export function LiveOrderView({
  orderId,
  dependencies,
  start,
  embedded = false,
  labels,
  initialWaitSeconds,
}: LiveOrderViewProps) {
  const wallets = useContext(WalletContext);
  const location = useLocation();
  const startedByUser =
    start ?? (location.state as { start?: boolean } | null)?.start === true;
  const [state, setState] = useState<SwapState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [nowSeconds, setNowSeconds] = useState(() =>
    Math.floor(Date.now() / 1000),
  );
  const [missing, setMissing] = useState(false);
  const [fileJson, setFileJson] = useState<string | null>(null);
  const sessionRef = useRef<UserSwapSession | null>(null);
  const running = useRef(false);
  const walletsRef = useRef(wallets);
  walletsRef.current = wallets;
  const checkingRef = useRef(false);
  const [checking, setChecking] = useState(false);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);

  const consentKey = `ferry_finish_for_me_${orderId}`;
  const [delegationConsent, setDelegationConsent] = useState<
    'accepted' | 'dismissed' | null
  >(() => {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem(consentKey) as 'accepted' | 'dismissed' | null;
  });
  const [delegating, setDelegating] = useState(false);
  const [delegationError, setDelegationError] = useState<string | null>(null);
  const [waitStartTime, setWaitStartTime] = useState<number | null>(() => {
    if (typeof sessionStorage === 'undefined') return null;
    const stored = sessionStorage.getItem(`ferry_wait_start_${orderId}`);
    return stored ? Number(stored) : null;
  });

  const isWaitCounterLockStep = state?.step === 'waitCounterLock';

  useEffect(() => {
    if (isWaitCounterLockStep && waitStartTime === null) {
      const now = Date.now();
      setWaitStartTime(now);
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.setItem(`ferry_wait_start_${orderId}`, String(now));
      }
    }
  }, [isWaitCounterLockStep, waitStartTime, orderId]);

  const elapsedWaitSeconds =
    (waitStartTime ? (Date.now() - waitStartTime) / 1000 : 0) +
    (initialWaitSeconds ?? 0);
  const isLongWait = elapsedWaitSeconds >= 120;

  function depsFor(json: string): UserSwapDependencies {
    if (dependencies) return dependencies;
    if (!wallets)
      throw new Error('Connect your wallets to continue this swap.');
    const solverUrl = (import.meta.env?.VITE_SOLVER_URLS as string | undefined)
      ?.split(',')[0]
      ?.trim();
    if (!solverUrl) throw new Error('No solver is configured.');
    const file = parseRecoveryFileJson(json);
    // A swap into Bitcoin Cash pays the address fixed in its terms: no Bitcoin Cash wallet needed.
    const fixedRecipient =
      file.terms.direction === 'EVM_TO_BCH'
        ? cashAddressOfLocking(file.terms.userBchLockingBytecode)
        : undefined;
    return createLiveDependencies({
      wallets: {
        evm: latestWallet(() => walletsRef.current?.evm),
        bch: latestWallet(() => walletsRef.current?.bch),
      },
      solverUrl,
      chainId: file.terms.evmChainId,
      bchRecipientAddress: fixedRecipient,
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
        // Wait for the wallet that signs this direction: EVM into Bitcoin Cash, Bitcoin Cash out.
        if (!dependencies) {
          const forward =
            parseRecoveryFileJson(json).terms.direction === 'EVM_TO_BCH';
          if (forward ? !wallets?.evm.address : !wallets?.bch.address) return;
        }
        const session = await UserSwapSession.resume(
          depsFor(json),
          orderId as Hex32,
        );
        if (!active) return;
        sessionRef.current = session;
        session.subscribe((next) => active && setState(next));
        setState(session.state);
        const signerWallet =
          session.state.direction === 'EVM_TO_BCH'
            ? wallets?.evm
            : wallets?.bch;
        const canSign = !wallets || signerWallet?.status === 'connected';
        await carryOn(session, startedByUser && canSign);
      } catch (cause) {
        if (active) setError(messageOf(cause));
      }
    })();
    return () => {
      active = false;
    };
    // The swap is picked up once per order, and again when the wallets arrive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId, wallets?.bch.address?.address, wallets?.evm.address]);

  // A clock for the quote's expiry: the page notices it lapse without a reload.
  useEffect(() => {
    const timer = setInterval(
      () => setNowSeconds(Math.floor(Date.now() / 1000)),
      5_000,
    );
    return () => clearInterval(timer);
  }, []);

  // What the server holds for this order (state, transactions, times, amounts). The last copy is
  // kept in this browser and paints at once; the live answer corrects it every few seconds.
  const [cancelled, setCancelled] = useState(() => isCancelled(orderId));
  const [finishState, setFinishState] = useState<'idle' | 'working' | 'sent'>(
    'idle',
  );
  const [finishError, setFinishError] = useState<string | null>(null);
  const [snap, setSnap] = useState<OrderSnapshot | null>(() =>
    readSnapshot<OrderSnapshot>(`order.${orderId}`),
  );
  const solverBase = (import.meta.env?.VITE_SOLVER_URLS as string | undefined)
    ?.split(',')[0]
    ?.trim();
  const snapFinished = snap?.state === 'DONE';
  useEffect(() => {
    if (!solverBase) return;
    let cancelled = false;
    const read = async () => {
      const fresh = await readOrderTxids(solverBase, orderId);
      if (cancelled || !fresh) return;
      writeSnapshot(`order.${orderId}`, fresh);
      setSnap(fresh);
    };
    void read();
    const timer = setInterval(() => {
      if (!snapFinished) void read();
    }, 8_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [solverBase, orderId, snapFinished]);
  const chainTxids = (snap?.txids ?? {}) as Record<string, string>;

  // Until the swap has reached its end (done or refunded), look at the chains every 15 seconds:
  // a failed or stalled step must not leave the page frozen until it is reloaded.
  useEffect(() => {
    const timer = setInterval(() => {
      const session = sessionRef.current;
      if (!session || running.current || checkingRef.current) return;
      const step = session.state.step;
      if (step === 'done' || step === 'refunded' || step === 'lock') return;
      void (async () => {
        checkingRef.current = true;
        try {
          await session.refresh();
          setState(session.state);
          if (
            session.state.step === 'claim' ||
            session.state.step === 'waitCounterLock'
          ) {
            await carryOn(session, false);
          }
        } catch {
          // the next tick tries again
        } finally {
          checkingRef.current = false;
        }
      })();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, []);

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
      setErrorCode(cause instanceof UserFlowError ? cause.code : null);
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

  // A forward swap still waiting for its payout can be finished from here with the wallet that
  // made it (its secret is derived from that wallet).
  const canFinishHere =
    snap?.direction === 'EVM_TO_BCH' &&
    Boolean(snap.hashLock) &&
    Boolean(snap.txids?.evmLock) &&
    ![
      'DONE',
      'REFUNDED',
      'SOLVER_REFUNDED',
      'RELEASED',
      'EXPIRED',
      'REJECTED',
      'CANCELLED',
      'SECRET_KNOWN',
      'USER_CLAIM_SEEN',
      'SOLVER_CLAIM_BROADCAST',
      'SOLVER_CLAIM_FINAL',
    ].includes(snap.state);

  async function handleFinishWithWallet() {
    setFinishError(null);
    const evm = wallets?.evm;
    if (!evm?.address) {
      evm?.connect();
      return;
    }
    if (!solverBase || !snap?.hashLock) return;
    setFinishState('working');
    try {
      await finishWithWallet({
        solverUrl: solverBase,
        orderId,
        hashLock: snap.hashLock,
        signTypedData: (params) =>
          evm.signTypedData(params as Parameters<typeof evm.signTypedData>[0]),
      });
      setFinishState('sent');
    } catch (cause) {
      setFinishError(
        plainWalletMessage(cause).replace(/ Nothing was locked\.$/, ''),
      );
      setFinishState('idle');
    }
  }

  if (missing && snap?.direction) {
    return (
      <div
        className="mx-auto max-w-lg px-4 py-8 sm:px-6"
        data-testid="order-readonly"
      >
        <h1 className="text-2xl font-semibold text-text">Swap</h1>
        {snap.summary ? (
          <SwapEnds {...swapEnds(snap.direction, snap.summary)} />
        ) : null}
        <p className="mt-1 break-all font-mono text-[11px] text-text-dim">
          {orderId}
        </p>
        <div className="mt-6">
          <ProcessSteps
            steps={swapSteps(snap, snap.direction, snap.summary?.evmChainId)}
          />
        </div>
        {canFinishHere ? (
          <div
            className="mt-5 rounded-well border border-lime/30 bg-lime/5 p-4 text-xs"
            data-testid="finish-with-wallet"
          >
            <p className="text-text">
              This swap was started in another browser. Finish it here with the
              wallet that started it: sign one message and Ferry pays the{' '}
              {snap.summary?.bchToken ?? 'PUSD'} to the address set when the
              swap began, then takes your locked stablecoin. Nothing else can be
              changed.
            </p>
            {finishState === 'sent' ? (
              <p className="mt-3 text-ok" role="status">
                Sent. Ferry is paying out now; this page updates by itself.
              </p>
            ) : (
              <button
                type="button"
                disabled={finishState === 'working'}
                onClick={() => void handleFinishWithWallet()}
                className="mt-3 inline-flex h-10 items-center rounded-pill bg-lime px-5 font-semibold text-lime-ink disabled:opacity-50"
              >
                {finishState === 'working'
                  ? 'Waiting for your wallet…'
                  : wallets?.evm.address
                    ? 'Finish with your wallet'
                    : 'Connect wallet to finish'}
              </button>
            )}
            {finishError && (
              <p className="mt-2 text-danger" role="alert">
                {finishError}
              </p>
            )}
          </div>
        ) : (
          <p className="mt-4 text-xs text-text-dim">
            This swap was started in another browser, so this page only shows
            its progress.
          </p>
        )}
      </div>
    );
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

  const quoteLapsed = (() => {
    try {
      return fileJson
        ? Number(parseRecoveryFileJson(fileJson).terms.quoteExpiry) < nowSeconds
        : false;
    } catch {
      return false;
    }
  })();
  // Before the lock, an expired quote means this swap can no longer start: offer a new one.
  const mustRestart =
    state?.step === 'lock' && (quoteLapsed || errorCode === 'QUOTE_EXPIRED');
  const fileTerms = (() => {
    try {
      return fileJson ? parseRecoveryFileJson(fileJson).terms : null;
    } catch {
      return null;
    }
  })();
  const direction =
    state?.direction ?? fileTerms?.direction ?? snap?.direction ?? 'EVM_TO_BCH';
  const forward = direction === 'EVM_TO_BCH';
  const isReleased = snap?.state === 'RELEASED';
  const isKeeperRefund =
    snap?.state === 'SOLVER_REFUNDED' ||
    Boolean(snap?.txids?.evmRefund && !isReleased);
  const evmChainId = (() => {
    try {
      return fileJson
        ? parseRecoveryFileJson(fileJson).terms.evmChainId
        : (snap?.summary?.evmChainId ?? 8453);
    } catch {
      return snap?.summary?.evmChainId ?? 8453;
    }
  })();
  const evmUrl = (hash: string) => evmTxUrl(evmChainId, hash);
  const refundTxUrl = isReleased
    ? forward
      ? snap?.txids?.evmRefund
        ? evmUrl(snap.txids.evmRefund)
        : null
      : snap?.txids?.bchRefund
        ? bchTxUrl(snap.txids.bchRefund)
        : null
    : snap?.txids?.evmRefund
      ? evmUrl(snap.txids.evmRefund)
      : null;
  /** Every transaction of a step, with the block explorer page that proves it. */
  function txsFor(stepId: string) {
    const t = chainTxids;
    const mine = state?.txids;
    const evm = (label: string, hash?: string | null) =>
      hash ? [{ label, hash, url: evmUrl(hash) }] : [];
    const bch = (label: string, hash?: string | null) =>
      hash ? [{ label, hash, url: bchTxUrl(hash) }] : [];
    const own = forward ? evm : bch; // the person's lock is on their source chain
    const theirs = forward ? bch : evm; // the solver's lock is on the other chain
    const claimOn = forward ? bch : evm; // the person claims on the destination chain
    const solverClaimOn = forward ? evm : bch;
    const refundTx = isReleased
      ? forward
        ? t.evmRefund
        : (t.bchRefund ?? t.evmRefund)
      : t.evmRefund;
    const refundUrl = forward
      ? refundTx
        ? evmUrl(refundTx)
        : null
      : refundTx
        ? bchTxUrl(refundTx)
        : null;
    if (stepId === 'lock')
      return [
        ...own(
          'Your lock',
          mine?.userLock ?? (forward ? t.evmLock : t.bchLock),
        ),
        ...(refundTx && refundUrl
          ? [
              {
                label: isReleased ? 'Solver release' : 'Automatic refund',
                hash: refundTx,
                url: refundUrl,
              },
            ]
          : []),
      ];
    if (stepId === 'waitCounterLock')
      return theirs("Solver's lock", forward ? t.bchLock : t.evmLock);
    if (stepId === 'claim')
      return claimOn(
        'Your claim',
        mine?.claim ?? (forward ? t.bchClaim : t.evmClaim),
      );
    if (stepId === 'done')
      return [
        ...solverClaimOn("Solver's claim", forward ? t.evmClaim : t.bchClaim),
        ...(mine?.refund ? own('Your refund', mine.refund) : []),
      ];
    return [];
  }

  // How far the server's record says the swap is (2 = price and file done), so the page does not
  // wait for the wallet and chain reads of the session to tick what the record already shows.
  const snapIndex = (() => {
    if (!direction || !snap) return 0;
    if (isReleased || isKeeperRefund) return 3;
    const m = swapMilestones(snap, direction);
    if (m.done) return 5;
    if (m.userClaim) return 5;
    if (m.solverLock) return 4;
    if (m.userLock) return 3;
    return 2;
  })();
  const ends = (() => {
    if (fileTerms) {
      const info = evmTokenInfo(
        fileTerms.evmChainId,
        String(fileTerms.evmToken),
      );
      return swapEnds(fileTerms.direction, {
        bchToken: fileTerms.bchToken,
        bchTokenAmount: String(fileTerms.bchTokenAmount),
        evmAmount: String(fileTerms.evmAmount),
        evmChainId: fileTerms.evmChainId,
        ...(info ? { evmToken: info.symbol, evmDecimals: info.decimals } : {}),
      });
    }
    return snap?.summary && snap.direction
      ? swapEnds(snap.direction, snap.summary)
      : null;
  })();
  const sessionIndex = state ? stepIndex(state.step) : 0;
  const current = Math.max(sessionIndex, snapIndex);
  const done =
    !isReleased &&
    !isKeeperRefund &&
    (state?.step === 'done' || (snap?.state === 'DONE' && snapIndex >= 5));
  const refundReady = state?.step === 'refund';
  const needsLockStart = state?.step === 'lock' && !running.current;
  // A call that timed out may still have gone through: the server's record decides. An error is
  // hidden once the record shows the swap done, or past the step the error belongs to.
  const errorIsStale =
    Boolean(error) &&
    (snap?.state === 'DONE' ||
      (/timed out/i.test(error ?? '') && snapIndex >= 3));
  // Nothing locked on either side (the session never sent a lock, the server saw none): the person
  // may drop the swap. The saved data stays, in case a wallet sends the lock late.
  const lockSent = Boolean(
    state?.txids?.userLock || chainTxids.evmLock || chainTxids.bchLock,
  );
  const serverIdle =
    !snap?.state || snap.state === 'QUOTED' || snap.state === 'EXPIRED';
  const canCancel =
    state?.step === 'lock' &&
    !lockSent &&
    serverIdle &&
    !isReleased &&
    !isKeeperRefund;
  // Only the wallet that signs this direction's lock is needed: EVM into Bitcoin Cash, Bitcoin
  // Cash out of it.
  const waitingForWallets =
    !dependencies &&
    ((state?.direction ?? fileTerms?.direction ?? snap?.direction) ===
    'EVM_TO_BCH'
      ? !wallets?.evm.address
      : !wallets?.bch.address);
  // The wallet that signs the lock must be connected now (a remembered address is not enough).
  const signer =
    state?.direction === 'EVM_TO_BCH' ? wallets?.evm : wallets?.bch;
  const signerMissing =
    Boolean(wallets) &&
    state?.step === 'lock' &&
    signer?.status !== 'connected';

  const handleLetFerryFinish = async () => {
    setDelegating(true);
    setDelegationError(null);
    try {
      if (sessionRef.current) {
        await sessionRef.current.delegateFinish();
      } else if (fileJson) {
        const file = parseRecoveryFileJson(fileJson);
        if (file.secret) {
          const deps = depsFor(fileJson);
          await deps.solver.revealSecret(
            orderId as Hex32,
            file.secret as Hex32,
          );
        }
      }
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(consentKey, 'accepted');
      }
      setDelegationConsent('accepted');
    } catch (err) {
      setDelegationError(err instanceof Error ? err.message : String(err));
    } finally {
      setDelegating(false);
    }
  };

  const handleKeepPageOpen = () => {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(consentKey, 'dismissed');
    }
    setDelegationConsent('dismissed');
  };

  return (
    <div
      className={embedded ? '' : 'mx-auto max-w-lg px-4 py-8 sm:px-6'}
      data-testid="live-order"
    >
      {!embedded && (
        <h1 className="text-2xl font-semibold tracking-[-0.03em] text-text">
          Your swap
        </h1>
      )}
      <p className="mt-1 break-all font-mono text-[11px] text-text-dim">
        {orderId}
      </p>

      {state?.step === 'lock' && state.status === 'running' && !mustRestart && (
        <p
          className="mt-4 rounded-lg border border-hairline bg-surface-2 p-3 text-xs text-text-muted"
          data-testid="order-wallet-hint"
        >
          Approve the requests in your wallet. Locking can ask twice (approve,
          then lock). If the second request does not appear, open your wallet
          from the browser toolbar or extensions menu: some wallets, OKX
          included, do not pop up again by themselves.
        </p>
      )}

      {signerMissing && (
        <p
          className="mt-4 text-xs text-text-muted"
          data-testid="order-needs-signer"
        >
          Your {state?.direction === 'EVM_TO_BCH' ? 'EVM' : 'Bitcoin Cash'}{' '}
          wallet is not connected. Start Swap opens the connection. Nothing has
          been locked.
        </p>
      )}

      {waitingForWallets && (
        <p
          className="mt-4 rounded-lg border border-warn/30 bg-warn/10 p-3 text-xs text-warn"
          data-testid="order-needs-wallets"
        >
          Connect your wallets (the pill at the top right) to carry on with this
          swap.
        </p>
      )}

      {ends && <SwapEnds {...ends} />}

      <ol className="mt-4 space-y-3" data-testid="order-steps">
        {STEPS.map((item, index) => {
          // The price and the saved file exist before the swap has been read back: they are done
          // as soon as the recovery file is found in this browser, not when the session catches up.
          const reached =
            state || snap
              ? index < current || done
              : fileJson !== null && index < 2;
          // A swap the solver returned or that was refunded has no step in progress any more.
          const active =
            (state || snap) && !isReleased && !isKeeperRefund && !mustRestart
              ? index === current && !done
              : false;
          return (
            <li
              key={item.id}
              data-testid={`order-step-${item.id}`}
              data-state={reached ? 'done' : active ? 'active' : 'todo'}
              className={`relative flex items-start gap-3 rounded-lg border p-3 transition-colors ${
                active
                  ? 'border-lime/40 bg-surface-2'
                  : reached
                    ? 'border-hairline bg-surface-1/50'
                    : 'border-hairline bg-surface-1'
              }`}
            >
              {index < STEPS.length - 1 && (
                <span
                  aria-hidden="true"
                  data-testid={`order-link-${item.id}`}
                  className={`absolute top-full left-[22px] h-3 w-px ${
                    reached ? 'bg-lime' : 'bg-hairline'
                  }`}
                />
              )}
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
                    active
                      ? 'font-medium text-text'
                      : reached
                        ? 'text-text-muted'
                        : 'text-text-dim'
                  }
                >
                  {labels?.[item.id] ?? item.label}
                </p>
                {active && state?.waiting && (
                  <p className="mt-0.5 text-xs text-text-muted">
                    {state.waiting}
                  </p>
                )}
                {txsFor(item.id).map((tx) => (
                  <TxLink key={tx.label} {...tx} />
                ))}
                {active &&
                  item.id === 'waitCounterLock' &&
                  forward &&
                  isLongWait &&
                  delegationConsent !== 'dismissed' && (
                    <div
                      className="mt-3 rounded-lg border border-hairline bg-surface-1 p-3 text-xs"
                      data-testid="finish-for-me-offer"
                    >
                      {delegationConsent === 'accepted' ? (
                        <p
                          className="text-lime"
                          data-testid="finish-for-me-accepted"
                        >
                          Ferry then completes the payout for you and only takes
                          your funds after the payout is sent.
                        </p>
                      ) : (
                        <>
                          <p className="font-medium text-text">
                            This can take about 15 minutes on this chain. Let
                            Ferry finish it if you leave, or keep this page
                            open.
                          </p>
                          <p className="mt-1 text-text-muted">
                            Ferry then completes the payout for you and only
                            takes your funds after the payout is sent.{' '}
                            <Link
                              to="/docs/trust-model#the-optional-handoff"
                              className="text-lime underline-offset-4 hover:underline"
                            >
                              How this works
                            </Link>
                          </p>
                          {delegationError && (
                            <p className="mt-1 text-rose-400">
                              {delegationError}
                            </p>
                          )}
                          <div className="mt-2.5 flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={handleLetFerryFinish}
                              disabled={delegating}
                              data-testid="finish-for-me-btn"
                              className="rounded bg-lime px-3 py-1.5 font-medium text-lime-ink hover:bg-lime/90 disabled:opacity-50 transition-colors"
                            >
                              {delegating
                                ? 'Sending…'
                                : 'Let Ferry finish this'}
                            </button>
                            <button
                              type="button"
                              onClick={handleKeepPageOpen}
                              disabled={delegating}
                              data-testid="keep-page-open-btn"
                              className="rounded border border-hairline bg-surface-2 px-3 py-1.5 text-text-muted hover:text-text transition-colors"
                            >
                              I will keep this page open
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  )}
              </div>
            </li>
          );
        })}
      </ol>

      {isReleased && (
        <div className="mt-4 text-sm text-text" data-testid="order-released">
          <p>The solver returned your funds</p>
          {refundTxUrl && (
            <a
              href={refundTxUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 inline-flex items-center text-xs text-lime underline"
              data-testid="order-release-tx"
            >
              View transaction on block explorer
            </a>
          )}
        </div>
      )}
      {isKeeperRefund && (
        <div
          className="mt-4 text-sm text-text"
          data-testid="order-keeper-refunded"
        >
          <p>Refunded automatically</p>
          {refundTxUrl && (
            <a
              href={refundTxUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 inline-flex items-center text-xs text-lime underline"
              data-testid="order-keeper-tx"
            >
              View transaction on block explorer
            </a>
          )}
        </div>
      )}
      {!isReleased && !isKeeperRefund && state?.step === 'refunded' && (
        <p className="mt-4 text-sm text-text" data-testid="order-refunded">
          Refunded. Your funds are back with you.
        </p>
      )}
      {done && (
        <p className="mt-4 text-sm text-ok" data-testid="order-done">
          {labels?.doneMessage ??
            'Done. The claim was sent. The balance shows in your wallet once it confirms.'}
        </p>
      )}

      {error &&
        !mustRestart &&
        !isReleased &&
        !isKeeperRefund &&
        !errorIsStale && (
          <p
            role="alert"
            className="mt-4 text-sm text-danger"
            data-testid="order-error"
          >
            {error}
          </p>
        )}

      {cancelled && (
        <p className="mt-4 text-sm text-text" data-testid="order-cancelled">
          Cancelled. Nothing was locked, so there is nothing to refund. If your
          wallet still sends this lock later, refund it from the Recover page.
        </p>
      )}

      {mustRestart && (
        <p className="mt-4 text-sm text-text" data-testid="order-quote-expired">
          This quote has expired, so the solver would not honour a lock now.
          Nothing was locked.
        </p>
      )}

      <div className="mt-5 flex flex-wrap gap-2">
        {mustRestart && (
          <Link
            to={ROUTES.swap}
            data-testid="order-back-to-swap"
            className="inline-flex h-10 items-center rounded-pill bg-olive px-5 font-semibold text-text"
          >
            Back to swap
          </Link>
        )}
        {canCancel && !cancelled && (
          <button
            type="button"
            data-testid="order-cancel"
            onClick={() => {
              markCancelled(orderId);
              setCancelled(true);
            }}
            className="h-10 rounded-pill border border-hairline px-5 font-semibold text-text"
          >
            Cancel swap
          </button>
        )}
        {needsLockStart &&
          sessionRef.current &&
          !mustRestart &&
          !cancelled &&
          !isReleased &&
          !isKeeperRefund && (
            <button
              type="button"
              data-testid="order-lock-now"
              // With the signing wallet not connected, the button opens that wallet's connection
              // (the QR dialog for Bitcoin Cash); once connected, the same button locks.
              onClick={() =>
                signerMissing
                  ? signer?.connect()
                  : void carryOn(sessionRef.current!, true)
              }
              className="h-10 rounded-pill bg-olive px-5 font-semibold text-text"
            >
              Start Swap
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
          !isReleased &&
          !isKeeperRefund &&
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
        {/* A finished, released, refunded or cancelled swap has nothing left to recover. */}
        {!done &&
          !isReleased &&
          !isKeeperRefund &&
          !cancelled &&
          state?.step !== 'refunded' && (
            <button
              type="button"
              onClick={downloadFile}
              className="h-10 rounded-pill border border-hairline px-5 text-sm text-text-muted"
              data-testid="order-download"
            >
              Download recovery file
            </button>
          )}
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
        This swap can be recovered with your wallet on any device. If anything
        stops, your refund stays available.
      </p>
    </div>
  );
}
