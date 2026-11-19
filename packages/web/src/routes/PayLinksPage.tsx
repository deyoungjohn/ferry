import { useState, useContext, useEffect, type FormEvent } from 'react';
import { Link } from 'react-router';
import { QRCodeSVG } from 'qrcode.react';
import { decodeCashAddress, MIN_TRANSACTION_USD } from '@ferry/core';
import { WalletContext } from '../lib/wallet/context';
import {
  chunkCashaddr,
  payLinkUrl,
  type PayLinkData,
} from '../lib/paylink/link';
import { useToast } from '../lib/toast/ToastContext';
import { listPayLinks, savePayLink } from '../lib/paylink/pay-store';
import {
  createPayLinkOnSolver,
  readPayLinkState,
} from '../lib/paylink/pay-api';
import { LIVE_EXECUTION_ENABLED } from '../lib/config';
import { MorphWorkspace } from '../components/links/MorphWorkspace';
import { LinksTable, type LinkRow } from '../components/links/LinksTable';

const STATUS_LABEL: Record<PayLinkData['status'], string> = {
  open: 'Open',
  reserved: 'Payment started',
  paid: 'Paid',
  expired: 'Expired',
  cancelled: 'Cancelled',
};

function toRow(link: PayLinkData): LinkRow {
  return {
    id: link.id,
    href: `/pay/${link.id}`,
    amount: link.amountOut
      ? `${link.amountOut.toFixed(2)} ${link.token}`
      : `Any ${link.token}`,
    createdAt: link.createdAt,
    completedAt: link.status === 'paid' ? (link.paidAt ?? null) : null,
    status: STATUS_LABEL[link.status],
    tone:
      link.status === 'paid'
        ? 'ok'
        : link.status === 'expired' || link.status === 'cancelled'
          ? 'warn'
          : 'neutral',
  };
}

export function PayLinksPage() {
  const walletContext = useContext(WalletContext);
  const { showToast } = useToast();
  const bch = walletContext?.bch ?? { status: 'disconnected', address: null };
  const [token, setToken] = useState<'PUSD' | 'MUSD'>('PUSD');
  const [fixedAmount, setFixedAmount] = useState('20.00');
  const [isFixed, setIsFixed] = useState(true);
  const [note, setNote] = useState('');
  const [pastedAddress, setPastedAddress] = useState('');
  const [createdLinks, setCreatedLinks] = useState<PayLinkData[]>(() =>
    listPayLinks(),
  );
  const [activeCreated, setActiveCreated] = useState<PayLinkData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [creating, setCreating] = useState(false);

  // With a live solver the links exist there, so the address people open is real; the table asks
  // it for each open link's state (paid, and when).
  const solverUrl = (import.meta.env?.VITE_SOLVER_URLS as string | undefined)
    ?.split(',')[0]
    ?.trim();
  const live = LIVE_EXECUTION_ENABLED && Boolean(solverUrl);
  useEffect(() => {
    if (!live || !solverUrl) return;
    let cancelled = false;
    (async () => {
      for (const link of listPayLinks()) {
        if (link.status !== 'open' && link.status !== 'reserved') continue;
        const state = await readPayLinkState(solverUrl, link.id);
        if (!state || cancelled) continue;
        if (state.status !== link.status || state.paidAt !== link.paidAt) {
          savePayLink({ ...link, ...state });
        }
      }
      if (!cancelled) setCreatedLinks(listPayLinks());
    })();
    return () => {
      cancelled = true;
    };
  }, [live, solverUrl]);

  const activeRecipient = pastedAddress.trim() || bch.address?.address || '';

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);

    try {
      decodeCashAddress(activeRecipient);
    } catch (err) {
      setError(
        `Invalid recipient Bitcoin Cash address: ${err instanceof Error ? err.message : String(err)}`,
      );
      return;
    }

    if (note.length > 140) {
      setError('Note must be 140 characters or fewer');
      return;
    }

    const amountNum = isFixed ? parseFloat(fixedAmount) : undefined;
    if (isFixed && (!amountNum || amountNum <= 0)) {
      setError('Please enter a valid amount');
      return;
    }
    if (isFixed && amountNum !== undefined && amountNum < MIN_TRANSACTION_USD) {
      setError('The minimum is $' + MIN_TRANSACTION_USD.toFixed(2) + '.');
      return;
    }

    setCreating(true);
    try {
      let id = 'pl-' + Math.random().toString(36).substring(2, 10);
      let createdAt = Math.floor(Date.now() / 1000);
      if (live && solverUrl) {
        const made = await createPayLinkOnSolver(solverUrl, {
          token,
          recipientAddress: activeRecipient,
          amountCents:
            amountNum !== undefined ? Math.round(amountNum * 100) : undefined,
          note: note.trim() || undefined,
        });
        id = made.id;
        createdAt = made.createdAt;
      }
      const newLink: PayLinkData = {
        id,
        recipientCashaddr: activeRecipient,
        token,
        ...(amountNum !== undefined ? { amountOut: amountNum } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
        verified:
          bch.status === 'connected' &&
          bch.address?.address === activeRecipient,
        status: 'open',
        createdAt,
      };
      savePayLink(newLink);
      setCreatedLinks(listPayLinks());
      setActiveCreated(newLink);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'The link could not be created.',
      );
    } finally {
      setCreating(false);
    }
  }

  function handleCopyUrl(url: string) {
    void navigator.clipboard.writeText(url);
    setCopied(true);
    showToast('Pay link copied to clipboard', 'success');
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      {/* Header */}
      <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-text">
            Pay Links
          </h1>
          <p className="text-xs text-text-muted">
            Get paid in PUSD or MUSD from anyone holding a stablecoin on any
            supported chain.
          </p>
        </div>
        <Link
          to="/"
          className="inline-flex h-8 items-center gap-1.5 rounded-pill border border-hairline bg-surface-2 px-3 text-xs font-semibold text-text hover:border-lime/40 transition-colors self-start sm:self-auto"
        >
          ← Back to Swap
        </Link>
      </div>

      <MorphWorkspace
        form={
          <div className="h-full rounded-card border border-hairline bg-surface-1 p-5 shadow-elev-card sm:p-7">
            <h2 className="mb-5 text-base font-semibold text-text">
              Create a Pay Link
            </h2>
            <form onSubmit={handleCreate} className="space-y-4 text-xs">
              {/* Recipient Address */}
              <div>
                <label
                  htmlFor="recipient-cashaddr"
                  className="block text-text-muted mb-1"
                >
                  Receiving Bitcoin Cash Address
                </label>
                <input
                  id="recipient-cashaddr"
                  type="text"
                  value={pastedAddress}
                  onChange={(e) => setPastedAddress(e.target.value)}
                  placeholder={activeRecipient}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  autoComplete="off"
                  inputMode="text"
                  className="w-full rounded-well border border-hairline bg-surface-2 p-2.5 font-mono text-xs text-text placeholder:text-text-dim focus:border-lime focus:outline-none"
                />
                <span className="mt-1 block text-[11px] text-text-dim">
                  {bch.address?.address === activeRecipient
                    ? '✓ Auto-filled from your connected BCH wallet'
                    : 'Enter a valid CashAddr'}
                </span>
              </div>

              {/* Token Selection */}
              <div>
                <label className="block text-text-muted mb-1">
                  Requested Token
                </label>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setToken('PUSD')}
                    className={`flex-1 rounded-pill py-2 font-semibold transition-colors cursor-pointer ${
                      token === 'PUSD'
                        ? 'bg-lime text-lime-ink'
                        : 'border border-hairline bg-surface-2 text-text hover:text-lime'
                    }`}
                  >
                    PUSD
                  </button>
                  <button
                    type="button"
                    onClick={() => setToken('MUSD')}
                    className={`flex-1 rounded-pill py-2 font-semibold transition-colors cursor-pointer ${
                      token === 'MUSD'
                        ? 'bg-lime text-lime-ink'
                        : 'border border-hairline bg-surface-2 text-text hover:text-lime'
                    }`}
                  >
                    MUSD
                  </button>
                </div>
              </div>

              {/* Amount Type */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-text-muted">Amount</span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setIsFixed(true)}
                      className={`text-[11px] font-medium cursor-pointer ${
                        isFixed
                          ? 'text-lime underline'
                          : 'text-text-dim hover:text-text'
                      }`}
                    >
                      Fixed amount
                    </button>
                    <span className="text-text-dim">·</span>
                    <button
                      type="button"
                      onClick={() => setIsFixed(false)}
                      className={`text-[11px] font-medium cursor-pointer ${
                        !isFixed
                          ? 'text-lime underline'
                          : 'text-text-dim hover:text-text'
                      }`}
                    >
                      Payer chooses
                    </button>
                  </div>
                </div>
                {isFixed && (
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      step="any"
                      aria-label="Fixed Amount"
                      value={fixedAmount}
                      inputMode="decimal"
                      autoComplete="off"
                      onChange={(e) => setFixedAmount(e.target.value)}
                      placeholder="0.00"
                      className="flex-1 rounded-well border border-hairline bg-surface-2 p-2.5 font-semibold text-text focus:border-lime focus:outline-none"
                    />
                    <span className="font-semibold text-text">{token}</span>
                  </div>
                )}
              </div>

              {/* Note */}
              <div>
                <label
                  htmlFor="pay-note"
                  className="block text-text-muted mb-1"
                >
                  Note for Payer (optional, ≤ 140 characters)
                </label>
                <input
                  id="pay-note"
                  type="text"
                  maxLength={140}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="What is this payment for?"
                  className="w-full rounded-well border border-hairline bg-surface-2 p-2.5 text-xs text-text placeholder:text-text-dim focus:border-lime focus:outline-none"
                />
              </div>

              {error && (
                <p className="text-danger text-xs" role="alert">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={creating}
                className="w-full rounded-pill bg-olive py-3 font-semibold text-text transition-colors"
              >
                {creating ? 'Creating…' : 'Generate Pay Link'}
              </button>
            </form>
          </div>
        }
        result={
          activeCreated ? (
            <div className="flex h-full flex-col rounded-card border border-hairline bg-surface-1 p-5 shadow-elev-card sm:p-7">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-text">
                  Your Pay Link is Ready
                </h2>
                <span className="rounded-pill bg-ok/10 px-2 py-0.5 text-[10px] font-medium text-ok border border-ok/20">
                  Open
                </span>
              </div>

              {/* QR Code */}
              <div className="my-4 flex flex-1 items-center justify-center rounded-xl border border-hairline bg-surface-2 p-4">
                <div className="rounded-lg bg-white p-3">
                  <QRCodeSVG value={payLinkUrl(activeCreated.id)} size={160} />
                </div>
              </div>

              {/* Link Details */}
              <div className="space-y-2 text-xs">
                <div className="rounded-well border border-hairline bg-surface-2 p-2.5">
                  <span className="text-text-dim block text-[11px] mb-0.5">
                    Shareable Link
                  </span>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-text truncate">
                      {payLinkUrl(activeCreated.id)}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        handleCopyUrl(payLinkUrl(activeCreated.id))
                      }
                      className="shrink-0 rounded-pill bg-surface-3 px-3 py-1 font-semibold text-text hover:text-lime cursor-pointer transition-colors"
                    >
                      {copied ? 'Copied' : 'Copy'}
                    </button>
                    <Link
                      to={`/pay/${activeCreated.id}`}
                      data-testid="open-pay-link"
                      className="shrink-0 rounded-pill bg-surface-3 px-3 py-1 font-semibold text-text transition-colors hover:text-lime"
                    >
                      Open
                    </Link>
                  </div>
                </div>

                <div className="rounded-well border border-hairline bg-surface-2 p-2.5 text-[11px]">
                  <span className="text-text-dim block mb-0.5">
                    Recipient (Chunked CashAddr)
                  </span>
                  <span className="font-mono text-text break-all">
                    {chunkCashaddr(activeCreated.recipientCashaddr)}
                  </span>
                </div>
              </div>
            </div>
          ) : null
        }
        table={
          <LinksTable
            title="All pay links"
            completedLabel="Payment date"
            emptyText="Pay links you create appear here."
            rows={createdLinks.map(toRow)}
          />
        }
      />
    </div>
  );
}
