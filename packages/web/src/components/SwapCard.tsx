import { useEffect, useState, useMemo, useContext } from 'react';
import {
  formatQuoteRefusalMessage,
  type LiquidityResponse,
  type QuoteRefusal,
} from '@ferry/core';
import { getModeCopy } from '../lib/copy';
import { NETWORK_PROFILE } from '../lib/config';
import { useSolver } from '../lib/solver/useSolver';
import { WalletContext } from '../lib/wallet/context';
import { MockPriceReader } from '../lib/pricing/mock';
import {
  verifySignedQuote,
  CHECKABLE_QUOTE_WORDING,
  type VerifyQuoteResult,
} from '../lib/solver/verify';
import type { ChainDisplay } from '../lib/network';
import type { QuoteResponse, SwapLane } from '../lib/solver/types';
import { ArrowUpDownIcon, ChevronDownIcon } from './icons';

export function SwapCard() {
  const solver = useSolver();
  const walletContext = useContext(WalletContext);
  const evm = walletContext?.evm ?? { status: 'disconnected', address: null };
  const copy = getModeCopy('swap');
  const priceReader = useMemo(() => new MockPriceReader(), []);

  // Direction: false = Far Chain -> BCH (forward), true = BCH -> Far Chain (reverse)
  const [isReverse, setIsReverse] = useState(false);

  // Selected far chain and tokens
  const farChains = NETWORK_PROFILE.farChains;
  const [selectedChainId, setSelectedChainId] = useState<string | number>(
    farChains[0]?.id ?? 84532,
  );

  const selectedChain: ChainDisplay =
    farChains.find((c) => c.id === selectedChainId) ?? farChains[0]!;

  const [selectedFarToken, setSelectedFarToken] = useState<string>(
    selectedChain?.tokenSymbols[0] ?? 'USDC',
  );

  const bchTokens = NETWORK_PROFILE.bch.tokenSymbols;
  const [selectedBchToken, setSelectedBchToken] = useState<string>(
    bchTokens[0] ?? 'tPUSD',
  );

  // Send amount
  const [sendAmount, setSendAmount] = useState<string>('20.00');
  const [lane, setLane] = useState<SwapLane>('fast');
  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [refusal, setRefusal] = useState<QuoteRefusal | null>(null);
  const [verifyResult, setVerifyResult] = useState<VerifyQuoteResult | null>(
    null,
  );
  const [liquidity, setLiquidity] = useState<LiquidityResponse | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Fetch liquidity on mount
  useEffect(() => {
    let active = true;
    solver
      .getLiquidity()
      .then((res) => {
        if (active) setLiquidity(res);
      })
      .catch(() => {
        // Fallback gracefully
      });
    return () => {
      active = false;
    };
  }, [solver]);

  // Fetch quote whenever inputs change
  useEffect(() => {
    let active = true;
    const amountNum = parseFloat(sendAmount) || 0;
    const fromToken = isReverse ? selectedBchToken : selectedFarToken;
    const toToken = isReverse ? selectedFarToken : selectedBchToken;
    const fromChain = isReverse ? NETWORK_PROFILE.bch.name : selectedChain.name;
    const toChain = isReverse ? selectedChain.name : NETWORK_PROFILE.bch.name;

    solver
      .getQuote({
        fromToken,
        toToken,
        fromChain,
        toChain,
        fromAmount: amountNum,
        lane,
        userAddress: evm.address ?? undefined,
      })
      .then(async (res) => {
        if (!active) return;
        setQuote(res);
        setRefusal(res.refusal ?? null);

        if (res.signedQuote) {
          const verified = await verifySignedQuote(
            res.signedQuote,
            {
              direction: isReverse ? 'BCH_TO_EVM' : 'EVM_TO_BCH',
              bchToken:
                toToken.includes('MUSD') || fromToken.includes('MUSD')
                  ? 'MUSD'
                  : 'PUSD',
              fromAmount: amountNum,
              evmChainId:
                typeof selectedChain.id === 'number' ? selectedChain.id : 84532,
            },
            priceReader,
          );
          if (active) setVerifyResult(verified);
        } else {
          setVerifyResult(null);
        }
      })
      .catch(() => {
        if (active) {
          setQuote(null);
          setRefusal(null);
          setVerifyResult(null);
        }
      });

    return () => {
      active = false;
    };
  }, [
    sendAmount,
    isReverse,
    selectedFarToken,
    selectedBchToken,
    selectedChain,
    lane,
    solver,
    evm.address,
    priceReader,
  ]);

  function handleFlipDirection() {
    setIsReverse((prev) => !prev);
  }

  function handleChainChange(newChainId: string | number) {
    const numericId =
      typeof newChainId === 'string' && !isNaN(Number(newChainId))
        ? Number(newChainId)
        : newChainId;
    setSelectedChainId(numericId);
    const chain = farChains.find(
      (c) => c.id === numericId || String(c.id) === String(newChainId),
    );
    if (chain && chain.tokenSymbols[0]) {
      setSelectedFarToken(chain.tokenSymbols[0]);
    }
  }

  // Calculate route liquidity display
  const availableLiquidity = useMemo(() => {
    if (!liquidity) return '5,000';
    const targetAsset = isReverse ? 'USDC' : selectedBchToken.replace(/^t/, '');
    const found = liquidity.routes.find(
      (r) => r.asset.toUpperCase() === targetAsset.toUpperCase(),
    );
    if (!found) return '5,000';
    const units = BigInt(found.available);
    const scaled = Number(units) / 10 ** found.decimals;
    return scaled.toLocaleString('en-US', { maximumFractionDigits: 0 });
  }, [liquidity, isReverse, selectedBchToken]);

  const sendTokenSymbol = isReverse ? selectedBchToken : selectedFarToken;
  const receiveTokenSymbol = isReverse ? selectedFarToken : selectedBchToken;

  async function handleSwap() {
    setIsSubmitting(true);
    try {
      const orderId = quote?.signedQuote?.orderId ?? `swap-mock-${Date.now()}`;
      if (solver.createOrder && quote?.signedQuote) {
        await solver.createOrder(quote.signedQuote, evm.address ?? undefined);
      }
      if (typeof window !== 'undefined') {
        window.location.assign(`/swap/${orderId}`);
      }
    } catch {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="swap-stage mx-auto w-full max-w-md px-4 pt-1 pb-4">
      {/* Mock interface disclaimer banner */}
      <div
        data-testid="mock-label"
        className="mb-2 flex items-center justify-between rounded-lg border border-warn/30 bg-warn/10 px-3 py-1 text-xs"
      >
        <div className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-warn shadow-[0_0_8px_var(--warn)]" />
          <span className="font-medium text-text">{solver.getLabel()}</span>
        </div>
        <span className="text-[11px] text-text-dim">Testnet Only</span>
      </div>

      {/* Main swap card shell */}
      <div className="card-ring relative rounded-card border border-hairline bg-surface-1 p-3.5 sm:p-4">
        {/* Lane Toggle & Liquidity Maximum Display */}
        <div className="mb-2.5 flex items-center justify-between gap-2">
          <div
            data-testid="liquidity-available"
            className="text-[11px] font-medium text-text-muted"
          >
            Available:{' '}
            <span className="font-semibold text-text">
              {availableLiquidity} {receiveTokenSymbol}
            </span>
          </div>

          <div
            role="radiogroup"
            aria-label="Execution lane"
            className="inline-flex rounded-pill border border-hairline bg-surface-2 p-0.5"
          >
            <button
              type="button"
              role="radio"
              aria-checked={lane === 'fast'}
              onClick={() => setLane('fast')}
              className={`rounded-pill px-2.5 py-0.5 text-xs font-medium transition-colors cursor-pointer ${
                lane === 'fast'
                  ? 'bg-lime text-lime-ink'
                  : 'text-text-muted hover:text-text'
              }`}
            >
              Fast (≤ $25)
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={lane === 'safe'}
              onClick={() => setLane('safe')}
              className={`rounded-pill px-2.5 py-0.5 text-xs font-medium transition-colors cursor-pointer ${
                lane === 'safe'
                  ? 'bg-lime text-lime-ink'
                  : 'text-text-muted hover:text-text'
              }`}
            >
              Safe (1-conf)
            </button>
          </div>
        </div>

        {/* You send Well */}
        <div className="relative rounded-well border border-hairline bg-surface-2 p-3 transition-colors focus-within:border-lime/40">
          <div className="flex items-center justify-between text-xs text-text-muted mb-1">
            <label htmlFor="send-input" className="font-medium">
              {copy.sendLabel}
            </label>
            {!isReverse ? (
              <div className="relative inline-flex items-center">
                <select
                  aria-label="Source chain"
                  value={selectedChainId}
                  onChange={(e) => handleChainChange(e.target.value)}
                  className="appearance-none bg-surface-3 pl-2 pr-6 py-0.5 rounded-pill text-xs font-medium text-text border border-hairline cursor-pointer focus:outline-none focus:border-lime"
                >
                  {farChains.map((c) => (
                    <option key={c.id} value={c.id} className="bg-surface-2">
                      {c.name}
                    </option>
                  ))}
                </select>
                <ChevronDownIcon className="pointer-events-none absolute right-1.5 size-3 text-text-muted" />
              </div>
            ) : (
              <span className="text-[11px] text-text-dim">Bitcoin Cash</span>
            )}
          </div>

          <div className="flex items-center justify-between gap-3">
            <input
              id="send-input"
              type="number"
              step="any"
              min="1"
              value={sendAmount}
              onChange={(e) => setSendAmount(e.target.value)}
              placeholder="0.0"
              className="w-full bg-transparent text-xl sm:text-2xl font-semibold text-text outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            />
            {!isReverse ? (
              <div className="inline-flex shrink-0 items-center gap-1.5 rounded-pill border border-hairline bg-surface-3 px-2.5 py-1 text-xs font-semibold text-text">
                <span>{sendTokenSymbol}</span>
              </div>
            ) : (
              <div className="relative inline-flex shrink-0 items-center">
                <select
                  aria-label="Send token"
                  value={selectedBchToken}
                  onChange={(e) => setSelectedBchToken(e.target.value)}
                  className="appearance-none bg-surface-3 pl-2.5 pr-6 py-1 rounded-pill text-xs font-semibold text-text border border-hairline cursor-pointer focus:outline-none focus:border-lime"
                >
                  {bchTokens.map((sym: string) => (
                    <option key={sym} value={sym} className="bg-surface-2">
                      {sym}
                    </option>
                  ))}
                </select>
                <ChevronDownIcon className="pointer-events-none absolute right-1.5 size-3 text-text-muted" />
              </div>
            )}
          </div>
        </div>

        {/* Direction Toggle button in center */}
        <div className="relative my-[-8px] z-10 flex justify-center">
          <button
            type="button"
            onClick={handleFlipDirection}
            aria-label="Toggle swap direction"
            className="flex size-8 items-center justify-center rounded-full border border-hairline bg-surface-3 text-text shadow-md transition-transform hover:scale-110 hover:text-lime cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-lime"
          >
            <ArrowUpDownIcon className="size-3.5" />
          </button>
        </div>

        {/* You receive Well */}
        <div className="relative rounded-well border border-hairline bg-surface-2 p-3 transition-colors">
          <div className="flex items-center justify-between text-xs text-text-muted mb-1">
            <span className="font-medium">{copy.receiveLabel}</span>
            {isReverse ? (
              <div className="relative inline-flex items-center">
                <select
                  aria-label="Destination chain"
                  value={selectedChainId}
                  onChange={(e) => handleChainChange(e.target.value)}
                  className="appearance-none bg-surface-3 pl-2 pr-6 py-0.5 rounded-pill text-xs font-medium text-text border border-hairline cursor-pointer focus:outline-none focus:border-lime"
                >
                  {farChains.map((c) => (
                    <option key={c.id} value={c.id} className="bg-surface-2">
                      {c.name}
                    </option>
                  ))}
                </select>
                <ChevronDownIcon className="pointer-events-none absolute right-1.5 size-3 text-text-muted" />
              </div>
            ) : (
              <span className="text-[11px] text-text-dim">Bitcoin Cash</span>
            )}
          </div>

          <div className="flex items-center justify-between gap-3">
            <div className="text-xl sm:text-2xl font-semibold text-text">
              {quote ? quote.toAmount.toFixed(2) : '0.00'}
            </div>
            {isReverse ? (
              <div className="inline-flex shrink-0 items-center gap-1.5 rounded-pill border border-hairline bg-surface-3 px-2.5 py-1 text-xs font-semibold text-text">
                <span>{receiveTokenSymbol}</span>
              </div>
            ) : (
              <div className="relative inline-flex shrink-0 items-center">
                <select
                  aria-label="Receive token"
                  value={selectedBchToken}
                  onChange={(e) => setSelectedBchToken(e.target.value)}
                  className="appearance-none bg-surface-3 pl-2.5 pr-6 py-1 rounded-pill text-xs font-semibold text-text border border-hairline cursor-pointer focus:outline-none focus:border-lime"
                >
                  {bchTokens.map((sym: string) => (
                    <option key={sym} value={sym} className="bg-surface-2">
                      {sym}
                    </option>
                  ))}
                </select>
                <ChevronDownIcon className="pointer-events-none absolute right-1.5 size-3 text-text-muted" />
              </div>
            )}
          </div>
        </div>

        {/* Typed Refusal Alert (FR-18) */}
        {refusal && (
          <div
            data-testid="quote-refusal"
            className="mt-2.5 rounded-lg border border-warn/30 bg-warn/10 p-2.5 text-xs"
            role="alert"
          >
            <p className="font-medium text-warn">
              {formatQuoteRefusalMessage(refusal)}
            </p>
            {refusal.reason === 'INSUFFICIENT_LIQUIDITY' &&
              refusal.maxAmount && (
                <button
                  type="button"
                  onClick={() => setSendAmount(refusal.maxAmount!)}
                  className="mt-1.5 inline-flex items-center gap-1 rounded-pill bg-lime px-2.5 py-0.5 text-[11px] font-semibold text-lime-ink hover:bg-lime/90 cursor-pointer"
                >
                  Fill maximum ({refusal.maxAmount} {refusal.asset})
                </button>
              )}
          </div>
        )}

        {/* Price Verification Warning Alert (FR-17) */}
        {verifyResult?.pricingCheck?.status === 'warn' && (
          <div
            data-testid="price-warning"
            className="mt-2.5 rounded-lg border border-warn/30 bg-warn/10 p-2.5 text-xs text-warn"
            role="alert"
          >
            <p className="font-medium">
              ⚠️ Reference price deviation: quoted{' '}
              {verifyResult.pricingCheck.quotedPrice ?? 'N/A'} vs live Cauldron{' '}
              {verifyResult.pricingCheck.ownPrice ?? 'N/A'}
            </p>
            <p className="mt-0.5 text-[11px] text-text-muted">
              {verifyResult.pricingCheck.reason ??
                'Live reference price deviates from quoted rate.'}
            </p>
          </div>
        )}

        {/* Quote Details Row with Evidence (FR-17) */}
        <div className="mt-2.5 space-y-1 rounded-xl bg-surface-2/60 p-2 text-xs text-text-muted">
          <div className="flex items-center justify-between">
            <span className="text-text-dim">Rate</span>
            <span className="font-mono text-text">
              1 {sendTokenSymbol} ≈{' '}
              {quote?.exchangeRate ? quote.exchangeRate.toFixed(4) : '1.0000'}{' '}
              {receiveTokenSymbol}
            </span>
          </div>

          {/* Pricing Evidence Line */}
          <div className="flex items-center justify-between gap-1 text-[11px]">
            <span className="text-text-dim shrink-0">Pricing</span>
            <span
              data-testid="quote-evidence-line"
              className="font-mono text-text text-right truncate"
            >
              {quote?.formattedPricingEvidence ??
                'PUSD $0.998 (Cauldron) · USDC $1.000 · spread 0.4%'}
            </span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-text-dim">Est. settlement</span>
            <span className="text-ok">
              {lane === 'fast'
                ? '< 1 minute (Fast lane)'
                : '≈ 10 minutes (Safe lane)'}
            </span>
          </div>

          {/* Transparent pricing claim wording */}
          <div className="pt-1 border-t border-hairline/50 text-center text-[10px] text-text-dim">
            <span>{CHECKABLE_QUOTE_WORDING}</span>
          </div>
        </div>

        {/* Primary Action Button */}
        <button
          type="button"
          disabled={Boolean(refusal) || isSubmitting}
          onClick={handleSwap}
          data-testid="swap-submit-button"
          className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-pill bg-olive text-text font-semibold transition-colors hover:bg-olive/90 cursor-pointer shadow-elev-pill focus:outline-none focus-visible:ring-2 focus-visible:ring-lime disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <span>{isSubmitting ? 'Starting swap…' : copy.actionLabel}</span>
        </button>
      </div>

      {/* Thin arc horizon underneath */}
      <div className="horizon-arc" aria-hidden="true" />
    </div>
  );
}
