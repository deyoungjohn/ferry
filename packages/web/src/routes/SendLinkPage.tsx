import { useEffect, useState, useContext } from 'react';
import { LinkHowItWorks } from '../components/links/LinkHowItWorks';
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
import type { SendLinkView, SolverClient } from '../lib/solver/types';
import { extractSecretFromHash } from '../lib/send/secret';
import { loadSendLink } from '../lib/paylink/send-store';
import {
  claimSendLinkLive,
  type ClaimSendLinkDependencies,
} from '../lib/send/claim-send-link';
import { WalletContext } from '../lib/wallet/context';
import { evmSignerFromWallet } from '../lib/live/ports';
import { SolverClient as RealSolverClient } from '@ferry/solver-client';
import { plainWalletMessage } from '@ferry/user-flow';
import type { SendLinkSolverPort } from '../lib/send/ports';
import type { SendLinkWaitState } from '../lib/send/types';
import type { Hex32, LiquidityResponse } from '@ferry/core';
import { switchRouteRequestTypedData } from '@ferry/core/api';
import { useToast } from '../lib/toast/ToastContext';
import {
  evaluateReceiverRoutes,
  findAlternativeRoutes,
  normalizeChainKey,
  type ReceiverRouteOption,
} from '../lib/send/receiver-routes';
import { farTokenFacts } from '../lib/solver/core-quote';

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

function formatTimeLeft(seconds: number): string {
  if (seconds <= 0) return 'Expired';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) {
    return `${hours}h ${minutes}m left`;
  }
  return `${minutes}m left`;
}

function computeWaitState(
  status: string,
  expiresAt: number | null,
): SendLinkWaitState {
  if (status === 'cancelled') {
    return 'cancelled by the sender';
  }
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
  const solverUrl = (import.meta.env?.VITE_SOLVER_URLS as string | undefined)
    ?.split(',')[0]
    ?.trim();

  const [switchingRoute, setSwitchingRoute] = useState(false);
  const [liquidity, setLiquidity] = useState<LiquidityResponse | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => {
      setNowMs(Date.now());
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  // Fetch liquidity for receiver route options
  useEffect(() => {
    let active = true;
    const fetchLiquidity = async () => {
      try {
        const liveSolver =
          dependencies?.solver ??
          (solverUrl
            ? new RealSolverClient({ baseUrl: solverUrl })
            : undefined) ??
          solverContext;
        if (liveSolver && 'getLiquidity' in liveSolver) {
          const res = await (
            liveSolver as unknown as SolverClient
          ).getLiquidity();
          if (active && res) setLiquidity(res);
        }
      } catch {
        // Telemetry fallback
      }
    };
    void fetchLiquidity();
    return () => {
      active = false;
    };
  }, [dependencies, solverContext, solverUrl]);

  // The secret rides in the link's fragment. The sender's own browser also keeps it, so a link of
  // theirs opens ready to claim even when the fragment was lost on the way.
  const [secret] = useState<Hex32 | null>(() => {
    const fromLink = initialSecret
      ? extractSecretFromHash(initialSecret)
      : typeof window !== 'undefined'
        ? extractSecretFromHash(window.location.hash)
        : null;
    if (fromLink) return fromLink;
    const kept = id ? loadSendLink(id)?.secret : undefined;
    return kept ? extractSecretFromHash(kept) : null;
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

  const isCancelled = waitState === 'cancelled by the sender';
  const isReadyToClaim = waitState === 'ready to claim';
  const isPendingLock = waitState === "the sender's funds are being locked";
  const isClaimed = waitState === 'claimed';
  const isExpired = waitState === 'expired: the sender gets their funds back';

  const nowSeconds = Math.floor(nowMs / 1000);
  const secondsLeft =
    link?.expiresAt !== null && link?.expiresAt !== undefined
      ? Math.max(0, link.expiresAt - nowSeconds)
      : null;
  // Safety margin: 30 minutes (1800s) buffer before deadline while still open
  const isTooLate =
    !isExpired && !isClaimed && secondsLeft !== null && secondsLeft < 1800;

  const currentRouteKey = link
    ? `${link.token.toLowerCase()}:${normalizeChainKey(link.chain)}`
    : '';
  const evaluatedRoutes = evaluateReceiverRoutes(liquidity, link?.amount ?? 0);
  const currentRouteOption = evaluatedRoutes.find(
    (r) => r.routeKey.toLowerCase() === currentRouteKey.toLowerCase(),
  );

  const isShortLiquidity =
    liquidity !== null &&
    Array.isArray(liquidity.routes) &&
    liquidity.routes.length > 0 &&
    (!currentRouteOption || !currentRouteOption.hasLiquidity);

  const alternativeRoutes = findAlternativeRoutes(
    liquidity,
    currentRouteKey,
    link?.amount ?? 0,
  );

  const canSwitchRoute =
    link !== null &&
    !isCancelled &&
    link.status !== 'cancelled' &&
    !link.lockId &&
    (link.status === 'pending_lock' ||
      (link.status === 'open' && !link.lockId)) &&
    !claimedLocally &&
    !isTooLate;

  // The funds go to the address entered when the link was made, whoever sends the claim. A
  // different wallet is told so, and cannot start the claim from here.
  const connectedEvm = wallets?.evm.address?.toLowerCase() ?? null;
  const wrongWallet =
    link !== null &&
    connectedEvm !== null &&
    connectedEvm !== link.recipientEvmAddress.toLowerCase();
  const claimable =
    isReadyToClaim && !claiming && !wrongWallet && !isCancelled && !isTooLate;

  async function handleSwitchRoute(target: ReceiverRouteOption) {
    if (!link) return;

    if (isLive && wallets && !wallets.evm.address) {
      wallets.evm.connect();
      return;
    }

    const now = Math.floor(Date.now() / 1000);
    const timeLeft = link.expiresAt ? link.expiresAt - now : null;
    if (timeLeft !== null && timeLeft < 1800) {
      setError(
        'This send link can no longer be claimed in time. The sender will receive a refund on Bitcoin Cash.',
      );
      return;
    }

    if (
      isCancelled ||
      link.lockId ||
      link.status === 'locked' ||
      link.status === 'claimed' ||
      link.status === 'expired' ||
      link.status === 'refunded' ||
      link.status === 'cancelled'
    ) {
      setError(
        isCancelled || link.status === 'cancelled'
          ? 'Cannot switch route: this send link has been cancelled'
          : 'Cannot switch route: the solver has already locked funds on the destination chain',
      );
      return;
    }

    const connectedAddress = wallets?.evm.address?.toLowerCase();
    if (
      connectedAddress &&
      connectedAddress !== link.recipientEvmAddress.toLowerCase()
    ) {
      setError(
        `Only ${link.recipientEvmAddress} can change this route: sign the switch request with that wallet`,
      );
      return;
    }

    const facts = farTokenFacts(target.chain, target.asset);
    const targetChainId = target.chainId ?? facts?.chainId;
    const targetToken = facts?.address;

    if (!targetChainId || !targetToken) {
      setError(
        `Cannot find token facts for ${target.asset} on ${target.chain}`,
      );
      return;
    }

    setSwitchingRoute(true);
    setError(null);
    try {
      const activeOrderId = (link.orderId ?? link.id) as `0x${string}`;
      const typed = switchRouteRequestTypedData({
        orderId: activeOrderId.startsWith('0x')
          ? activeOrderId
          : `0x${activeOrderId}`,
        targetChainId,
        token: targetToken,
      });

      const evmSigner =
        dependencies?.evmSigner ??
        (wallets?.evm ? evmSignerFromWallet(wallets.evm) : undefined);

      if (!evmSigner) {
        throw new Error('EVM signer not available to authorize route switch');
      }

      const signature = await evmSigner.signTypedData(typed);

      const liveSolver =
        dependencies?.solver ??
        (solverUrl
          ? new RealSolverClient({ baseUrl: solverUrl })
          : undefined) ??
        solverContext;

      if (!liveSolver?.switchSendLinkRoute) {
        throw new Error('Solver client does not support route switching');
      }

      await liveSolver.switchSendLinkRoute(id ?? '', {
        chainId: targetChainId,
        token: targetToken,
        signature,
      });

      showToast(`Switched route to ${target.chain.toUpperCase()}!`, 'success');

      // Refresh link details
      if (solver?.getSendLink && id) {
        const updated = await solver.getSendLink(id);
        if (updated) {
          setLoad({ state: 'ready', link: updated });
          writeSnapshot(`sendview.${id}`, updated);
        }
      }
    } catch (cause) {
      const text = cause instanceof Error ? cause.message : String(cause);
      setError(
        /^(Only 0x|Cannot switch|This send link|Your wallet)/.test(text)
          ? text
          : plainWalletMessage(cause),
      );
    } finally {
      setSwitchingRoute(false);
    }
  }

  async function handleClaim() {
    if (isLive && wallets && !wallets.evm.address) {
      // No EVM wallet yet: the button first connects one, then the person presses it again.
      wallets.evm.connect();
      return;
    }
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
            'This link is incomplete. Open the full link the sender shared: it ends with a long code after #.',
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
          (solverUrl
            ? new RealSolverClient({ baseUrl: solverUrl })
            : undefined);
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
            recipientEvmAddress: link?.recipientEvmAddress,
            secret: activeSecret,
            // The link says which lock to claim; nothing else in the page knows it.
            ...(rawLink?.lockId ? { lockId: rawLink.lockId as Hex32 } : {}),
            ...(rawLink?.chainId ? { chainId: rawLink.chainId } : {}),
          },
          {
            solver: liveSolver,
            evmSigner,
            chainId: rawLink?.chainId ?? dependencies?.chainId,
            htlcAddress: dependencies?.htlcAddress,
            solverEvmAddress: dependencies?.solverEvmAddress,
            hashLock: dependencies?.hashLock,
          },
        );

        setClaimedLocally(true);
        showToast('Funds claimed successfully!', 'success');
      } catch (cause) {
        const text = cause instanceof Error ? cause.message : String(cause);
        // Our own sentences pass through; a wallet or library failure is put in plain words.
        setError(
          /^(Your wallet|The connected wallet|This link|No solver|Only 0x|The solver)/.test(
            text,
          )
            ? text
            : plainWalletMessage(cause).replace(/ Nothing was locked\.$/, ''),
        );
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
      <div className="mb-4 flex items-center justify-between">
        <Link
          to={ROUTES.sendLink}
          className="inline-flex items-center gap-1 text-xs text-text-muted hover:text-text transition-colors"
        >
          ← All Send Links
        </Link>
        <LinkHowItWorks kind="send" />
      </div>

      <div
        className={
          steps ? 'grid items-stretch gap-6 lg:grid-cols-2' : 'mx-auto max-w-md'
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
                    <div className="flex items-center justify-between">
                      <span className="text-text-dim block mb-1">
                        Claim before
                      </span>
                      {secondsLeft !== null && (
                        <span
                          data-testid="send-link-time-left"
                          className={`text-[11px] font-medium ${isTooLate ? 'text-danger font-semibold' : 'text-text-muted'}`}
                        >
                          {formatTimeLeft(secondsLeft)}
                        </span>
                      )}
                    </div>
                    <span className="text-text">
                      {formatDeadline(link.expiresAt)}
                    </span>
                  </div>
                )}
              </div>

              {isTooLate && (
                <div
                  data-testid="send-link-too-late-notice"
                  className="mb-4 rounded-well border border-danger/30 bg-danger/10 p-3 text-danger text-xs"
                  role="alert"
                >
                  This send link can no longer be claimed in time. The sender
                  will receive a refund on Bitcoin Cash.
                </div>
              )}

              {isShortLiquidity && (
                <div
                  data-testid="send-link-liquidity-warning"
                  className="mb-4 rounded-well border border-warn/30 bg-warn/10 p-3 text-warn text-xs"
                >
                  <p className="font-semibold">
                    Not enough liquidity on {link.chain} right now
                  </p>
                  {alternativeRoutes.length > 0 && (
                    <div className="mt-2">
                      <p className="text-[11px] text-text-muted mb-2">
                        Switch to an alternative chain with available liquidity:
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {alternativeRoutes.map((alt) => (
                          <button
                            key={alt.routeKey}
                            type="button"
                            data-testid={`switch-route-${alt.chain.toLowerCase()}`}
                            disabled={switchingRoute || isTooLate}
                            onClick={() => handleSwitchRoute(alt)}
                            className="rounded-pill bg-surface-2 border border-hairline px-3 py-1 text-xs font-medium text-text hover:bg-surface-3 transition-colors cursor-pointer disabled:opacity-50"
                          >
                            Switch to {alt.chain.toUpperCase()} ({alt.asset})
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {canSwitchRoute &&
                !isShortLiquidity &&
                alternativeRoutes.length > 0 && (
                  <div
                    data-testid="send-link-route-selector"
                    className="mb-4 rounded-well border border-hairline bg-surface-2 p-3 text-xs"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-text-dim">
                        Receiver route choice
                      </span>
                      <span className="text-[11px] text-lime font-medium">
                        Available
                      </span>
                    </div>
                    <p className="text-[11px] text-text-muted mb-2">
                      You can switch destination chain before solver locks
                      funds:
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {alternativeRoutes.map((alt) => (
                        <button
                          key={alt.routeKey}
                          type="button"
                          data-testid={`switch-route-${alt.chain.toLowerCase()}`}
                          disabled={switchingRoute}
                          onClick={() => handleSwitchRoute(alt)}
                          className="rounded-pill bg-surface-1 border border-hairline px-2.5 py-1 text-[11px] font-medium text-text hover:bg-surface-3 transition-colors cursor-pointer disabled:opacity-50"
                        >
                          Switch to {alt.chain.toUpperCase()}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

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
                      : isCancelled
                        ? 'Cancelled by the sender'
                        : isExpired
                          ? 'expired: the sender gets their funds back'
                          : isClaimed
                            ? 'Claimed'
                            : isTooLate
                              ? 'Expired: cannot be claimed in time'
                              : isReadyToClaim
                                ? isLive && wallets && !wallets.evm.address
                                  ? 'Connect and claim'
                                  : 'Claim'
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
            className="flex flex-col rounded-card border border-hairline bg-surface-1 p-5 shadow-elev-card"
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
