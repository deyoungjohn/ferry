import { MIN_TRANSACTION_USD } from '@ferry/core';
import { useState, useContext, type FormEvent } from 'react';
import { SEND_LINK_NOTE_MAX_LENGTH } from '@ferry/core/api';
import { SolverClient } from '@ferry/solver-client';
import { Link } from 'react-router';
import { QRCodeSVG } from 'qrcode.react';
import { isAddress } from 'viem';
import { sendLinkUrl, type SendLinkData } from '../lib/paylink/link';
import { NETWORK_PROFILE } from '../lib/config';
import { GlassModal } from '../components/GlassModal';
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
      : link.status === 'claimed'
        ? { status: 'Claimed', tone: 'ok' as const }
        : link.status === 'expired'
          ? { status: 'Expired', tone: 'warn' as const }
          : { status: 'Open', tone: 'neutral' as const };
  return {
    id: link.id,
    href: `/send/${link.id}`,
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

  const wallets = useContext(WalletContext);
  const solverContext = useContext(SolverContext);

  const isLive = propIsLive ?? import.meta.env?.VITE_LIVE_EXECUTION === '1';

  function resolveDependencies(): SendLinkDependencies {
    if (propDependencies) return propDependencies;

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
    };
  }

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
            Send dollars from Bitcoin Cash to someone on another chain with an
            automatic refund window.
          </p>
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
                    ).map((sym) => ({ value: sym, label: sym }))}
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="send-amount"
                  className="block text-text-muted mb-1"
                >
                  Amount to Send
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
                Anyone with the whole link, including the part after #, can
                claim.
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
                      to={`/send/${activeCreated.id}`}
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
          <LinksTable
            title="All send links"
            completedLabel="Claim date"
            emptyText="Send links you create appear here."
            rows={createdLinks.map(toRow)}
            renderAction={(row) => {
              const link = createdLinks.find((item) => item.id === row.id);
              if (!link) return null;
              return link.lockStatus === 'pending_lock' ? (
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
              );
            }}
          />
        }
      />
    </div>
  );
}
