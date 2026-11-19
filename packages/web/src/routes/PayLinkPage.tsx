import { useState, useEffect, useContext } from 'react';
import { ROUTES } from '../lib/routes';
import { useParams, useNavigate, Link } from 'react-router';
import { QRCodeSVG } from 'qrcode.react';
import { getModeCopy } from '../lib/copy';
import { NETWORK_PROFILE } from '../lib/config';
import { useSolver } from '../lib/solver/useSolver';
import { WalletContext } from '../lib/wallet/context';
import { chunkCashaddr } from '../lib/paylink/link';
import type { ChainDisplay } from '../lib/network';
import type { QuoteResponse } from '../lib/solver/types';
import { useToast } from '../lib/toast/ToastContext';
import { Select } from '../components/ui/select';
import { LIVE_EXECUTION_ENABLED } from '../lib/config';
import { listPayLinks } from '../lib/paylink/pay-store';
import { readPayLink, type PayLinkDetails } from '../lib/paylink/pay-api';
import {
  payLinkSteps,
  readOrderTxids,
  type OrderTxids,
} from '../lib/paylink/order-steps';
import { ProcessSteps } from '../components/links/ProcessSteps';

const DEMO_LINK: PayLinkDetails = {
  id: 'demo',
  recipientAddress: 'bchtest:zqg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zy6fphnwyk',
  token: 'PUSD',
  amount: 25,
  note: 'Dinner split',
  verified: true,
  status: 'open',
};

export function PayLinkPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const solver = useSolver();
  const walletContext = useContext(WalletContext);
  const evm = walletContext?.evm ?? { status: 'disconnected', address: null };
  const { showToast } = useToast();
  const copy = getModeCopy('pay-link');

  // The link as its creator made it: from the solver when live, from this browser's own list
  // otherwise, and only then the demo sample (a mock build with no such link).
  const solverUrl = (import.meta.env?.VITE_SOLVER_URLS as string | undefined)
    ?.split(',')[0]
    ?.trim();
  const live = LIVE_EXECUTION_ENABLED && Boolean(solverUrl);
  const [details, setDetails] = useState<PayLinkDetails | null | 'loading'>(
    () => {
      if (live) return 'loading';
      const local = listPayLinks().find((link) => link.id === id);
      return local
        ? {
            id: local.id,
            recipientAddress: local.recipientCashaddr,
            token: local.token,
            amount: local.amountOut,
            note: local.note,
            verified: local.verified,
            status: local.status,
          }
        : DEMO_LINK;
    },
  );
  useEffect(() => {
    if (!live || !solverUrl || !id) return;
    let active = true;
    void readPayLink(solverUrl, id).then((found) => {
      if (active) setDetails(found);
    });
    return () => {
      active = false;
    };
  }, [live, solverUrl, id]);
  const ready = details !== 'loading' && details !== null ? details : null;

  // Once a swap pays the link, the page follows it: the QR code gives way to the steps.
  const [orderTxids, setOrderTxids] = useState<OrderTxids | null>(null);
  const orderId = ready?.orderId;
  const paid = ready?.status === 'paid';
  useEffect(() => {
    if (!live || !solverUrl || !id) return;
    let active = true;
    const tick = async () => {
      const link = await readPayLink(solverUrl, id);
      if (active && link) setDetails(link);
      if (link?.orderId) {
        const read = await readOrderTxids(solverUrl, link.orderId);
        if (active && read) setOrderTxids(read.txids);
      }
    };
    const timer = setInterval(() => {
      if (!paid) void tick();
    }, 8_000);
    void tick();
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [live, solverUrl, id, paid]);
  const showSteps =
    Boolean(orderId) ||
    ready?.status === 'paid' ||
    ready?.status === 'reserved';
  const recipientCashaddr = ready?.recipientAddress ?? '';
  const token: 'PUSD' | 'MUSD' = ready?.token ?? 'PUSD';
  const [payerAmount, setPayerAmount] = useState('');
  const requestedAmount =
    ready?.amount ??
    (Number.parseFloat(payerAmount) > 0 ? Number.parseFloat(payerAmount) : 0);
  const note = ready?.note ?? '';
  const verified = ready?.verified ?? false;
  const [copiedShare, setCopiedShare] = useState(false);

  // Current page shareable URL
  const currentUrl =
    typeof window !== 'undefined'
      ? window.location.href
      : `https://ferry.incepture.dev/pay/${id ?? 'demo'}`;

  // Payer options
  const farChains = NETWORK_PROFILE.farChains;
  const [selectedChainId, setSelectedChainId] = useState<string | number>(
    farChains[0]?.id ?? 84532,
  );
  const selectedChain: ChainDisplay =
    farChains.find((c) => c.id === selectedChainId) ?? farChains[0]!;
  const [selectedPayerToken] = useState<string>(
    selectedChain?.tokenSymbols[0] ?? 'USDC',
  );

  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [paying, setPaying] = useState(false);
  const youPayText =
    requestedAmount > 0
      ? (quote ? quote.fromAmount : requestedAmount * 1.004).toFixed(2)
      : '0.00';

  // Exact-output quote: recipient receives exact amount
  useEffect(() => {
    if (!ready || requestedAmount <= 0) {
      setQuote(null);
      return;
    }
    let active = true;
    solver
      .getQuote({
        fromToken: selectedPayerToken,
        toToken: token,
        fromChain: selectedChain.name,
        toChain: NETWORK_PROFILE.bch.name,
        fromAmount: requestedAmount * 1.004 + 0.05, // exact out calculation
        lane: 'fast',
      })
      .then((res) => {
        if (active) setQuote(res);
      })
      .catch(() => {
        if (active) setQuote(null);
      });

    return () => {
      active = false;
    };
  }, [
    ready,
    requestedAmount,
    selectedPayerToken,
    selectedChain,
    token,
    solver,
  ]);

  async function handlePay() {
    setPaying(true);
    try {
      if (live) {
        // The payer's swap pays the link's recipient directly: the swap page opens with the
        // destination and the amount to send already filled in.
        const params = new URLSearchParams({
          to: recipientCashaddr,
          amount: (quote?.fromAmount ?? requestedAmount * 1.004 + 0.05).toFixed(
            2,
          ),
          token,
        });
        void navigate(`${ROUTES.swap}?${params.toString()}`);
        return;
      }
      const orderId = `paylink-${id ?? 'order'}`;
      if (solver.createOrder && quote?.signedQuote) {
        await solver.createOrder(quote.signedQuote, evm.address ?? undefined);
      }
      void navigate(ROUTES.swapOrder(orderId));
    } catch {
      setPaying(false);
    }
  }

  async function handleShare() {
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({
          title: `Ferry Pay Link: ${requestedAmount.toFixed(2)} ${token}`,
          text: `Pay ${requestedAmount.toFixed(2)} ${token} via Ferry atomic swap`,
          url: currentUrl,
        });
        return;
      } catch {
        // Fall back to clipboard if share was canceled or failed
      }
    }
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(currentUrl);
      setCopiedShare(true);
      showToast('Pay link copied to clipboard', 'success');
      setTimeout(() => setCopiedShare(false), 2000);
    }
  }

  function handlePrint() {
    if (typeof window !== 'undefined') {
      window.print();
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      {/* Back button & Action links (hidden during print) */}
      <div className="mb-4 flex items-center justify-between print:hidden">
        <Link
          to={ROUTES.payLink}
          className="inline-flex items-center gap-1 text-xs text-text-muted hover:text-text transition-colors"
        >
          ← All Pay Links
        </Link>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleShare}
            className="rounded-pill bg-surface-2 border border-hairline px-2.5 py-1 text-xs text-text-muted hover:text-text transition-colors cursor-pointer"
          >
            {copiedShare ? '✓ Copied' : 'Share Link'}
          </button>
          <button
            type="button"
            onClick={handlePrint}
            className="rounded-pill bg-surface-2 border border-hairline px-2.5 py-1 text-xs text-text-muted hover:text-text transition-colors cursor-pointer"
          >
            Print
          </button>
        </div>
      </div>

      {details === 'loading' && (
        <p className="text-center text-sm text-text-muted">
          Loading the pay link…
        </p>
      )}
      {details === null && (
        <div
          className="rounded-card border border-hairline bg-surface-1 p-6 text-center"
          data-testid="pay-link-missing"
        >
          <h1 className="text-lg font-semibold text-text">
            Pay link not found
          </h1>
          <p className="mt-2 text-sm text-text-muted">
            This link does not exist or was cancelled. Ask the person who sent
            it for a new one.
          </p>
        </div>
      )}
      {ready && (
        <div className="card-ring relative rounded-card border border-hairline bg-surface-1 p-5 shadow-elev-card sm:p-6 print:border-black print:bg-white print:text-black print:shadow-none">
          {/* Title */}
          <div className="mb-4 border-b border-hairline pb-3 print:border-black/20">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-lime print:text-black">
                Pay link
              </span>
              {verified && (
                <span className="rounded-pill border border-ok/20 bg-ok/10 px-2 py-0.5 text-xs font-medium text-ok print:border-black print:text-black">
                  Verified recipient
                </span>
              )}
            </div>
            <h1 className="mt-1 text-xl font-semibold text-text print:text-black">
              {ready.amount !== undefined
                ? `Pay ${youPayText} ${selectedPayerToken}`
                : `Pay any amount in ${selectedPayerToken}`}
            </h1>
            {note && (
              <p
                data-testid="pay-link-note"
                className="mt-1 text-sm text-text-muted print:text-black/70"
              >
                {note}
              </p>
            )}
          </div>

          {showSteps ? (
            <ProcessSteps steps={payLinkSteps(token, orderTxids, paid)} />
          ) : (
            <div className="grid gap-4 md:grid-cols-[auto_1fr] md:items-stretch">
              {/* QR code, for scan and print */}
              <div className="flex flex-col items-center justify-center rounded-well border border-hairline bg-surface-2 p-4 print:border-black/20 print:bg-white">
                <div className="rounded-lg bg-white p-3 shadow-sm">
                  <QRCodeSVG
                    value={currentUrl}
                    size={160}
                    level="M"
                    aria-label="Payment QR code"
                  />
                </div>
                <span className="mt-2 text-xs text-text-dim print:text-black/60">
                  Scan with any wallet or camera to pay
                </span>
              </div>

              {/* Two rows that together are as tall as the QR card: the recipient, then the amounts */}
              <div className="grid grid-rows-[2fr_3fr] gap-3">
                <div className="overflow-hidden rounded-well border border-hairline bg-surface-2 p-3 text-xs print:border-black/20 print:bg-white">
                  <span className="mb-1 block text-text-dim print:text-black/60">
                    Recipient address
                  </span>
                  <p
                    data-testid="chunked-address"
                    className="break-all font-mono text-xs font-semibold text-text print:text-black"
                  >
                    {chunkCashaddr(recipientCashaddr)}
                  </p>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  {/* They receive */}
                  <div className="rounded-well border border-hairline bg-surface-2 p-3 print:border-black/20 print:bg-white">
                    <div className="mb-1 flex items-center justify-between text-xs text-text-muted print:text-black/60">
                      <span>{copy.receiveLabel}</span>
                      <span className="text-xs text-text-dim print:text-black/60">
                        Bitcoin Cash
                      </span>
                    </div>
                    {ready.amount === undefined ? (
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min="0"
                          step="any"
                          inputMode="decimal"
                          aria-label="Amount to pay"
                          value={payerAmount}
                          onChange={(e) => setPayerAmount(e.target.value)}
                          placeholder="0.00"
                          className="w-full rounded-well border border-hairline bg-surface-1 px-2 py-1 text-lg font-semibold text-text focus:border-lime focus:outline-none"
                        />
                        <span className="text-lg font-semibold text-text">
                          {token}
                        </span>
                      </div>
                    ) : (
                      <div className="text-xl font-semibold text-text print:text-black">
                        {requestedAmount.toFixed(2)} {token}
                      </div>
                    )}
                  </div>

                  {/* You pay: the label, then the chain across the card's width, then the amount */}
                  <div className="flex flex-col gap-2 rounded-well border border-hairline bg-surface-2 p-3 print:hidden">
                    <span className="text-xs text-text-muted">
                      {copy.sendLabel}
                    </span>
                    <Select
                      label="Payer chain"
                      value={String(selectedChainId)}
                      onValueChange={(value) =>
                        setSelectedChainId(Number(value))
                      }
                      options={farChains.map((c) => ({
                        value: String(c.id),
                        label: c.name,
                      }))}
                      className="w-full"
                      triggerClassName="w-full py-1 text-xs"
                    />
                    <div className="text-xl font-semibold text-text">
                      {youPayText} {selectedPayerToken}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* The action: centered, as wide as its words need (hidden in print) */}
          {!showSteps && (
            <div className="mt-5 flex justify-center print:hidden">
              <button
                type="button"
                disabled={
                  paying || requestedAmount <= 0 || ready.status !== 'open'
                }
                onClick={handlePay}
                data-testid="pay-link-submit-button"
                className="inline-flex h-11 items-center justify-center rounded-pill bg-olive px-10 font-semibold text-text shadow-elev-pill transition-colors"
              >
                {paying
                  ? 'Opening the swap…'
                  : ready.status === 'open'
                    ? 'Pay now'
                    : 'Not payable'}
              </button>
            </div>
          )}

          <p className="mt-3 text-center text-xs text-text-dim print:text-black/50">
            Atomic swap through Ferry. Funds never touch a custodian or bridge.
          </p>
        </div>
      )}
    </div>
  );
}
