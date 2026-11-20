import { useState, useEffect, useContext, useRef } from 'react';
import { LinkHowItWorks } from '../components/links/LinkHowItWorks';
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
import { pusdIconUrl } from '../components/swap-block/token-badges';
import { chainIconUrl, tokenIconUrl } from '../lib/icons';
import { Select } from '../components/ui/select';
import { LIVE_EXECUTION_ENABLED } from '../lib/config';
import { listPayLinks } from '../lib/paylink/pay-store';
import { readSnapshot, writeSnapshot } from '../lib/paylink/snapshot-cache';
import { readPayLink, type PayLinkDetails } from '../lib/paylink/pay-api';
import { payLinkSteps } from '../lib/paylink/order-steps';
import { ProcessSteps } from '../components/links/ProcessSteps';
import { SaveRecoveryDialog } from '../components/links/SaveRecoveryDialog';
import { LiveOrderView } from '../components/LiveOrderView';
import { createPayerDependencies } from '../lib/live/ports';
import { amountInForExactOut } from '../lib/live/exact-out';
import { prepareSwap } from '../lib/live/run';
import { latestWallet } from '../lib/live/latest-wallets';
import { farTokenFacts } from '../lib/solver/core-quote';
import type { UserSwapDependencies } from '@ferry/user-flow';

const DEMO_LINK: PayLinkDetails = {
  id: 'demo',
  recipientAddress: 'bchtest:zqg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zy6fphnwyk',
  token: 'PUSD',
  amount: 25,
  note: 'Dinner split',
  verified: true,
  status: 'open',
};

/** A number typed by a person: digits and one dot, at most two decimals. */
function cleanAmountInput(raw: string): string {
  const cleaned = raw.replace(/[^0-9.]/g, '');
  const [whole = '', ...rest] = cleaned.split('.');
  return rest.length > 0 ? `${whole}.${rest.join('').slice(0, 2)}` : whole;
}

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
      // Live: paint from the last answer kept in this browser (if any) while the live one loads.
      if (live)
        return (id && readSnapshot<PayLinkDetails>(`pay.${id}`)) || 'loading';
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
  const ready = details !== 'loading' && details !== null ? details : null;

  // The server's answer carries the link and the swap behind it (state, transactions, times): one
  // request, asked again every few seconds until the link is paid. If it disagrees with what was
  // painted from the browser's copy, the page follows it.
  const paid = ready?.status === 'paid';
  useEffect(() => {
    if (!live || !solverUrl || !id) return;
    let active = true;
    const tick = async () => {
      const link = await readPayLink(solverUrl, id);
      if (!active) return;
      if (link) writeSnapshot(`pay.${id}`, link);
      setDetails(link);
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
  const orderId = ready?.orderId;
  const showSteps =
    Boolean(orderId) ||
    ready?.status === 'paid' ||
    ready?.status === 'reserved';
  const recipientCashaddr = ready?.recipientAddress ?? '';
  const token: 'PUSD' | 'MUSD' = ready?.token ?? 'PUSD';
  const [payerAmount, setPayerAmount] = useState('');
  // An open link: the payer types what they pay and sees what the recipient gets (priced by the
  // solver as the swap card does); a fixed link says what the recipient gets.
  const [openReceive, setOpenReceive] = useState<number | null>(null);
  const requestedAmount = ready?.amount ?? openReceive ?? 0;
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
  // The stablecoin the payer sends: their choice when the chain has it, else the chain's first.
  const [payerTokenChoice, setPayerTokenChoice] = useState<string>('');
  const selectedPayerToken: string = selectedChain?.tokenSymbols.includes(
    payerTokenChoice,
  )
    ? payerTokenChoice
    : (selectedChain?.tokenSymbols[0] ?? 'USDC');

  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  // Why there is no price (the solver's refusal in plain words), or null.
  const [quoteProblem, setQuoteProblem] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  // The payment runs on this page: the swap is built here, the person signs in their wallet, and
  // the page follows it step by step (no trip to the swap page).
  const [run, setRun] = useState<{
    orderId: string;
    deps: UserSwapDependencies;
  } | null>(null);
  const [fileToSave, setFileToSave] = useState<{
    filename: string;
    json: string;
    resolve: () => void;
    reject: (reason: Error) => void;
  } | null>(null);
  const walletsRef = useRef(walletContext);
  walletsRef.current = walletContext;
  const youPayText =
    requestedAmount > 0
      ? quote
        ? quote.fromAmount.toFixed(2)
        : quoteProblem
          ? '—'
          : '…'
      : '0.00';

  // Exact-output quote: recipient receives exact amount
  const isOpen = ready?.amount === undefined;
  const typedPay = Number.parseFloat(payerAmount);

  // An open link: price what the payer types, after a short pause in typing.
  useEffect(() => {
    if (!ready || !isOpen) return;
    if (!(typedPay > 0)) {
      setOpenReceive(null);
      setQuote(null);
      return;
    }
    let active = true;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const result = await solver.getQuote({
            fromToken: selectedPayerToken,
            toToken: token,
            fromChain: selectedChain.name,
            toChain: NETWORK_PROFILE.bch.name,
            fromAmount: typedPay,
            lane: 'fast' as const,
          });
          if (!active) return;
          setQuoteProblem(
            result.toAmount && result.toAmount > 0
              ? null
              : (result.refusal?.message ?? null),
          );
          setQuote(result);
          setOpenReceive(
            result.toAmount && result.toAmount > 0
              ? Math.floor(result.toAmount * 100) / 100
              : null,
          );
        } catch {
          if (active) setOpenReceive(null);
        }
      })();
    }, 400);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [
    ready,
    isOpen,
    typedPay,
    selectedPayerToken,
    selectedChain,
    token,
    solver,
  ]);

  // A fixed link: the price for the recipient to get exactly the amount.
  useEffect(() => {
    if (!ready || isOpen || requestedAmount <= 0) {
      if (!isOpen) setQuote(null);
      return;
    }
    let active = true;
    const request = (fromAmount: number) => ({
      fromToken: selectedPayerToken,
      toToken: token,
      fromChain: selectedChain.name,
      toChain: NETWORK_PROFILE.bch.name,
      fromAmount,
      lane: 'fast' as const,
    });
    // How much to send for the recipient to get exactly the requested amount: price a send a little
    // above par, scale it by what it would buy, and price that again (the solver's fee has a fixed
    // part, so one correction is needed). The price shown is the solver's, not a guess.
    (async () => {
      try {
        const first = await solver.getQuote(request(requestedAmount * 1.02));
        if (!active) return;
        if (!first.toAmount || first.toAmount <= 0) {
          // Refused: never show the page's own first guess as a price.
          setQuote(null);
          setQuoteProblem(
            first.refusal?.message ?? 'No price is available right now.',
          );
          return;
        }
        setQuoteProblem(null);
        const guess = (first.fromAmount * requestedAmount) / first.toAmount;
        const second = await solver.getQuote(request(guess));
        if (!active) return;
        const needed =
          second.toAmount && second.toAmount > 0
            ? Math.ceil(
                ((second.fromAmount * requestedAmount) / second.toAmount) * 100,
              ) / 100
            : guess;
        setQuote({ ...second, fromAmount: needed });
      } catch {
        if (active) setQuote(null);
      }
    })();

    return () => {
      active = false;
    };
  }, [
    ready,
    isOpen,
    requestedAmount,
    selectedPayerToken,
    selectedChain,
    token,
    solver,
  ]);

  async function handlePay() {
    setPaying(true);
    try {
      if (live && solverUrl) {
        setPayError(null);
        if (evm.status !== 'connected') {
          walletContext?.evm.connect();
          setPaying(false);
          return;
        }
        const far = farTokenFacts(selectedChain.name, selectedPayerToken);
        if (!far) throw new Error('This chain is not set up for payments yet.');
        const deps = createPayerDependencies({
          evm: latestWallet(() => walletsRef.current?.evm) as NonNullable<
            typeof walletContext
          >['evm'],
          solverUrl,
          chainId: far.chainId,
          recipientCashAddress: recipientCashaddr,
        });
        const base = {
          direction: 'EVM_TO_BCH' as const,
          token,
          chainId: far.chainId,
          evmToken: far.address,
          evmTokenDecimals: far.decimals,
          bchTokenDecimals: 2,
          lane: 'fast' as const,
          fastOptIn: true,
        };
        const { amountIn } = await amountInForExactOut(
          deps,
          base,
          BigInt(Math.round(requestedAmount * 100)),
        );
        const prepared = await prepareSwap(deps, { ...base, amountIn });
        await new Promise<void>((resolve, reject) => {
          setFileToSave({ ...prepared.recovery, resolve, reject });
        });
        const startedOrder = prepared.session.state.orderId;
        if (!startedOrder)
          throw new Error('The payment could not be prepared.');
        setRun({ orderId: startedOrder, deps });
        return;
      }
      const orderId = `paylink-${id ?? 'order'}`;
      if (solver.createOrder && quote?.signedQuote) {
        await solver.createOrder(quote.signedQuote, evm.address ?? undefined);
      }
      void navigate(ROUTES.swapOrder(orderId));
    } catch (cause) {
      setPayError(cause instanceof Error ? cause.message : String(cause));
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
        <div
          className="animate-pulse rounded-card border border-hairline bg-surface-1 p-6"
          data-testid="pay-link-loading"
          aria-busy="true"
        >
          <div className="h-4 w-20 rounded bg-surface-2" />
          <div className="mt-3 h-6 w-48 rounded bg-surface-2" />
          <div className="mt-6 h-40 rounded-well bg-surface-2" />
        </div>
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
              {showSteps
                ? `Payment of ${(ready.amount ?? 0).toFixed(2)} ${token}`
                : ready.amount !== undefined
                  ? `Pay ${youPayText} ${selectedPayerToken}`
                  : `Pay any amount in ${selectedPayerToken}`}
            </h1>
            <div className="mt-1 print:hidden">
              <LinkHowItWorks kind="pay" />
            </div>
            {note && (
              <p
                data-testid="pay-link-note"
                className="mt-1 text-sm text-text-muted print:text-black/70"
              >
                {note}
              </p>
            )}
          </div>

          {run ? (
            <LiveOrderView
              orderId={run.orderId}
              dependencies={run.deps}
              start
              embedded
              labels={{
                lock: 'Your payment is locked',
                waitCounterLock: `The solver locks ${token} on Bitcoin Cash`,
                claim: `The owner is paid in ${token}`,
              }}
            />
          ) : showSteps ? (
            <ProcessSteps
              steps={payLinkSteps(
                token,
                ready?.order ?? null,
                paid,
                ready?.createdAt,
              )}
            />
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
                <div className="overflow-hidden rounded-well border border-hairline bg-surface-2 px-3 pb-3 pt-4 text-xs print:border-black/20 print:bg-white">
                  <span className="mb-2 block text-text-dim print:text-black/60">
                    Recipient address
                  </span>
                  <div className="rounded-lg bg-surface-0 px-3 py-3 print:bg-black/5">
                    <p
                      data-testid="chunked-address"
                      className="break-all font-mono text-xs font-semibold text-text print:text-black"
                    >
                      {chunkCashaddr(recipientCashaddr)}
                    </p>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  {/* You pay: the label, the chain and stablecoin, then the amount at the bottom */}
                  <div className="flex flex-col gap-2 rounded-well border border-hairline bg-surface-2 p-3 print:hidden">
                    <span className="text-xs text-text-muted">
                      {copy.sendLabel}
                    </span>
                    <Select
                      label="Payer chain"
                      value={String(selectedChainId)}
                      onValueChange={(value) => {
                        setSelectedChainId(Number(value));
                        setPayerTokenChoice('');
                      }}
                      options={farChains.map((c) => ({
                        value: String(c.id),
                        label: c.name,
                        icon: chainIconUrl(c.name),
                      }))}
                      className="w-full"
                      triggerClassName="w-full py-1 text-xs"
                    />
                    <Select
                      label="Payer stablecoin"
                      value={selectedPayerToken}
                      onValueChange={setPayerTokenChoice}
                      options={(selectedChain?.tokenSymbols ?? []).map(
                        (symbol) => ({
                          value: symbol,
                          label: symbol,
                          icon: tokenIconUrl(symbol),
                        }),
                      )}
                      className="w-full"
                      triggerClassName="w-full py-1 text-xs"
                    />
                    {ready.amount === undefined ? (
                      <div className="mt-auto flex items-center gap-2 pt-2">
                        <input
                          type="text"
                          inputMode="decimal"
                          autoComplete="off"
                          aria-label="Amount you pay"
                          value={payerAmount}
                          onChange={(e) =>
                            setPayerAmount(cleanAmountInput(e.target.value))
                          }
                          placeholder="0.00"
                          className="w-full min-w-0 rounded-well border border-hairline bg-surface-1 px-3 py-2 text-xl font-semibold text-text focus:border-lime focus:outline-none"
                        />
                        <span className="shrink-0 text-xl font-semibold text-text">
                          {selectedPayerToken}
                        </span>
                      </div>
                    ) : (
                      <div className="mt-auto pt-2 text-xl font-semibold text-text">
                        {youPayText} {selectedPayerToken}
                      </div>
                    )}
                  </div>

                  {/* They receive: the icon with room above and below, the amount at the bottom */}
                  <div className="flex flex-col rounded-well border border-hairline bg-surface-2 p-3 print:border-black/20 print:bg-white">
                    <div className="flex items-center justify-between text-xs text-text-muted print:text-black/60">
                      <span>{copy.receiveLabel}</span>
                      <span className="text-xs text-text-dim print:text-black/60">
                        Bitcoin Cash
                      </span>
                    </div>
                    {pusdIconUrl(token) && (
                      <img
                        src={pusdIconUrl(token)!}
                        alt=""
                        className="my-4 size-16 rounded-full"
                      />
                    )}
                    <div className="mt-auto text-xl font-semibold text-text print:text-black">
                      {ready.amount === undefined
                        ? `${openReceive !== null ? openReceive.toFixed(2) : '0.00'} ${token}`
                        : `${requestedAmount.toFixed(2)} ${token}`}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* The action: centered, as wide as its words need (hidden in print) */}
          {!showSteps && !run && (
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

          {quoteProblem && !showSteps && !run && (
            <p
              className="mt-3 text-center text-xs text-warn print:hidden"
              role="status"
              data-testid="quote-problem"
            >
              {quoteProblem}
            </p>
          )}
          {payError && (
            <p
              className="mt-3 text-center text-sm text-danger"
              role="alert"
              data-testid="pay-error"
            >
              {payError}
            </p>
          )}
          <SaveRecoveryDialog
            file={fileToSave}
            onContinue={() => {
              fileToSave?.resolve();
              setFileToSave(null);
            }}
            onCancel={() => {
              fileToSave?.reject(
                new Error(
                  'Cancelled. Nothing was locked and no file was saved.',
                ),
              );
              setFileToSave(null);
            }}
          />
          <p className="mt-3 text-center text-xs text-text-dim print:text-black/50">
            Atomic swap through Ferry. Funds never touch a custodian or bridge.
          </p>
        </div>
      )}
    </div>
  );
}
