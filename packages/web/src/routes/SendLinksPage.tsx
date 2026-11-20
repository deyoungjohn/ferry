import { MIN_TRANSACTION_USD, type Hex32 } from '@ferry/core';
import { LinkHowItWorks } from '../components/links/LinkHowItWorks';
import { useState, useContext, useEffect, type FormEvent } from 'react';
import {
  SEND_LINK_NOTE_MAX_LENGTH,
  type CancelSendLinkQuota,
  type SendLinkQueryMatch,
} from '@ferry/core/api';
import { SolverClient } from '@ferry/solver-client';
import { Link } from 'react-router';
import { QRCodeSVG } from 'qrcode.react';
import { isAddress } from 'viem';
import { sendLinkUrl, type SendLinkData } from '../lib/paylink/link';
import { NETWORK_PROFILE } from '../lib/config';
import { GlassModal } from '../components/GlassModal';
import { readOrderTxids } from '../lib/paylink/order-steps';
import { chainIconUrl, tokenIconUrl } from '../lib/icons';
import { MorphWorkspace } from '../components/links/MorphWorkspace';
import { LinksTable, type LinkRow } from '../components/links/LinksTable';
import { useToast } from '../lib/toast/ToastContext';
import { Select } from '../components/ui/select';
import { ClaimWindowField } from '../components/ui/claim-window';
import {
  claimWindow,
  defaultCustomExpiry,
  type ClaimWindowChoice,
} from '../lib/paylink/claim-window';
import {
  cleanNote,
  listSendLinks,
  saveSendLink,
} from '../lib/paylink/send-store';
import { WalletContext } from '../lib/wallet/context';
import { SolverContext } from '../lib/solver/context';
import { createBrowserBchChain } from '../lib/live/bch-chain';
import { bchSignerFromWallet } from '../lib/live/ports';
import { createLocalRecoveryStore } from '../lib/live/recovery-store';
import {
  createWalletSecretGenerator,
  createRescueSecretGenerator,
  getOrDeriveRecoveryRoot,
  browserRecoveryStorage,
  type SecretGenerator,
} from '../lib/recovery/recovery-key-service';
import { scanWalletSendLinks } from '../lib/send/wallet-send-links';
import { downloadJson } from '../lib/send/download';
import type {
  SendLinkDependencies,
  SendLinkSolverPort,
} from '../lib/send/ports';
import { createSendLinkLive } from '../lib/send/create-send-link';
import { resumeSendLinkLock } from '../lib/send/resume-send-link';

export interface SendLinksPageProps {
  readonly isLive?: boolean | undefined;
  readonly dependencies?: SendLinkDependencies | undefined;
}

function toRow(link: SendLinkData): LinkRow {
  const lock =
    link.lockStatus === 'pending_lock'
      ? { status: 'Pending lock', tone: 'warn' as const }
      : link.status === 'cancelled' || link.lockStatus === 'cancelled'
        ? { status: 'Cancelled', tone: 'neutral' as const }
        : link.status === 'claimed' || link.lockStatus === 'claimed'
          ? { status: 'Claimed', tone: 'ok' as const }
          : link.status === 'expired' || link.lockStatus === 'expired'
            ? { status: 'Expired', tone: 'warn' as const }
            : link.lockStatus === 'refunded'
              ? { status: 'Refunded', tone: 'neutral' as const }
              : link.lockStatus === 'released'
                ? { status: 'Released', tone: 'neutral' as const }
                : link.lockStatus === 'locked'
                  ? { status: 'Locked', tone: 'ok' as const }
                  : { status: 'Open', tone: 'neutral' as const };
  return {
    id: link.id,
    // With the secret in the fragment (kept only in this browser), so the link opens ready to claim.
    href: link.secret
      ? `/send/${link.id}#${link.secret.replace(/^0x/i, '')}`
      : `/send/${link.id}`,
    amount: `${link.amount.toFixed(2)} ${link.destinationToken} (${link.destinationChain})`,
    createdAt: link.createdAt,
    completedAt: link.status === 'claimed' ? (link.claimedAt ?? null) : null,
    ...lock,
  };
}

export function SendLinksPage({
  isLive: propIsLive,
  dependencies: propDependencies,
}: SendLinksPageProps = {}) {
  const { showToast } = useToast();
  const farChains = NETWORK_PROFILE.farChains;
  const [destChain, setDestChain] = useState(farChains[0]?.name ?? 'Base');
  const [destToken, setDestToken] = useState('USDC');
  const [recipientEvm, setRecipientEvm] = useState('');
  const [amount, setAmount] = useState('20.00');
  const [windowChoice, setWindowChoice] = useState<ClaimWindowChoice>('24h');
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [customExpiry, setCustomExpiry] = useState(() =>
    defaultCustomExpiry(Date.now()),
  );
  const [note, setNote] = useState('');
  const [createdLinks, setCreatedLinks] = useState<SendLinkData[]>(() =>
    listSendLinks(),
  );
  const [activeCreated, setActiveCreated] = useState<SendLinkData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [resumingId, setResumingId] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [isContractWallet, setIsContractWallet] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<SendLinkData | null>(null);
  const [cancelQuota, setCancelQuota] = useState<CancelSendLinkQuota | null>(
    null,
  );
  const [isCancelling, setIsCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  async function openCancelModal(link: SendLinkData) {
    setCancelTarget(link);
    setCancelError(null);
    setCancelQuota(null);
    const solverUrl = listSolverUrl ?? 'http://localhost:3000';
    try {
      const res = await fetch(
        `${solverUrl.replace(/\/+$/, '')}/v1/send-links/${encodeURIComponent(link.id)}/cancel-quota`,
      );
      if (res.ok) {
        const quota = (await res.json()) as CancelSendLinkQuota;
        setCancelQuota(quota);
      } else {
        setCancelQuota({
          dailyUsed: 0,
          dailyLimit: 2,
          dailyRemaining: 2,
          monthlyUsed: 0,
          monthlyLimit: 10,
          monthlyRemaining: 10,
        });
      }
    } catch {
      setCancelQuota({
        dailyUsed: 0,
        dailyLimit: 2,
        dailyRemaining: 2,
        monthlyUsed: 0,
        monthlyLimit: 10,
        monthlyRemaining: 10,
      });
    }
  }

  async function handleConfirmCancel() {
    if (!cancelTarget) return;
    setIsCancelling(true);
    setCancelError(null);
    const solverUrl = listSolverUrl ?? 'http://localhost:3000';

    try {
      let recoveryRoot: string | undefined;
      if (wallets?.evm.address) {
        try {
          const rootResult = await getOrDeriveRecoveryRoot(wallets.evm);
          if (rootResult.root) {
            recoveryRoot = rootResult.root;
          }
        } catch {
          // ignore
        }
      }

      if (!recoveryRoot && wallets?.evm.address) {
        const stored = await browserRecoveryStorage.get(
          `ferry.recovery.root.${wallets.evm.address.toLowerCase()}`,
        );
        if (stored) recoveryRoot = stored;
      }

      const payload: Record<string, unknown> = {};
      if (recoveryRoot) {
        payload.recoveryRoot = recoveryRoot;
      }

      const res = await fetch(
        `${solverUrl.replace(/\/+$/, '')}/v1/send-links/${encodeURIComponent(cancelTarget.id)}/cancel`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );

      if (!res.ok) {
        const errJson = (await res.json()) as {
          error?: { code?: string; message?: string };
        };
        throw new Error(
          errJson.error?.message ?? `Failed to cancel (${res.status})`,
        );
      }

      const next: SendLinkData = {
        ...cancelTarget,
        status: 'cancelled',
        lockStatus: 'cancelled',
      };
      saveSendLink(next);
      setCreatedLinks(listSendLinks());
      showToast(
        'Send link cancelled. Funds refunded to Bitcoin Cash.',
        'success',
      );
      setCancelTarget(null);
    } catch (err) {
      setCancelError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsCancelling(false);
    }
  }

  // The recovery file is never downloaded behind the person's back: a dialog asks them to save it
  // first, and the lock waits until they have.
  const [pendingFile, setPendingFile] = useState<{
    filename: string;
    json: string;
    resolve: () => void;
    reject: (reason: Error) => void;
  } | null>(null);
  const [fileSaved, setFileSaved] = useState(false);
  function askToSaveRecoveryFile(filename: string, json: string) {
    setFileSaved(false);
    return new Promise<boolean>((resolve, reject) => {
      setPendingFile({
        filename,
        json,
        resolve: () => resolve(true),
        reject,
      });
    });
  }

  // The table is the sender's own list, so it asks the solver what became of each link (claimed,
  // refunded, expired) on opening and every 15 seconds, and keeps what it learns.
  const listSolverUrl = (
    import.meta.env?.VITE_SOLVER_URLS as string | undefined
  )
    ?.split(',')[0]
    ?.trim();
  useEffect(() => {
    if (!listSolverUrl) return;
    let active = true;
    const refresh = async () => {
      let changed = false;
      for (const link of listSendLinks()) {
        if (link.status !== 'open' || link.lockStatus === 'pending_lock')
          continue;
        const snapshot = await readOrderTxids(listSolverUrl, link.id);
        if (!snapshot || !active) continue;
        const reached = (names: readonly string[]) =>
          snapshot.timeline?.find((e) => names.includes(e.status))?.at;
        let next: SendLinkData | null = null;
        if (snapshot.state === 'SECRET_KNOWN' || snapshot.state === 'DONE') {
          next = {
            ...link,
            status: 'claimed',
            claimedAt:
              reached(['SECRET_KNOWN', 'DONE']) ??
              snapshot.updatedAt ??
              link.claimedAt,
          };
        } else if (snapshot.state === 'CANCELLED') {
          next = { ...link, status: 'cancelled', lockStatus: 'cancelled' };
        } else if (
          snapshot.state === 'REFUNDED' ||
          snapshot.state === 'SOLVER_REFUNDED'
        ) {
          next = { ...link, status: 'expired' };
        } else if (snapshot.state === 'EXPIRED') {
          next = { ...link, status: 'expired' };
        }
        if (next) {
          saveSendLink(next);
          changed = true;
        }
      }
      if (active && changed) setCreatedLinks(listSendLinks());
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 15_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [listSolverUrl]);

  const wallets = useContext(WalletContext);
  const solverContext = useContext(SolverContext);

  const isLive = propIsLive ?? import.meta.env?.VITE_LIVE_EXECUTION === '1';

  function resolveDependencies(): SendLinkDependencies {
    let secretGenerator: SecretGenerator | undefined;
    if (wallets?.evm.address) {
      secretGenerator = createWalletSecretGenerator(wallets.evm);
    } else {
      secretGenerator = createRescueSecretGenerator();
    }

    if (propDependencies) {
      return {
        ...propDependencies,
        secretGenerator: propDependencies.secretGenerator ?? secretGenerator,
      };
    }

    const bchAddress = wallets?.bch.address?.address;
    if (!bchAddress || !wallets?.bch) {
      throw new Error('Connect a Bitcoin Cash wallet first.');
    }

    const solverUrl =
      (import.meta.env?.VITE_SOLVER_URLS as string | undefined)?.split(
        ',',
      )[0] ?? 'http://localhost:3000';

    const solver: SendLinkSolverPort =
      typeof (solverContext as unknown as SendLinkSolverPort)?.quoteSendLink ===
      'function'
        ? (solverContext as unknown as SendLinkSolverPort)
        : new SolverClient({ baseUrl: solverUrl });

    return {
      solver,
      bchSigner: bchSignerFromWallet(wallets.bch),
      bchChain: createBrowserBchChain({ solverUrl }),
      store: createLocalRecoveryStore(),
      bchCashAddress: bchAddress,
      bchNetwork: NETWORK_PROFILE.bch.network,
      downloadFile: askToSaveRecoveryFile,
      secretGenerator,
    };
  }

  useEffect(() => {
    let active = true;

    async function loadWalletLinks() {
      const solverUrl = listSolverUrl ?? 'http://localhost:3000';
      const queryFn = (
        propDependencies?.solver as unknown as {
          querySendLinks?: (
            tags: readonly Hex32[],
          ) => Promise<readonly SendLinkQueryMatch[]>;
        }
      )?.querySendLinks;

      if (wallets?.evm.address && wallets.evm.status === 'connected') {
        try {
          setIsScanning(true);
          const rootResult = await getOrDeriveRecoveryRoot(wallets.evm);

          if (!active) return;

          if (rootResult.isContract || !rootResult.root) {
            setIsContractWallet(true);
            setIsScanning(false);
            return;
          }

          setIsContractWallet(false);
          const scanResult = await scanWalletSendLinks({
            root: rootResult.root,
            solverUrl,
            queryFn,
          });

          if (!active) return;

          setCreatedLinks((localLinks) => {
            const merged = [...scanResult.links];
            for (const local of localLinks) {
              if (!merged.some((m) => m.id === local.id)) {
                merged.push(local);
              }
            }
            merged.sort((a, b) => b.createdAt - a.createdAt);
            return merged;
          });
        } catch {
          // If scan fails, keep existing links
        } finally {
          if (active) setIsScanning(false);
        }
      } else {
        // Without EVM wallet connected, scan using browser rescue root if present
        try {
          const rescueRoot =
            await browserRecoveryStorage.get('ferry.rescue.root');
          if (
            rescueRoot &&
            rescueRoot.startsWith('0x') &&
            rescueRoot.length === 66 &&
            active
          ) {
            setIsScanning(true);
            const scanResult = await scanWalletSendLinks({
              root: rescueRoot as Hex32,
              solverUrl,
              queryFn,
            });

            if (!active) return;

            setCreatedLinks((localLinks) => {
              const merged = [...scanResult.links];
              for (const local of localLinks) {
                if (!merged.some((m) => m.id === local.id)) {
                  merged.push(local);
                }
              }
              merged.sort((a, b) => b.createdAt - a.createdAt);
              return merged;
            });
          }
        } catch {
          // Ignore
        } finally {
          if (active) setIsScanning(false);
        }
      }
    }

    void loadWalletLinks();

    return () => {
      active = false;
    };
  }, [
    wallets?.evm.address,
    wallets?.evm.status,
    listSolverUrl,
    propDependencies,
  ]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const trimmed = recipientEvm.trim();
    if (!trimmed || !isAddress(trimmed)) {
      setError('Please enter a valid destination EVM address');
      return;
    }

    const numAmount = parseFloat(amount);
    if (!numAmount || numAmount <= 0) {
      setError('Please enter a valid amount');
      return;
    }
    if (numAmount < MIN_TRANSACTION_USD) {
      setError('The minimum is $' + MIN_TRANSACTION_USD.toFixed(2) + '.');
      return;
    }

    const now = Date.now();
    setNowMs(now);
    const window = claimWindow(windowChoice, customExpiry, now);
    if (!window.ok) {
      setError(window.message);
      return;
    }

    if (isLive) {
      // The Bitcoin Cash wallet signs the lock: if it is not connected, open its connection.
      if (
        !propDependencies &&
        wallets?.bch.status !== undefined &&
        wallets.bch.status !== 'connected'
      ) {
        wallets?.bch.connect();
        return;
      }
      setIsSubmitting(true);
      try {
        const deps = resolveDependencies();
        const result = await createSendLinkLive(
          {
            recipientEvmAddress: trimmed,
            destChain,
            destToken,
            amount: numAmount,
            windowSeconds: window.windowSeconds,
            note: cleanNote(note),
          },
          deps,
        );

        const newLink: SendLinkData = {
          id: result.orderId,
          orderId: result.orderId,
          destinationChain: destChain,
          destinationToken: destToken,
          recipientEvmAddress: trimmed,
          amount: numAmount,
          windowSeconds: window.windowSeconds,
          expiresAt: result.expiresAt,
          note: cleanNote(note),
          status: 'open',
          createdAt: Math.floor(now / 1000),
          secret: result.secret,
          refundDate: result.refundDate,
          txId: result.bchLockTxId,
          recoveryJson: result.recoveryJson,
          lockStatus: 'locked',
        };

        setCreatedLinks(listSendLinks());
        setActiveCreated(newLink);
        showToast('Send link created and Bitcoin Cash funds locked', 'success');
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
        setCreatedLinks(listSendLinks());
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    // Default mock path (VITE_LIVE_EXECUTION off)
    const newId = 'sl-' + Math.random().toString(36).substring(2, 10);
    const newLink: SendLinkData = {
      id: newId,
      destinationChain: destChain,
      destinationToken: destToken,
      recipientEvmAddress: trimmed,
      amount: numAmount,
      windowSeconds: window.windowSeconds,
      expiresAt: Math.floor(window.expiresAtMs / 1000),
      note: cleanNote(note),
      status: 'open',
      createdAt: Math.floor(now / 1000),
    };

    saveSendLink(newLink);
    setCreatedLinks((prev) => [newLink, ...prev]);
    setActiveCreated(newLink);
  }

  async function handleResume(link: SendLinkData) {
    setError(null);
    setResumingId(link.id);
    try {
      const deps = resolveDependencies();
      const result = await resumeSendLinkLock(link, deps);
      setCreatedLinks(listSendLinks());
      const updated: SendLinkData = {
        ...link,
        lockStatus: 'locked',
        txId: result.bchLockTxId,
      };
      setActiveCreated(updated);
      showToast('Send link lock completed successfully', 'success');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setResumingId(null);
    }
  }

  function handleCopy(url: string) {
    void navigator.clipboard.writeText(url);
    setCopied(true);
    showToast('Send link copied to clipboard', 'success');
    setTimeout(() => setCopied(false), 2000);
  }

  const activeUrl = activeCreated
    ? sendLinkUrl(activeCreated.id, activeCreated.secret)
    : '';

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      {/* Header */}
      <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-text">
            Send Links
          </h1>
          <p className="text-xs text-text-muted">
            Send stablecoins from Bitcoin Cash to someone on another chain with
            an automatic refund window.
          </p>
          <div className="mt-1">
            <LinkHowItWorks kind="send" />
          </div>
        </div>
        <Link
          to="/"
          className="inline-flex h-8 items-center gap-1.5 rounded-pill border border-hairline bg-surface-2 px-3 text-xs font-semibold text-text hover:border-lime/40 transition-colors self-start sm:self-auto"
        >
          ← Back to Swap
        </Link>
      </div>

      <GlassModal
        open={pendingFile !== null}
        onOpenChange={(open) => {
          if (!open && pendingFile) {
            pendingFile.reject(
              new Error('Cancelled. Nothing was locked and no file was saved.'),
            );
            setPendingFile(null);
          }
        }}
        title="Save your recovery file first"
        description="It is the only way to get your funds back if this site is ever unreachable. Nothing is locked until you continue."
      >
        <div className="flex flex-col gap-3">
          <button
            type="button"
            data-testid="save-recovery-file"
            onClick={() => {
              if (pendingFile) {
                downloadJson(pendingFile.filename, pendingFile.json);
                setFileSaved(true);
              }
            }}
            className="h-10 rounded-pill border border-hairline bg-surface-2 px-5 font-medium text-text"
          >
            Download recovery file
          </button>
          <button
            type="button"
            data-testid="continue-after-save"
            disabled={!fileSaved}
            onClick={() => {
              pendingFile?.resolve();
              setPendingFile(null);
            }}
            className="h-10 rounded-pill bg-olive px-5 font-semibold text-text"
          >
            Continue to lock
          </button>
        </div>
      </GlassModal>

      <GlassModal
        open={cancelTarget !== null}
        onOpenChange={(open) => {
          if (!open && !isCancelling) {
            setCancelTarget(null);
            setCancelError(null);
          }
        }}
        title="Cancel send link & refund"
        description="Cancelling returns your locked Bitcoin Cash directly to your address. The receiver will no longer be able to claim it."
      >
        <div className="flex flex-col gap-4 text-xs">
          {cancelTarget && (
            <div className="rounded-well border border-hairline bg-surface-2 p-3 space-y-1.5">
              <div className="flex justify-between text-text-muted">
                <span>Refund amount:</span>
                <span className="font-medium text-text">
                  {cancelTarget.amount} {cancelTarget.destinationToken}
                </span>
              </div>
              <div className="flex justify-between text-text-muted">
                <span>Recipient:</span>
                <span className="font-mono text-text truncate max-w-[200px]">
                  {cancelTarget.recipientEvmAddress}
                </span>
              </div>
              {cancelQuota && (
                <div className="pt-2 border-t border-hairline/50 space-y-1">
                  <div className="flex justify-between text-[11px] text-text-dim">
                    <span>Cancellations remaining today (24h):</span>
                    <span className="font-mono text-text">
                      {cancelQuota.dailyRemaining} / 2
                    </span>
                  </div>
                  <div className="flex justify-between text-[11px] text-text-dim">
                    <span>Cancellations remaining this month (30d):</span>
                    <span className="font-mono text-text">
                      {cancelQuota.monthlyRemaining} / 10
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}

          {cancelError && (
            <div
              data-testid="cancel-error"
              className="rounded-well border border-danger/30 bg-danger/10 p-2.5 text-xs text-danger"
            >
              {cancelError}
            </div>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setCancelTarget(null);
                setCancelError(null);
              }}
              disabled={isCancelling}
              className="flex-1 h-9 rounded-pill border border-hairline bg-surface-2 font-medium text-text hover:bg-surface-3 transition-colors"
            >
              Keep Link
            </button>
            <button
              type="button"
              data-testid="confirm-cancel-send-link"
              onClick={handleConfirmCancel}
              disabled={isCancelling}
              className="flex-1 h-9 rounded-pill bg-danger text-white font-semibold hover:bg-danger/80 disabled:opacity-50 transition-colors"
            >
              {isCancelling ? 'Cancelling…' : 'Confirm Cancel & Refund'}
            </button>
          </div>
        </div>
      </GlassModal>

      <MorphWorkspace
        form={
          <div className="h-full rounded-card border border-hairline bg-surface-1 p-5 shadow-elev-card sm:p-7">
            <h2 className="mb-5 text-base font-semibold text-text">
              Create a Send Link
            </h2>
            <form onSubmit={handleCreate} className="space-y-4 text-xs">
              <div>
                <label
                  htmlFor="send-dest-address"
                  className="block text-text-muted mb-1"
                >
                  Recipient EVM Address
                </label>
                <input
                  id="send-dest-address"
                  type="text"
                  value={recipientEvm}
                  onChange={(e) => setRecipientEvm(e.target.value)}
                  placeholder="0x…"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  autoComplete="off"
                  inputMode="text"
                  className="w-full rounded-well border border-hairline bg-surface-2 p-2.5 font-mono text-xs text-text placeholder:text-text-dim focus:border-lime focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-text-muted mb-1">
                    Destination Chain
                  </label>
                  <Select
                    label="Destination Chain"
                    value={destChain}
                    onValueChange={(newChainName) => {
                      setDestChain(newChainName);
                      const chain = farChains.find(
                        (c) => c.name === newChainName,
                      );
                      if (chain && chain.tokenSymbols[0]) {
                        setDestToken(chain.tokenSymbols[0]);
                      }
                    }}
                    options={farChains.map((c) => ({
                      value: c.name,
                      label:
                        !c.enabled && c.disabledReason
                          ? `${c.name} (${c.disabledReason})`
                          : c.name,
                      disabled: !c.enabled,
                      icon: chainIconUrl(c.name),
                    }))}
                  />
                </div>
                <div>
                  <label className="block text-text-muted mb-1">Token</label>
                  <Select
                    label="Token"
                    value={destToken}
                    onValueChange={setDestToken}
                    options={(
                      farChains.find((c) => c.name === destChain)
                        ?.tokenSymbols ?? ['USDC']
                    ).map((sym) => ({
                      value: sym,
                      label: sym,
                      icon: tokenIconUrl(sym),
                    }))}
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="send-amount"
                  className="block text-text-muted mb-1"
                >
                  Amount the receiver gets
                </label>
                <div className="flex items-center gap-2">
                  <input
                    id="send-amount"
                    type="number"
                    step="any"
                    min="1"
                    value={amount}
                    inputMode="decimal"
                    autoComplete="off"
                    onChange={(e) => setAmount(e.target.value)}
                    className="flex-1 rounded-well border border-hairline bg-surface-2 p-2.5 font-semibold text-text focus:border-lime focus:outline-none"
                  />
                  <span className="font-semibold text-text">{destToken}</span>
                </div>
              </div>

              <div>
                <label className="block text-text-muted mb-1">
                  Claim Window
                </label>
                <ClaimWindowField
                  choice={windowChoice}
                  custom={customExpiry}
                  nowMs={nowMs}
                  onChoiceChange={(next) => {
                    setNowMs(Date.now());
                    setWindowChoice(next);
                  }}
                  onCustomChange={(next) => {
                    setNowMs(Date.now());
                    setCustomExpiry(next);
                  }}
                />
              </div>

              <div>
                <label
                  htmlFor="send-note"
                  className="block text-text-muted mb-1"
                >
                  Note for the receiver (optional)
                </label>
                <textarea
                  id="send-note"
                  value={note}
                  onChange={(e) =>
                    setNote(e.target.value.replace(/[\r\n]+/g, ' '))
                  }
                  maxLength={SEND_LINK_NOTE_MAX_LENGTH}
                  rows={2}
                  placeholder="Say what it is for"
                  className="w-full resize-none rounded-well border border-hairline bg-surface-2 p-2.5 text-xs text-text placeholder:text-text-dim focus:border-lime focus:outline-none"
                />
                <p className="mt-1 flex justify-between text-[11px] text-text-dim">
                  <span>
                    Anyone who has the link can read this note. Do not put
                    secrets in it.
                  </span>
                  <span data-testid="note-count">
                    {note.length}/{SEND_LINK_NOTE_MAX_LENGTH}
                  </span>
                </p>
              </div>

              {error && (
                <p className="text-danger text-xs" role="alert">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full rounded-pill bg-olive py-2.5 font-semibold text-text hover:bg-olive/90 transition-colors cursor-pointer disabled:opacity-50"
              >
                {isSubmitting ? 'Creating Send Link…' : 'Generate Send Link'}
              </button>
            </form>
          </div>
        }
        result={
          activeCreated ? (
            <div className="flex h-full flex-col rounded-card border border-hairline bg-surface-1 p-5 shadow-elev-card sm:p-7">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-text">
                  Your Send Link is Ready
                </h2>
                <span className="rounded-pill bg-ok/10 px-2 py-0.5 text-[10px] font-medium text-ok border border-ok/20">
                  {activeCreated.lockStatus === 'pending_lock'
                    ? 'Pending Lock'
                    : 'Open'}
                </span>
              </div>

              {/* Inform that anyone with the whole link (including fragment) can claim */}
              <div className="mb-4 rounded-well border border-hairline bg-surface-2 p-2.5 text-[11px] text-text-muted">
                Only the wallet you entered can receive these funds: they always
                go to that address. Anyone with the whole link can start the
                claim, but cannot change where the money goes.
              </div>

              <div className="my-4 flex flex-1 items-center justify-center rounded-xl border border-hairline bg-surface-2 p-4">
                <div className="rounded-lg bg-white p-3">
                  <QRCodeSVG value={activeUrl} size={160} />
                </div>
              </div>

              <div className="space-y-2 text-xs">
                <div className="rounded-well border border-hairline bg-surface-2 p-2.5">
                  <span className="text-text-dim block text-[11px] mb-0.5">
                    Shareable Link
                  </span>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-text truncate">
                      {activeUrl}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleCopy(activeUrl)}
                      className="shrink-0 rounded-pill bg-surface-3 px-3 py-1 font-semibold text-text hover:text-lime cursor-pointer transition-colors"
                    >
                      {copied ? 'Copied' : 'Copy'}
                    </button>
                    <Link
                      to={
                        activeCreated.secret
                          ? `/send/${activeCreated.id}#${activeCreated.secret.replace(/^0x/i, '')}`
                          : `/send/${activeCreated.id}`
                      }
                      data-testid="open-send-link"
                      className="shrink-0 rounded-pill bg-surface-3 px-3 py-1 font-semibold text-text transition-colors hover:text-lime"
                    >
                      Open
                    </Link>
                  </div>
                </div>

                {activeCreated.refundDate && (
                  <div
                    data-testid="created-refund-date"
                    className="rounded-well border border-hairline bg-surface-2 p-2.5 text-[11px]"
                  >
                    <span className="text-text-dim block mb-0.5">
                      Refund Date
                    </span>
                    <span className="text-text">
                      {activeCreated.refundDate}
                    </span>
                  </div>
                )}

                {activeCreated.note && (
                  <div
                    data-testid="created-note"
                    className="rounded-well border border-hairline bg-surface-2 p-2.5 text-[11px]"
                  >
                    <span className="text-text-dim block mb-0.5">Note</span>
                    <span className="text-text break-words">
                      {activeCreated.note}
                    </span>
                  </div>
                )}

                <div className="rounded-well border border-hairline bg-surface-2 p-2.5 text-[11px]">
                  <span className="text-text-dim block mb-0.5">
                    Enforced Recipient
                  </span>
                  <span className="font-mono text-text break-all">
                    {activeCreated.recipientEvmAddress}
                  </span>
                </div>
              </div>
            </div>
          ) : null
        }
        table={
          <div>
            {isContractWallet && (
              <div
                data-testid="contract-wallet-notice"
                className="mb-3 rounded-well border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-200"
              >
                Smart contract wallet detected: send links use per-browser
                secrets and cannot be rebuilt on other devices from the wallet
                signature alone.
              </div>
            )}
            {isScanning && (
              <div
                data-testid="restoring-links-indicator"
                className="mb-3 flex items-center gap-2 text-xs text-text-muted"
              >
                <span className="inline-block h-2 w-2 animate-ping rounded-full bg-lime" />
                Restoring send links from wallet…
              </div>
            )}
            <LinksTable
              title="All send links"
              completedLabel="Claim date"
              emptyText="Send links you create appear here."
              rows={createdLinks.map(toRow)}
              renderAction={(row) => {
                const link = createdLinks.find((item) => item.id === row.id);
                if (!link) return null;
                const isClaimed =
                  link.status === 'claimed' || link.lockStatus === 'claimed';
                const isCancelled =
                  link.status === 'cancelled' ||
                  link.lockStatus === 'cancelled';
                if (isClaimed || isCancelled) return null;

                return (
                  <div className="flex items-center gap-1.5">
                    {link.lockStatus === 'pending_lock' ? (
                      <button
                        type="button"
                        onClick={() => handleResume(link)}
                        disabled={resumingId === link.id}
                        className="rounded-pill border border-lime/40 bg-lime/20 px-2.5 py-1 text-xs font-semibold text-lime hover:bg-lime/30"
                      >
                        {resumingId === link.id ? 'Resuming…' : 'Resume'}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setActiveCreated(link)}
                        className="rounded-pill bg-surface-3 px-2.5 py-1 text-xs font-semibold text-text hover:text-lime"
                      >
                        View QR
                      </button>
                    )}
                    <button
                      type="button"
                      data-testid={`cancel-send-link-${link.id}`}
                      onClick={() => openCancelModal(link)}
                      className="rounded-pill border border-danger/30 bg-danger/10 px-2.5 py-1 text-xs font-semibold text-danger hover:bg-danger/20 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                );
              }}
            />
            <div className="mt-3 text-[11px] text-text-dim">
              Send links created with your wallet are restored across devices
              automatically. Links created with random secrets or before wallet
              recovery remain stored in this browser.
            </div>
          </div>
        }
      />
    </div>
  );
}
