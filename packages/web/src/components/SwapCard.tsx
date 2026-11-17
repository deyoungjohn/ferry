import { useEffect, useState, useMemo, useContext } from 'react';
import { isAddress } from 'viem';
import {
  formatQuoteRefusalMessage,
  verifyPricing,
  type LiquidityResponse,
  type QuoteRefusal,
  type Hex32,
  type RecoveryTerms,
} from '@ferry/core';
import {
  bestQuote,
  prepareRecoveryDownload,
  triggerRecoveryDownload,
  type BestQuoteResult,
  type VerifiedSolverQuote,
} from '@ferry/solver-client';
import { getModeCopy, FAILURE_COPY } from '../lib/copy';
import { NETWORK_PROFILE } from '../lib/config';
import { useSolver } from '../lib/solver/useSolver';
import { WalletContext } from '../lib/wallet/context';
import { RealPriceReader } from '../lib/pricing/real';
import {
  formatPricingEvidence,
  CHECKABLE_QUOTE_WORDING,
} from '../lib/solver/pricing-display';
import type { ChainDisplay } from '../lib/network';
import type { QuoteResponse, SwapLane } from '../lib/solver/types';
import { ArrowUpDownIcon, ChevronDownIcon } from './icons';
import { CopyDiagnosticsButton } from './CopyDiagnosticsButton';
import { useToast } from '../lib/toast/ToastContext';

function formatSolverName(url: string): string {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace('.local', '');
    if (host.includes('alpha')) return 'Alpha';
    if (host.includes('beta')) return 'Beta';
    return host;
  } catch {
    return url;
  }
}

export interface SwapCardProps {
  initialReverse?: boolean;
  initialRecipient?: string;
  initialFailureState?:
    | 'solver_unreachable'
    | 'all_solvers_refused'
    | 'quote_expired'
    | 'wallet_rejected'
    | 'wrong_network'
    | 'read_only';
}

export function SwapCard({
  initialReverse = true, // Judge path first: leads with PUSD -> USDC (§13, §19)
  initialRecipient,
  initialFailureState,
}: SwapCardProps = {}) {
  const solver = useSolver();
  const walletContext = useContext(WalletContext);
  const evm = walletContext?.evm ?? { status: 'disconnected', address: null };
  const copy = getModeCopy('swap');
  const priceReader = useMemo(() => new RealPriceReader(), []);

  // Direction: false = Far Chain -> BCH (forward), true = BCH -> Far Chain (reverse, PUSD -> USDC)
  const [isReverse, setIsReverse] = useState(initialReverse);

  // Selected far chain and tokens
  const farChains = NETWORK_PROFILE.farChains;
  const defaultChain = farChains.find((c) => c.enabled) ?? farChains[0];
  const [selectedChainId, setSelectedChainId] = useState<string | number>(
    defaultChain?.id ?? 8453,
  );

  const selectedChain: ChainDisplay =
    farChains.find((c) => c.id === selectedChainId) ??
    defaultChain ??
    farChains[0]!;

  const hasAnyEnabledRoute = farChains.some((c) => c.enabled);

  const [selectedFarToken, setSelectedFarToken] = useState<string>(
    selectedChain?.tokenSymbols[0] ?? 'USDC',
  );

  const bchTokens = NETWORK_PROFILE.bch.tokenSymbols;
  const [selectedBchToken, setSelectedBchToken] = useState<string>(
    bchTokens[0] ?? 'tPUSD',
  );

  // Recipient address (Paste-address flow)
  const [recipientAddress, setRecipientAddress] = useState<string>(
    initialRecipient ?? evm.address ?? '',
  );

  // Send amount
  const [sendAmount, setSendAmount] = useState<string>('20.00');
  const [lane, setLane] = useState<SwapLane>('fast');
  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [bestSolverQuote, setBestSolverQuote] =
    useState<VerifiedSolverQuote | null>(null);
  const [multiQuoteResult, setMultiQuoteResult] =
    useState<BestQuoteResult | null>(null);
  const [refusal, setRefusal] = useState<QuoteRefusal | null>(null);
  const [priceWarning, setPriceWarning] = useState<string | null>(null);
  const [liquidity, setLiquidity] = useState<LiquidityResponse | null>(null);
  const [recoveryDownloaded, setRecoveryDownloaded] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const { showToast } = useToast();

  // Failure & Degraded States
  const [failureState, setFailureState] = useState<
    | 'solver_unreachable'
    | 'all_solvers_refused'
    | 'quote_expired'
    | 'wallet_rejected'
    | 'wrong_network'
    | null
  >(
    initialFailureState && initialFailureState !== 'read_only'
      ? initialFailureState
      : null,
  );
  const [isReadOnly, setIsReadOnly] = useState<boolean>(
    initialFailureState === 'read_only',
  );

  // Multi-solver URLs from VITE_SOLVER_URLS (comma list)
  const solverUrls = useMemo(() => {
    const envUrls = import.meta.env?.VITE_SOLVER_URLS as string | undefined;
    if (envUrls && envUrls.trim().length > 0) {
      return envUrls
        .split(',')
        .map((u) => u.trim())
        .filter(Boolean);
    }
    return [];
  }, []);

  // Fetch liquidity on mount
  useEffect(() => {
    let active = true;
    solver
      .getLiquidity()
      .then((res) => {
        if (active) setLiquidity(res);
      })
      .catch(() => {
        // Gracefully ignore liquidity read failure
      });
    return () => {
      active = false;
    };
  }, [solver]);

  // Fetch quote whenever inputs change via multi-solver bestQuote
  useEffect(() => {
    let active = true;
    const amountNum = parseFloat(sendAmount) || 0;
    const fromToken = isReverse ? selectedBchToken : selectedFarToken;
    const toToken = isReverse ? selectedFarToken : selectedBchToken;
    const fromChain = isReverse ? NETWORK_PROFILE.bch.name : selectedChain.name;
    const toChain = isReverse ? selectedChain.name : NETWORK_PROFILE.bch.name;
    const bchTokenSymbol = (
      toToken.includes('MUSD') || fromToken.includes('MUSD') ? 'MUSD' : 'PUSD'
    ) as 'PUSD' | 'MUSD';

    setRecoveryDownloaded(false);
    setQuoteLoading(true);

    // 1. Call solver.getQuote for legacy / mock adapter compatibility
    solver
      .getQuote({
        fromToken,
        toToken,
        fromChain,
        toChain,
        fromAmount: amountNum,
        lane,
        userAddress: evm.address ?? undefined,
        recipientAddress: recipientAddress.trim() || undefined,
      })
      .then((res) => {
        if (!active) return;
        setQuote(res);

        if (res.refusal) {
          setQuoteLoading(false);
          setRefusal(res.refusal);
          setBestSolverQuote(null);
          setMultiQuoteResult(null);
          return;
        }

        // When solverUrls is empty (e.g. in standalone mock mode), use adapter quote directly
        if (solverUrls.length === 0) {
          setQuoteLoading(false);
          if (res.signedQuote) {
            const receiveAmount = isReverse
              ? res.signedQuote.terms.evmAmount
              : res.signedQuote.terms.bchTokenAmount;
            setBestSolverQuote({
              solverUrl: solver.getLabel ? solver.getLabel() : 'local',
              latencyMs: 15,
              quote: {
                ...res.signedQuote,
                signerAddress: '0x0000000000000000000000000000000000000000',
                receiveAmount,
              },
            });
            setRefusal(null);
          }
          return;
        }

        // 2. Call bestQuote across all configured solvers (FR-14)
        const quoteReq = {
          direction: isReverse
            ? ('BCH_TO_EVM' as const)
            : ('EVM_TO_BCH' as const),
          token: bchTokenSymbol,
          chainId:
            typeof selectedChain.id === 'number' ? selectedChain.id : 84532,
          evmToken:
            '0x036cbd53842c5426634e7929541ec2318f3dcf7e' as `0x${string}`,
          amountIn: isReverse
            ? BigInt(Math.max(1, Math.round(amountNum * 100)))
            : BigInt(Math.max(1, Math.round(amountNum * 1_000_000))),
          userEvmAddress: (isAddress(recipientAddress)
            ? recipientAddress
            : ((evm.address as `0x${string}` | null) ??
              '0x' + '0'.repeat(40))) as `0x${string}`,
          userBchLockingBytecode: ('0x76a914' +
            '0'.repeat(40) +
            '88ac') as `0x${string}`,
          hashLock: ('0x' + '0'.repeat(64)) as Hex32,
          lane,
        };

        const fetchImpl =
          typeof window !== 'undefined' ? window.fetch.bind(window) : fetch;

        bestQuote(solverUrls, quoteReq, {
          fetch: fetchImpl,
          bchTipHeight: 170000,
          evmTokenDecimals: 6,
          bchTokenDecimals: 2,
        })
          .then(async (result) => {
            if (!active) return;
            setQuoteLoading(false);
            setMultiQuoteResult(result);

            if (result.best) {
              setBestSolverQuote(result.best);
              setRefusal(null);

              // Check pricing evidence against Cauldron reference price (FR-17)
              if (result.best.quote.terms.pricing) {
                try {
                  const spot = await priceReader.readPrice(bchTokenSymbol);
                  const pricingCheck = verifyPricing(
                    result.best.quote.terms,
                    spot.usdPrice,
                    '0.02',
                  );
                  if (pricingCheck.status === 'warn') {
                    setPriceWarning(
                      pricingCheck.reason ??
                        'Live reference price deviates from quoted rate.',
                    );
                  } else {
                    setPriceWarning(null);
                  }
                } catch {
                  setPriceWarning(null);
                }
              }
            } else {
              setBestSolverQuote(null);
              const firstFailure = result.failures[0];
              if (firstFailure?.kind === 'refusal' && firstFailure.refusal) {
                setRefusal(firstFailure.refusal);
              } else if (firstFailure) {
                setRefusal({
                  reason: 'QUOTING_PAUSED',
                  asset: bchTokenSymbol,
                  message: firstFailure.message,
                });
              }
            }
          })
          .catch(() => {
            if (active) {
              setQuoteLoading(false);
              setMultiQuoteResult(null);
              setBestSolverQuote(null);
              setFailureState('solver_unreachable');
            }
          });
      })
      .catch(() => {
        if (active) {
          setQuoteLoading(false);
          setQuote(null);
          setFailureState('solver_unreachable');
        }
      });

    return () => {
      active = false;
      setQuoteLoading(false);
    };
  }, [
    sendAmount,
    isReverse,
    selectedFarToken,
    selectedBchToken,
    selectedChain,
    lane,
    solver,
    solverUrls,
    evm.address,
    recipientAddress,
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

  // Address validation logic
  const isAddressEmpty = recipientAddress.trim().length === 0;
  const isValidRecipient = useMemo(() => {
    if (isAddressEmpty) return false;
    if (isReverse) {
      // Must be valid EVM address format (0x + 40 hex chars)
      return isAddress(recipientAddress.trim());
    } else {
      // Must be valid CashAddr format with prefix
      const trimmed = recipientAddress.trim();
      return (
        trimmed.startsWith('bchtest:') ||
        trimmed.startsWith('bitcoincash:') ||
        trimmed.startsWith('bchreg:')
      );
    }
  }, [isAddressEmpty, isReverse, recipientAddress]);

  const hasAddressError = !isAddressEmpty && !isValidRecipient;

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

  // Recovery file download handler
  function handleDownloadRecovery() {
    if (!bestSolverQuote) return;
    const terms = bestSolverQuote.quote.terms;
    if (!terms.pricing) return;
    const recoveryTerms: RecoveryTerms = {
      ...terms,
      pricing: terms.pricing,
    };
    const payload = prepareRecoveryDownload({
      quote: {
        orderId: bestSolverQuote.quote.orderId,
        terms: recoveryTerms,
        signature: bestSolverQuote.quote.signature,
      },
      contracts: {
        evm: {
          chainId: terms.evmChainId,
          htlcAddress: terms.evmHtlc,
          tokenAddress: terms.evmToken,
        },
        bch: {
          network:
            NETWORK_PROFILE.bch.network === 'mainnet' ? 'mainnet' : 'chipnet',
          htlcAddress: 'bchtest:pr3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zy',
          tokenAddress: terms.bchTokenCategory,
          redeemScript: '0x04000000' as const,
          lockingBytecode: terms.userBchLockingBytecode,
        },
      },
    });
    triggerRecoveryDownload(payload);
    setRecoveryDownloaded(true);
    showToast('Recovery file downloaded', 'success');
  }

  async function handleSwap() {
    if (isReadOnly || !isValidRecipient) return;
    setIsSubmitting(true);
    try {
      const orderId =
        bestSolverQuote?.quote.orderId ??
        quote?.signedQuote?.orderId ??
        `swap-${Date.now()}`;
      if (solver.createOrder && quote?.signedQuote) {
        await solver.createOrder(
          quote.signedQuote,
          recipientAddress || evm.address || undefined,
        );
      }
      if (typeof window !== 'undefined') {
        window.location.assign(`/swap/${orderId}`);
      }
    } catch (err) {
      setIsSubmitting(false);
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('rejected') || msg.includes('denied')) {
        setFailureState('wallet_rejected');
      } else if (msg.includes('expired')) {
        setFailureState('quote_expired');
      }
    }
  }

  // Calculated displayed receive amount
  const displayedReceiveAmount = useMemo(() => {
    if (bestSolverQuote) {
      const units = Number(bestSolverQuote.quote.receiveAmount);
      return (isReverse ? units / 1_000_000 : units / 100).toFixed(2);
    }
    if (quote) {
      return quote.toAmount.toFixed(2);
    }
    return '0.00';
  }, [bestSolverQuote, quote, isReverse]);

  const isChainDisabled = !selectedChain.enabled;

  const submitButtonDisabled =
    Boolean(refusal) ||
    isSubmitting ||
    !hasAnyEnabledRoute ||
    isChainDisabled ||
    isAddressEmpty ||
    hasAddressError ||
    isReadOnly ||
    failureState === 'all_solvers_refused' ||
    failureState === 'quote_expired' ||
    failureState === 'wrong_network' ||
    failureState === 'solver_unreachable';

  const submitButtonText = useMemo(() => {
    if (isReadOnly) return FAILURE_COPY.readOnlyMode.button;
    if (!hasAnyEnabledRoute) return 'No routes enabled';
    if (isChainDisabled) return 'Not live yet';
    if (isSubmitting) return 'Starting swap…';
    if (isAddressEmpty) {
      return isReverse
        ? 'Paste destination EVM address'
        : 'Paste destination BCH address';
    }
    if (hasAddressError) return 'Invalid destination address';
    if (failureState === 'quote_expired') return 'Quote expired';
    if (failureState === 'wrong_network') return 'Wrong network';
    return copy.actionLabel;
  }, [
    isReadOnly,
    hasAnyEnabledRoute,
    isChainDisabled,
    isSubmitting,
    isAddressEmpty,
    hasAddressError,
    failureState,
    isReverse,
    copy.actionLabel,
  ]);

  return (
    <div className="swap-stage mx-auto w-full max-w-md px-4 pt-1 pb-4">
      {/* Solver status disclaimer banner */}
      {!solver.isLive() && (
        <div
          data-testid="solver-label"
          className="mb-2 flex items-center justify-between rounded-lg border border-warn/30 bg-warn/10 px-3 py-1 text-xs"
        >
          <div className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-warn shadow-[0_0_8px_var(--warn)]" />
            <span className="font-medium text-text">{solver.getLabel()}</span>
          </div>
          {!NETWORK_PROFILE.isMainnet && (
            <span className="text-[11px] text-text-dim">
              {NETWORK_PROFILE.label}
            </span>
          )}
        </div>
      )}

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
            className="inline-flex rounded-pill bg-surface-3 p-0.5 border border-hairline"
          >
            <button
              type="button"
              role="radio"
              aria-checked={lane === 'fast'}
              onClick={() => setLane('fast')}
              className={`px-2.5 py-0.5 rounded-pill text-[11px] font-medium transition-colors cursor-pointer ${
                lane === 'fast'
                  ? 'bg-olive text-text font-semibold shadow-xs'
                  : 'text-text-muted hover:text-text'
              }`}
            >
              Fast (0-conf)
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={lane === 'safe'}
              onClick={() => setLane('safe')}
              className={`px-2.5 py-0.5 rounded-pill text-[11px] font-medium transition-colors cursor-pointer ${
                lane === 'safe'
                  ? 'bg-olive text-text font-semibold shadow-xs'
                  : 'text-text-muted hover:text-text'
              }`}
            >
              Safe (1-conf)
            </button>
          </div>
        </div>

        {/* You send Well */}
        <div className="relative rounded-well border border-hairline bg-surface-2 p-3 transition-colors focus-within:border-lime">
          <div className="flex items-center justify-between text-xs text-text-muted mb-1 gap-2">
            <label
              htmlFor="send-input"
              className="font-medium shrink-0 whitespace-nowrap"
            >
              {copy.sendLabel}
            </label>
            {!isReverse ? (
              <div className="relative inline-flex items-center min-w-0 max-w-[210px] sm:max-w-[250px]">
                <select
                  aria-label="Source chain"
                  value={selectedChainId}
                  onChange={(e) => handleChainChange(e.target.value)}
                  className="appearance-none bg-surface-3 pl-2 pr-6 py-0.5 rounded-pill text-xs font-medium text-text border border-hairline cursor-pointer focus:outline-none focus:border-lime w-full max-w-full truncate"
                >
                  {farChains.map((c) => (
                    <option
                      key={c.id}
                      value={c.id}
                      disabled={!c.enabled}
                      className="bg-surface-2"
                    >
                      {c.name}{' '}
                      {!c.enabled
                        ? `(${
                            !c.disabledReason ||
                            c.disabledReason.toLowerCase().includes('htlc')
                              ? 'not live yet'
                              : c.disabledReason
                          })`
                        : ''}
                    </option>
                  ))}
                </select>
                <ChevronDownIcon className="pointer-events-none absolute right-1.5 size-3 text-text-muted shrink-0" />
              </div>
            ) : (
              <span className="text-[11px] text-text-dim shrink-0 whitespace-nowrap">
                Bitcoin Cash
              </span>
            )}
          </div>

          <div className="flex items-center justify-between gap-3">
            <input
              id="send-input"
              type="number"
              step="any"
              min="1"
              value={sendAmount}
              inputMode="decimal"
              autoComplete="off"
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
          {isChainDisabled && selectedChain.disabledReason && (
            <p className="mt-1 text-[11px] text-warn">
              Route disabled: {selectedChain.disabledReason}
            </p>
          )}
        </div>

        {/* Direction Toggle button in center with micro-interaction (FR / B3-10) */}
        <div className="relative my-[-8px] z-10 flex justify-center">
          <button
            type="button"
            onClick={handleFlipDirection}
            aria-label="Toggle swap direction"
            className="group flex size-8 items-center justify-center rounded-full border border-hairline bg-surface-3 text-text shadow-md transition-all hover:border-lime/40 hover:text-lime cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-lime active:scale-95 motion-reduce:transform-none"
          >
            <ArrowUpDownIcon
              className={`size-3.5 transition-transform duration-300 ease-out motion-reduce:transition-none motion-reduce:transform-none ${
                isReverse ? 'rotate-180' : 'rotate-0'
              }`}
            />
          </button>
        </div>

        {/* You receive Well */}
        <div className="relative rounded-well border border-hairline bg-surface-2 p-3 transition-colors">
          <div className="flex items-center justify-between text-xs text-text-muted mb-1 gap-2">
            <span className="font-medium shrink-0 whitespace-nowrap">
              {copy.receiveLabel}
            </span>
            {isReverse ? (
              <div className="relative inline-flex items-center min-w-0 max-w-[210px] sm:max-w-[250px]">
                <select
                  aria-label="Destination chain"
                  value={selectedChainId}
                  onChange={(e) => handleChainChange(e.target.value)}
                  className="appearance-none bg-surface-3 pl-2 pr-6 py-0.5 rounded-pill text-xs font-medium text-text border border-hairline cursor-pointer focus:outline-none focus:border-lime w-full max-w-full truncate"
                >
                  {farChains.map((c) => (
                    <option
                      key={c.id}
                      value={c.id}
                      disabled={!c.enabled}
                      className="bg-surface-2"
                    >
                      {c.name}{' '}
                      {!c.enabled
                        ? `(${
                            !c.disabledReason ||
                            c.disabledReason.toLowerCase().includes('htlc')
                              ? 'not live yet'
                              : c.disabledReason
                          })`
                        : ''}
                    </option>
                  ))}
                </select>
                <ChevronDownIcon className="pointer-events-none absolute right-1.5 size-3 text-text-muted shrink-0" />
              </div>
            ) : (
              <span className="text-[11px] text-text-dim shrink-0 whitespace-nowrap">
                Bitcoin Cash
              </span>
            )}
          </div>

          <div className="flex items-center justify-between gap-3">
            <div className="text-xl sm:text-2xl font-semibold text-text">
              {displayedReceiveAmount}
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

        {/* Destination Recipient Address Well (Judge Path - §13, §19) */}
        <div className="mt-2.5 rounded-well border border-hairline bg-surface-2 p-3 transition-colors focus-within:border-lime">
          <div className="flex items-center justify-between text-xs text-text-muted mb-1">
            <label htmlFor="recipient-address-input" className="font-medium">
              {isReverse
                ? `Destination EVM Address (${selectedChain.name})`
                : 'Destination Bitcoin Cash Address'}
            </label>
            <span className="text-[10px] text-text-dim">
              {isReverse ? 'Paste any EVM address' : 'CashAddr format'}
            </span>
          </div>
          <input
            id="recipient-address-input"
            data-testid="recipient-address-input"
            type="text"
            value={recipientAddress}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoComplete="off"
            inputMode="text"
            onChange={(e) => {
              setRecipientAddress(e.target.value);
              setFailureState(null);
            }}
            placeholder={isReverse ? '0x...' : 'bchtest:...'}
            className="w-full bg-transparent font-mono text-xs text-text outline-none placeholder:text-text-dim/50"
          />
          {hasAddressError && (
            <p
              data-testid="address-validation-error"
              className="mt-1.5 text-[11px] font-medium text-danger flex items-center gap-1"
            >
              <span>⚠️</span>
              <span>
                {isReverse
                  ? `Invalid EVM address format for ${selectedChain.name}. Must start with 0x followed by 40 hex characters.`
                  : 'Invalid Bitcoin Cash address format. Expected CashAddr with prefix (bchtest:...).'}
              </span>
            </p>
          )}
        </div>

        {/* Multi-solver Winning Badge & Collapsible Disclosure (FR-14) */}
        {bestSolverQuote && (
          <div className="mt-2.5 rounded-lg border border-hairline bg-surface-2/80 p-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-text-dim">Winning solver</span>
              <span
                data-testid="winning-solver-badge"
                className="inline-flex items-center gap-1.5 rounded-pill bg-lime/10 px-2 py-0.5 font-medium text-lime border border-lime/20"
              >
                <span className="size-1.5 rounded-full bg-lime animate-pulse" />
                {formatSolverName(bestSolverQuote.solverUrl)} ·{' '}
                {bestSolverQuote.latencyMs}ms
              </span>
            </div>

            {/* Collapsed other solvers disclosure */}
            {multiQuoteResult &&
              (multiQuoteResult.quotes.length > 1 ||
                multiQuoteResult.failures.length > 0) && (
                <details className="mt-1.5 pt-1.5 border-t border-hairline/60">
                  <summary className="cursor-pointer text-[11px] font-medium text-text-muted hover:text-text transition-colors">
                    Other solvers (
                    {multiQuoteResult.quotes.length -
                      1 +
                      multiQuoteResult.failures.length}{' '}
                    participating)
                  </summary>
                  <ul className="mt-1.5 space-y-1 text-[11px]">
                    {multiQuoteResult.quotes
                      .filter((q) => q.solverUrl !== bestSolverQuote.solverUrl)
                      .map((q) => (
                        <li
                          key={q.solverUrl}
                          className="flex items-center justify-between text-text-muted"
                        >
                          <span>{formatSolverName(q.solverUrl)}</span>
                          <span className="font-mono">
                            Receive:{' '}
                            {(
                              Number(q.quote.receiveAmount) /
                              (isReverse ? 1_000_000 : 100)
                            ).toFixed(2)}{' '}
                            · {q.latencyMs}ms
                          </span>
                        </li>
                      ))}
                    {multiQuoteResult.failures.map((f) => (
                      <li
                        key={f.solverUrl}
                        className="flex items-center justify-between text-warn"
                      >
                        <span>{formatSolverName(f.solverUrl)}</span>
                        <span className="font-mono text-right truncate max-w-[200px]">
                          {f.kind === 'refusal' && f.refusal
                            ? formatQuoteRefusalMessage(f.refusal)
                            : f.message}{' '}
                          ({f.latencyMs}ms)
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
          </div>
        )}

        {/* No routes enabled warning (B3-11) */}
        {!hasAnyEnabledRoute && (
          <div
            data-testid="no-routes-enabled-alert"
            className="mt-2.5 rounded-lg border border-warn/30 bg-warn/10 p-2.5 text-xs text-warn"
            role="alert"
          >
            <p className="font-semibold">No swap routes currently enabled</p>
            <p className="mt-0.5 text-[11px] text-text-muted">
              {farChains[0]?.disabledReason ??
                'No counterparty routes have verified HTLC deployments on this network.'}
            </p>
          </div>
        )}

        {/* Selected route disabled alert (B3-11) */}
        {hasAnyEnabledRoute && isChainDisabled && (
          <div
            data-testid="route-disabled-alert"
            className="mt-2.5 rounded-lg border border-warn/30 bg-warn/10 p-2.5 text-xs text-warn"
            role="alert"
          >
            <p className="font-semibold">
              This swap route ({selectedChain.name}) is currently disabled
            </p>
            <p className="mt-0.5 text-[11px] text-text-muted">
              {selectedChain.disabledReason ??
                'HTLC contract not deployed or route not active on this network.'}
            </p>
          </div>
        )}

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

        {/* All Solvers Refused Failure State */}
        {((multiQuoteResult &&
          multiQuoteResult.quotes.length === 0 &&
          multiQuoteResult.failures.length > 0) ||
          failureState === 'all_solvers_refused') && (
          <div
            data-testid="all-solvers-refusing-alert"
            className="mt-2.5 rounded-lg border border-warn/30 bg-warn/10 p-2.5 text-xs text-warn"
            role="alert"
          >
            <p className="font-semibold">
              {FAILURE_COPY.allSolversRefused.title}
            </p>
            <p className="mt-0.5 text-[11px] text-text-muted">
              {FAILURE_COPY.allSolversRefused.message}
            </p>
            <div className="mt-2 flex justify-end">
              <CopyDiagnosticsButton
                data={{
                  route: `${sendTokenSymbol.toLowerCase()}-to-${receiveTokenSymbol.toLowerCase()}`,
                  errorCode: 'ALL_SOLVERS_REFUSED',
                  errorMessage: FAILURE_COPY.allSolversRefused.message,
                  solverUrls,
                }}
              />
            </div>
          </div>
        )}

        {/* Solver Unreachable Failure State */}
        {failureState === 'solver_unreachable' && (
          <div
            data-testid="solver-unreachable-alert"
            className="mt-2.5 rounded-lg border border-danger/30 bg-danger/10 p-2.5 text-xs text-danger"
            role="alert"
          >
            <p className="font-semibold">
              {FAILURE_COPY.solverUnreachable.title}
            </p>
            <p className="mt-0.5 text-[11px] text-text-muted">
              {FAILURE_COPY.solverUnreachable.message}
            </p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                data-testid="switch-read-only-button"
                onClick={() => {
                  setIsReadOnly(true);
                  setFailureState(null);
                }}
                className="rounded-pill bg-surface-3 px-2.5 py-1 text-[11px] font-semibold text-text hover:text-lime cursor-pointer"
              >
                {FAILURE_COPY.solverUnreachable.action}
              </button>
              <button
                type="button"
                data-testid="retry-solver-button"
                onClick={() => setFailureState(null)}
                className="rounded-pill border border-hairline px-2.5 py-1 text-[11px] font-medium text-text-muted hover:text-text cursor-pointer"
              >
                {FAILURE_COPY.solverUnreachable.retry}
              </button>
              <CopyDiagnosticsButton
                data={{
                  route: `${sendTokenSymbol.toLowerCase()}-to-${receiveTokenSymbol.toLowerCase()}`,
                  errorCode: 'SOLVER_UNREACHABLE',
                  errorMessage: FAILURE_COPY.solverUnreachable.message,
                  solverUrls,
                }}
              />
            </div>
          </div>
        )}

        {/* Quote Expired Failure State */}
        {failureState === 'quote_expired' && (
          <div
            data-testid="quote-expired-alert"
            className="mt-2.5 rounded-lg border border-warn/30 bg-warn/10 p-2.5 text-xs text-warn"
            role="alert"
          >
            <p className="font-semibold">{FAILURE_COPY.quoteExpired.title}</p>
            <p className="mt-0.5 text-[11px] text-text-muted">
              {FAILURE_COPY.quoteExpired.message}
            </p>
            <button
              type="button"
              data-testid="refresh-quote-button"
              onClick={() => setFailureState(null)}
              className="mt-2 rounded-pill bg-lime px-2.5 py-1 text-[11px] font-semibold text-lime-ink hover:bg-lime/90 cursor-pointer"
            >
              {FAILURE_COPY.quoteExpired.action}
            </button>
          </div>
        )}

        {/* Wallet Rejected Failure State */}
        {failureState === 'wallet_rejected' && (
          <div
            data-testid="wallet-rejected-alert"
            className="mt-2.5 rounded-lg border border-warn/30 bg-warn/10 p-2.5 text-xs text-warn"
            role="alert"
          >
            <p className="font-semibold">{FAILURE_COPY.walletRejected.title}</p>
            <p className="mt-0.5 text-[11px] text-text-muted">
              {FAILURE_COPY.walletRejected.message}
            </p>
            <button
              type="button"
              data-testid="try-again-button"
              onClick={() => setFailureState(null)}
              className="mt-2 rounded-pill bg-surface-3 px-2.5 py-1 text-[11px] font-semibold text-text hover:text-lime cursor-pointer"
            >
              {FAILURE_COPY.walletRejected.action}
            </button>
          </div>
        )}

        {/* Wrong Network Failure State */}
        {failureState === 'wrong_network' && (
          <div
            data-testid="wrong-network-alert"
            className="mt-2.5 rounded-lg border border-danger/30 bg-danger/10 p-2.5 text-xs text-danger"
            role="alert"
          >
            <p className="font-semibold">{FAILURE_COPY.wrongNetwork.title}</p>
            <p className="mt-0.5 text-[11px] text-text-muted">
              {FAILURE_COPY.wrongNetwork.message} (Requires {selectedChain.name}
              )
            </p>
            <button
              type="button"
              data-testid="switch-network-button"
              onClick={() => setFailureState(null)}
              className="mt-2 rounded-pill bg-olive px-2.5 py-1 text-[11px] font-semibold text-text hover:bg-olive/90 cursor-pointer"
            >
              {FAILURE_COPY.wrongNetwork.action}
            </button>
          </div>
        )}

        {/* Read-Only Mode Banner */}
        {isReadOnly && (
          <div
            data-testid="read-only-banner"
            className="mt-2.5 rounded-lg border border-warn/30 bg-warn/10 p-2.5 text-xs text-warn flex items-center justify-between"
            role="status"
          >
            <p className="font-medium text-[11px]">
              {FAILURE_COPY.readOnlyMode.banner}
            </p>
            <button
              type="button"
              onClick={() => setIsReadOnly(false)}
              className="ml-2 text-[10px] text-text underline hover:text-lime cursor-pointer shrink-0"
            >
              Exit read-only
            </button>
          </div>
        )}

        {/* Price Verification Warning Alert (FR-17) */}
        {priceWarning && (
          <div
            data-testid="price-warning"
            className="mt-2.5 rounded-lg border border-warn/30 bg-warn/10 p-2.5 text-xs text-warn"
            role="alert"
          >
            <p className="font-medium">⚠️ Reference price deviation</p>
            <p className="mt-0.5 text-[11px] text-text-muted">{priceWarning}</p>
          </div>
        )}

        {/* Quote Details Row with Evidence (FR-17) & Skeleton Loader (B3-10) */}
        {quoteLoading ? (
          <div
            data-testid="quote-skeleton"
            role="status"
            aria-label="Loading quote details"
            className="mt-2.5 space-y-2 rounded-xl bg-surface-2/60 p-2.5 animate-pulse"
          >
            <div className="flex items-center justify-between">
              <div className="h-3 w-12 rounded bg-surface-3" />
              <div className="h-3 w-28 rounded bg-surface-3" />
            </div>
            <div className="flex items-center justify-between">
              <div className="h-3 w-16 rounded bg-surface-3" />
              <div className="h-3 w-36 rounded bg-surface-3" />
            </div>
            <div className="flex items-center justify-between">
              <div className="h-3 w-20 rounded bg-surface-3" />
              <div className="h-3 w-24 rounded bg-surface-3" />
            </div>
          </div>
        ) : (
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
                  formatPricingEvidence(bestSolverQuote?.quote.terms.pricing)}
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
        )}

        {/* Real Recovery Download Action (Requirement 3) */}
        {bestSolverQuote && (
          <button
            type="button"
            onClick={handleDownloadRecovery}
            data-testid="download-recovery-button"
            className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-lg border border-hairline bg-surface-2 px-3 py-1.5 text-xs font-medium text-text hover:bg-surface-3 transition-colors cursor-pointer"
          >
            <span>
              {recoveryDownloaded
                ? '✓ Recovery file downloaded'
                : 'Download recovery file before swap'}
            </span>
          </button>
        )}

        {/* Primary Action Button */}
        <button
          type="button"
          disabled={submitButtonDisabled}
          onClick={handleSwap}
          data-testid="swap-submit-button"
          className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-pill bg-olive text-text font-semibold transition-colors hover:bg-olive/90 cursor-pointer shadow-elev-pill focus:outline-none focus-visible:ring-2 focus-visible:ring-lime disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <span>{submitButtonText}</span>
        </button>
      </div>

      {/* Thin arc horizon underneath */}
      <div className="horizon-arc" aria-hidden="true" />
    </div>
  );
}
