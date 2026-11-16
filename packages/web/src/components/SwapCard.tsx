import { useEffect, useState } from 'react';
import { getModeCopy } from '../lib/copy';
import { NETWORK_PROFILE } from '../lib/config';
import { useSolver } from '../lib/solver/useSolver';
import type { ChainDisplay } from '../lib/network';
import type { QuoteResponse, SwapLane } from '../lib/solver/types';
import { ArrowUpDownIcon, ChevronDownIcon } from './icons';

export function SwapCard() {
  const solver = useSolver();
  const copy = getModeCopy('swap');

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
    sendAmount,
    isReverse,
    selectedFarToken,
    selectedBchToken,
    selectedChain,
    lane,
    solver,
  ]);

  function handleFlipDirection() {
    setIsReverse((prev) => !prev);
  }

  // Update token when chain changes
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

  const sendTokenSymbol = isReverse ? selectedBchToken : selectedFarToken;
  const receiveTokenSymbol = isReverse ? selectedFarToken : selectedBchToken;

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
        {/* Lane Toggle */}
        <div className="mb-3 flex items-center justify-between">
          <span className="text-xs font-medium text-text-muted">
            Execution lane:
          </span>
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
              className={`rounded-pill px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer ${
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
              className={`rounded-pill px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer ${
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
              /* Chain picker on far well only */
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
            {/* Token Pill */}
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
              /* Chain picker on far well only (now the receive well) */
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
            {/* Token Pill */}
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

        {/* Quote Details Row */}
        <div className="mt-2.5 space-y-0.5 rounded-xl bg-surface-2/60 p-2 text-xs text-text-muted">
          <div className="flex items-center justify-between">
            <span className="text-text-dim">Rate</span>
            <span className="font-mono text-text">
              1 {sendTokenSymbol} ≈{' '}
              {quote ? quote.exchangeRate.toFixed(4) : '1.0000'}{' '}
              {receiveTokenSymbol}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-text-dim">Spread & fees</span>
            <span>
              {quote ? `${(quote.spreadBps / 100).toFixed(1)}%` : '0.4%'} spread
              · $0.05 carry
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
        </div>

        {/* Primary Action Button */}
        <button
          type="button"
          data-testid="swap-submit-button"
          className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-pill bg-olive text-text font-semibold transition-colors hover:bg-olive/90 cursor-pointer shadow-elev-pill focus:outline-none focus-visible:ring-2 focus-visible:ring-lime"
        >
          <span>{copy.actionLabel}</span>
        </button>
      </div>

      {/* Thin arc horizon underneath */}
      <div className="horizon-arc" aria-hidden="true" />
    </div>
  );
}
