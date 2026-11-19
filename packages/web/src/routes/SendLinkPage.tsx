import { useEffect, useState, useContext } from 'react';
import { ROUTES } from '../lib/routes';
import { useParams, useNavigate, Link } from 'react-router';
import { readSnapshot, writeSnapshot } from '../lib/paylink/snapshot-cache';
import { ProcessSteps } from '../components/links/ProcessSteps';
import {
  sendLinkSteps,
  readOrderTxids,
  type OrderSnapshot,
} from '../lib/paylink/order-steps';
import { getModeCopy } from '../lib/copy';
import { SolverContext } from '../lib/solver/context';
import type { SendLinkView } from '../lib/solver/types';
import { extractSecretFromHash } from '../lib/send/secret';
import {
  claimSendLinkLive,
  type ClaimSendLinkDependencies,
} from '../lib/send/claim-send-link';
import { WalletContext } from '../lib/wallet/context';
import { evmSignerFromWallet } from '../lib/live/ports';
import { SolverClient } from '@ferry/solver-client';
import type { SendLinkSolverPort } from '../lib/send/ports';
import type { SendLinkWaitState } from '../lib/send/types';
import type { Hex32 } from '@ferry/core';
import { useToast } from '../lib/toast/ToastContext';

type Load =
  | { readonly state: 'loading' }
  | { readonly state: 'missing' }
  | { readonly state: 'ready'; readonly link: SendLinkView };

function formatDeadline(seconds: number): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(seconds * 1000));
}

export function computeWaitState(
  status: string,
  expiresAt: number | null,
): SendLinkWaitState {
  if (status === 'pending_lock') {
    return "the sender's funds are being locked";
  }
  if (status === 'claimed') {
    return 'claimed';
  }
  if (
    status === 'expired' ||
    status === 'refunded' ||
    (expiresAt !== null && expiresAt * 1000 < Date.now())
  ) {
    return 'expired: the sender gets their funds back';
  }
  return 'ready to claim';
}

export interface SendLinkPageProps {
  readonly isLive?: boolean | undefined;
  readonly dependencies?: ClaimSendLinkDependencies | undefined;
  readonly initialSecret?: string | undefined;
}

export function SendLinkPage({
  isLive: propIsLive,
  dependencies,
  initialSecret,
}: SendLinkPageProps = {}) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const solverContext = useContext(SolverContext);
  const wallets = useContext(WalletContext);
  const copy = getModeCopy('send-link');
  const [load, setLoad] = useState<Load>(() => {
    // Paint from the last answer kept in this browser, then let the live one correct it.
    const kept = id ? readSnapshot<SendLinkView>(`sendview.${id}`) : null;
    return kept ? { state: 'ready', link: kept } : { state: 'loading' };
  });
  const [claiming, setClaiming] = useState(false);
  const [claimedLocally, setClaimedLocally] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isLive = propIsLive ?? import.meta.env?.VITE_LIVE_EXECUTION === '1';

  const [secret] = useState<Hex32 | null>(() => {
    if (initialSecret) return extractSecretFromHash(initialSecret);
    return typeof window !== 'undefined'
      ? extractSecretFromHash(window.location.hash)
      : null;
  });

  const solver = solverContext;

  useEffect(() => {
    let active = true;
    const read = solver?.getSendLink?.(id ?? '') ?? Promise.resolve(null);
    read.then(
      (link: SendLinkView | null) => {
        if (link && id) writeSnapshot(`sendview.${id}`, link);
        if (active)
          setLoad((current) =>
            link
              ? { state: 'ready', link }
              : current.state === 'ready'
                ? current
                : { state: 'missing' },
          );
      },
      () => {
        if (active) setLoad({ state: 'missing' });
      },
    );
    return () => {
      active = false;
    };
  }, [id, solver]);

  const rawLink = load.state === 'ready' ? load.link : null;
  const link = rawLink
    ? {
        ...rawLink,
        status: claimedLocally ? ('claimed' as const) : rawLink.status,
      }
    : null;

  const waitState: SendLinkWaitState | null = link
    ? computeWaitState(link.status, link.expiresAt)
    : null;

  const isReadyToClaim = waitState === 'ready to claim';
  const isPendingLock = waitState === "the sender's funds are being locked";
  const isClaimed = waitState === 'claimed';
  const isExpired = waitState === 'expired: the sender gets their funds back';

  // The funds go to the address entered when the link was made, whoever sends the claim. A
  // different wallet is told so, and cannot start the claim from here.
  const connectedEvm = wallets?.evm.address?.toLowerCase() ?? null;
  const wrongWallet =
    link !== null &&
    connectedEvm !== null &&
    connectedEvm !== link.recipientEvmAddress.toLowerCase();
  const claimable = isReadyToClaim && !claiming && !wrongWallet;

  async function handleClaim() {
    if (isLive) {
      setClaiming(true);
      setError(null);
      try {
        const activeSecret =
          secret ??
          (typeof window !== 'undefined'
            ? extractSecretFromHash(window.location.hash)
            : null);

        if (!activeSecret) {
          throw new Error(
            'Claim secret is missing from the link fragment (#...).',
          );
        }

        // The library client talks to the solver's real relay endpoint. The page's general solver
        // client has no relay method, so it is never used here.
        const solverUrl = (
          import.meta.env?.VITE_SOLVER_URLS as string | undefined
        )
          ?.split(',')[0]
          ?.trim();
        const liveSolver: SendLinkSolverPort | undefined =
          dependencies?.solver ??
          (solverUrl ? new SolverClient({ baseUrl: solverUrl }) : undefined);
        if (!liveSolver) {
          throw new Error(
            'No solver is configured, so the claim cannot be sent through it.',
          );
        }

        const evmSigner =
          dependencies?.evmSigner ??
          (wallets?.evm ? evmSignerFromWallet(wallets.evm) : undefined);

        await claimSendLinkLive(
          {
            id: id ?? '',
            secret: activeSecret,
            // The link says which lock to claim; nothing else in the page knows it.
            ...(rawLink?.lockId ? { lockId: rawLink.lockId as Hex32 } : {}),
          },
          {
            solver: liveSolver,
            evmSigner,
            chainId: dependencies?.chainId,
            htlcAddress: dependencies?.htlcAddress,
            solverEvmAddress: dependencies?.solverEvmAddress,
            hashLock: dependencies?.hashLock,
          },
        );

        setClaimedLocally(true);
        showToast('Funds claimed successfully!', 'success');
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setClaiming(false);
      }
      return;
    }

    // Default mock path (VITE_LIVE_EXECUTION off)
    setClaiming(true);
    const orderId = `sendlink-${id ?? 'claim'}`;
    void navigate(ROUTES.swapOrder(orderId));
  }

  // The steps of the swap behind the link, from the solver's record of its transactions.
  const solverUrl = (import.meta.env?.VITE_SOLVER_URLS as string | undefined)
    ?.split(',')[0]
    ?.trim();
  const [snapshot, setSnapshot] = useState<OrderSnapshot | null>(() =>
    id ? readSnapshot<OrderSnapshot>(`send.${id}`) : null,
  );
  const linkReady = load.state === 'ready' ? load.link : null;
  const finished =
    snapshot?.state === 'DONE' || linkReady?.status === 'refunded';
  useEffect(() => {
    if (!solverUrl || !id || !isLive) return;
    let active = true;
    const tick = async () => {
      const read = await readOrderTxids(solverUrl, id);
      if (!active || !read) return;
      writeSnapshot(`send.${id}`, read);
      setSnapshot(read);
    };
    void tick();
    const timer = setInterval(() => {
      if (!finished) void tick();
    }, 8_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [solverUrl, id, isLive, finished]);
  const steps =
    isLive && linkReady
      ? sendLinkSteps(
          linkReady.chain,
          snapshot,
          linkReady.status === 'claimed' || claimedLocally,
          snapshot?.state === 'DONE',
        )
      : null;

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <div className="mb-4">
        <Link
          to={ROUTES.sendLink}
          className="inline-flex items-center gap-1 text-xs text-text-muted hover:text-text transition-colors"
        >
          ← All Send Links
        </Link>
      </div>

      <div
        className={
          steps ? 'grid items-start gap-6 lg:grid-cols-2' : 'mx-auto max-w-md'
        }
      >
        <div className="card-ring relative rounded-card border border-hairline bg-surface-1 p-5 shadow-elev-card">
          {load.state === 'loading' && (
            <p className="text-xs text-text-muted" role="status">
              Loading this link…
            </p>
          )}

          {load.state === 'missing' && (
            <div data-testid="send-link-missing" className="text-xs">
              <h1 className="text-base font-semibold text-text">
                This link was not found
              </h1>
              <p className="mt-2 text-text-muted">
                It may have been mistyped, or it was made on another device. Ask
                the sender for the link again.
              </p>
            </div>
          )}

          {link && (
            <>
              <div className="mb-4 border-b border-hairline pb-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider text-lime">
                    Send Link
                  </span>
                  {waitState && (
                    <span
                      data-testid="send-link-status"
                      className="rounded-pill bg-surface-2 px-2.5 py-0.5 text-[11px] font-medium text-text border border-hairline"
                    >
                      {waitState}
                    </span>
                  )}
                </div>
                <h1 className="mt-1 text-xl font-semibold text-text">
                  {link.amount !== null
                    ? `Receive ${link.amount.toFixed(2)} ${link.token}`
                    : `Receive ${link.token}`}
                </h1>
                <p className="mt-1 text-xs text-text-muted">
                  Sent from Bitcoin Cash through Ferry atomic swap.
                </p>
              </div>

              {link.note && (
                <figure
                  data-testid="send-link-note"
                  className="mb-4 rounded-well border border-lime/30 bg-lime/5 p-3"
                >
                  <figcaption className="text-[11px] font-semibold uppercase tracking-wider text-lime">
                    Note from the sender
                  </figcaption>
                  {/* Plain text: React escapes it, so markup in a note is shown, never run. */}
                  <blockquote className="mt-1 text-sm text-text break-words">
                    {link.note}
                  </blockquote>
                </figure>
              )}

              <div className="space-y-3 mb-5 text-xs">
                <div className="rounded-well border border-hairline bg-surface-2 p-3">
                  <span className="text-text-dim block mb-1">
                    {copy.receiveLabel}
                  </span>
                  <div className="text-xl font-semibold text-text">
                    {link.amount !== null ? link.amount.toFixed(2) : '—'}{' '}
                    {link.token}
                  </div>
                  <span className="text-[11px] text-text-dim block mt-0.5">
                    On {link.chain}
                  </span>
                </div>

                {wrongWallet && (
                  <p
                    data-testid="send-link-wrong-wallet"
                    className="rounded-well border border-warn/30 bg-warn/10 p-3 text-warn"
                  >
                    This link pays {link!.recipientEvmAddress} only. Connect
                    that wallet to claim. The funds go to that address even if
                    someone else sends the claim.
                  </p>
                )}
                <div className="rounded-well border border-hairline bg-surface-2 p-3">
                  <span className="text-text-dim block mb-1">
                    Enforced Recipient Address
                  </span>
                  <span className="font-mono text-text break-all text-[11px]">
                    {link.recipientEvmAddress}
                  </span>
                </div>

                {link.expiresAt !== null && (
                  <div className="rounded-well border border-hairline bg-surface-2 p-3">
                    <span className="text-text-dim block mb-1">
                      Claim before
                    </span>
                    <span className="text-text">
                      {formatDeadline(link.expiresAt)}
                    </span>
                  </div>
                )}
              </div>

              {error && (
                <p className="mb-3 text-danger text-xs" role="alert">
                  {error}
                </p>
              )}

              <button
                type="button"
                data-testid="send-link-submit-button"
                disabled={claiming || !claimable}
                onClick={handleClaim}
                className="flex h-11 w-full items-center justify-center gap-2 rounded-pill bg-olive text-text font-semibold hover:bg-olive/90 transition-colors cursor-pointer shadow-elev-pill disabled:opacity-40"
              >
                <span>
                  {claiming
                    ? 'Processing claim…'
                    : isPendingLock
                      ? "the sender's funds are being locked"
                      : isReadyToClaim
                        ? copy.actionLabel
                        : isClaimed
                          ? 'Claimed'
                          : isExpired
                            ? 'expired: the sender gets their funds back'
                            : 'This link is no longer open'}
                </span>
              </button>

              <p className="mt-3 text-center text-[11px] text-text-dim">
                Direct atomic claim. If unclaimed within the time window, funds
                return safely to the sender.
              </p>
            </>
          )}
        </div>

        {steps && (
          <section
            className="rounded-card border border-hairline bg-surface-1 p-5 shadow-elev-card"
            aria-label="Progress"
            data-testid="send-link-progress"
          >
            <h2 className="mb-3 text-sm font-semibold text-text">Progress</h2>
            <ProcessSteps steps={steps} />
          </section>
        )}
      </div>
    </div>
  );
}
