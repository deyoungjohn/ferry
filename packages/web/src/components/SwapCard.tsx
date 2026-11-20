import { useEffect, useState, useMemo, useContext, useRef } from 'react';
import { isAddress, parseUnits } from 'viem';
import {
  formatQuoteRefusalMessage,
  verifyPricing,
  type LiquidityResponse,
  type QuoteRefusal,
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
import { AlertIcon } from './icons';
import { LIVE_EXECUTION_ENABLED, NETWORK_PROFILE } from '../lib/config';
import { useSolver } from '../lib/solver/useSolver';
import { WalletContext } from '../lib/wallet/context';
import { RealPriceReader } from '../lib/pricing/real';
import type { ChainDisplay } from '../lib/network';
import {
  readBchTokenBalance,
  readEvmTokenBalance,
  shareOfBalance,
  floorUnitsToText,
} from '../lib/wallet/send-balance';
import { createBrowserBchChain } from '../lib/live/bch-chain';
import { AmountSlider } from './swap-block/AmountSlider';
import type { QuoteResponse, SwapLane } from '../lib/solver/types';
import { useReducedMotion } from 'motion/react';
import { useOptionalNavigate } from '../lib/useOptionalNavigate';
import { ROUTES } from '../lib/routes';
import { buildCoreQuoteRequest, farTokenFacts } from '../lib/solver/core-quote';
import { LiveSwapPanel } from './LiveSwapPanel';
import type { QuoteInput } from '@ferry/user-flow';
import { readBchTipHeight } from '../lib/solver/tip';
import { LIVE_EXECUTION_MESSAGE } from '../lib/solver/real';
import { Field } from './swap-block/field';
import { FlipButton } from './swap-block/controls';
import { TokenPicker } from './swap-block/token-picker';
import type { Chain, Token, TokenSide } from './swap-block/types';
import { CopyDiagnosticsButton } from './CopyDiagnosticsButton';
import { useToast } from '../lib/toast/ToastContext';
import { RescueKeyPrompt } from './RescueKeyPrompt';

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

const LIVE_PLACEHOLDER_QUOTE: QuoteResponse = {
  fromToken: '',
  toToken: '',
  fromAmount: 0,
  toAmount: 0,
  exchangeRate: 0,
  spreadBps: 0,
  estimatedSeconds: 0,
  expiresInSeconds: 0,
};

const CHAIN_BADGES: Record<string, string> = {
  base: 'Bs',
  ethereum: 'Ξ',
  arbitrum: 'Ab',
  arc: 'Ac',
  bnb: 'Bn',
  robinhood: 'Rh',
};

export function SwapCard({
  initialReverse = false, // Leads with USDC -> PUSD
  initialRecipient,
  initialFailureState,
}: SwapCardProps = {}) {
  const solver = useSolver();
  const navigate = useOptionalNavigate();
  const walletContext = useContext(WalletContext);
  const evm = walletContext?.evm ?? { status: 'disconnected', address: null };
  const bchAddress = walletContext?.bch.address?.address ?? null;
  const quoteSecretRef = useRef<string | null>(null);
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
  // The destination follows the connected wallet for the direction (an EVM wallet when you receive
  // on an EVM chain, the Bitcoin Cash wallet when you receive Bitcoin Cash). The person can type
  // another address instead. A flip clears a typed address: it belonged to the other chain.
  // A pay link opens the swap with its recipient and amount in the address bar (?to=&amount=).
  const linkParams =
    typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search)
      : new URLSearchParams();
  const linkRecipient = !initialReverse ? (linkParams.get('to') ?? '') : '';
  const [customRecipient, setCustomRecipient] = useState<string>(
    initialRecipient ?? linkRecipient,
  );
  const [useCustomRecipient, setUseCustomRecipient] = useState<boolean>(
    (initialRecipient !== undefined && initialRecipient !== '') ||
      linkRecipient !== '',
  );
  const walletRecipient = (isReverse ? evm.address : bchAddress) ?? '';
  const usingWalletRecipient = !useCustomRecipient && walletRecipient !== '';
  const recipientAddress = usingWalletRecipient
    ? walletRecipient
    : customRecipient;

  // Send amount
  const linkAmount = linkParams.get('amount');
  const [sendAmount, setSendAmount] = useState<string>(
    linkAmount && /^\d+(\.\d{1,2})?$/.test(linkAmount) ? linkAmount : '5.00',
  );
  const [lane, setLane] = useState<SwapLane>('fast');
  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [bestSolverQuote, setBestSolverQuote] =
    useState<VerifiedSolverQuote | null>(null);
  const [multiQuoteResult, setMultiQuoteResult] =
    useState<BestQuoteResult | null>(null);
  const [refusal, setRefusal] = useState<QuoteRefusal | null>(null);
  const [failureDetail, setFailureDetail] = useState<string | null>(null);
  const [priceWarning, setPriceWarning] = useState<string | null>(null);
  const [liquidity, setLiquidity] = useState<LiquidityResponse | null>(null);
  const [recoveryDownloaded, setRecoveryDownloaded] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [livePanelOpen, setLivePanelOpen] = useState(false);
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

  // The available figure: read on mount, then every 15 seconds and when the tab is shown again,
  // so it never stays at an old value.
  useEffect(() => {
    let active = true;
    const read = () =>
      solver
        .getLiquidity()
        .then((res) => {
          if (active) setLiquidity(res);
        })
        .catch(() => {
          // Keep the last figure when a read fails
        });
    void read();
    const timer = window.setInterval(() => void read(), 15_000);
    const onVisible = () => {
      if (!document.hidden) void read();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [solver, bestSolverQuote]);

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
    // With live solvers configured the multi-solver path below is the quote; the single
    // adapter quote only serves the standalone mock.
    (solverUrls.length > 0
      ? Promise.resolve(LIVE_PLACEHOLDER_QUOTE)
      : solver.getQuote({
          fromToken,
          toToken,
          fromChain,
          toChain,
          fromAmount: amountNum,
          lane,
          userAddress: evm.address ?? undefined,
          recipientAddress: recipientAddress.trim() || undefined,
        })
    )
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
            setFailureDetail(null);
          }
          return;
        }

        // 2. Call bestQuote across all configured solvers (FR-14)
        const built = buildCoreQuoteRequest({
          fromToken,
          toToken,
          fromChain,
          toChain,
          fromAmount: amountNum,
          lane,
          userAddress: (isReverse ? bchAddress : evm.address) ?? undefined,
          recipientAddress: recipientAddress.trim() || undefined,
        });
        if (!built) {
          setQuoteLoading(false);
          setRefusal({
            reason: 'ROUTE_DISABLED',
            asset: fromToken,
            message: 'This route is not available in this build',
          });
          return;
        }
        quoteSecretRef.current = built.secret;
        const quoteReq = built.request;

        const fetchImpl =
          typeof window !== 'undefined' ? window.fetch.bind(window) : fetch;

        readBchTipHeight(solverUrls[0], fetchImpl)
          .then((tip) =>
            bestQuote(solverUrls, quoteReq, {
              fetch: fetchImpl,
              bchTipHeight: tip,
              evmTokenDecimals: built.farToken.decimals,
              bchTokenDecimals: 2,
            }),
          )
          .then(async (result) => {
            if (!active) return;
            setQuoteLoading(false);
            setMultiQuoteResult(result);

            if (result.best) {
              setBestSolverQuote(result.best);
              setRefusal(null);
              setFailureDetail(null);

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
                setFailureDetail(null);
                setRefusal(firstFailure.refusal);
              } else if (firstFailure) {
                setRefusal(null);
                setFailureDetail(firstFailure.message);
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
    setCustomRecipient('');
    setUseCustomRecipient(false);
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
    if (!liquidity) return null;
    // Into an EVM chain, the solver's stock of that token on that chain; into Bitcoin Cash, its
    // PUSD or MUSD.
    const found = isReverse
      ? liquidity.routes.find((r) =>
          r.route.endsWith(
            `-to-${selectedChain.chainKey ?? ''}-${selectedFarToken.toLowerCase()}`,
          ),
        )
      : liquidity.routes.find(
          (r) =>
            r.asset.toUpperCase() ===
            selectedBchToken.replace(/^t/, '').toUpperCase(),
        );
    if (!found) return null;
    const units = BigInt(found.available);
    const scaled = Number(units) / 10 ** found.decimals;
    return scaled.toLocaleString('en-US', { maximumFractionDigits: 0 });
  }, [
    liquidity,
    isReverse,
    selectedBchToken,
    selectedChain.chainKey,
    selectedFarToken,
  ]);

  const sendTokenSymbol = isReverse ? selectedBchToken : selectedFarToken;

  // The connected wallet's balance of the token being sent, for the share slider. Nothing is
  // drawn without a wallet (a Bitcoin Cash wallet often connects only after the first quote).
  const [walletBalance, setWalletBalance] = useState<bigint | null>(null);
  const [sharePercent, setSharePercent] = useState(0);
  const sendDecimals = isReverse
    ? 2
    : (farTokenFacts(selectedChain.name, selectedFarToken)?.decimals ?? 6);
  const sendBchConnected = walletContext?.bch.status === 'connected';
  const sendEvmAddress = evm.address;
  useEffect(() => {
    let active = true;
    setWalletBalance(null);
    setSharePercent(0);
    (async () => {
      try {
        if (!isReverse) {
          const far = farTokenFacts(selectedChain.name, selectedFarToken);
          if (!far || !sendEvmAddress || evm.status !== 'connected') return;
          const balance = await readEvmTokenBalance(
            Number(selectedChain.id),
            far.address,
            sendEvmAddress as `0x${string}`,
            { solverUrl: solverUrls[0] },
          );
          if (active) setWalletBalance(balance);
        } else {
          if (!sendBchConnected || !walletContext?.bch.listFundingAddresses)
            return;
          const solverUrl = solverUrls[0];
          const chain = createBrowserBchChain({ solverUrl });
          const addresses = await walletContext.bch.listFundingAddresses();
          const balance = await readBchTokenBalance(
            selectedBchToken,
            addresses.map((a) => a.lockingBytecodeHex),
            (bytecode) => chain.getUtxos(bytecode),
          );
          if (active) setWalletBalance(balance);
        }
      } catch {
        // No figure: the slider simply stays hidden.
      }
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isReverse,
    selectedChain.id,
    selectedFarToken,
    selectedBchToken,
    sendEvmAddress,
    evm.status,
    sendBchConnected,
  ]);

  function applyShare(percent: number) {
    setSharePercent(percent);
    if (walletBalance === null) return;
    const units = shareOfBalance(walletBalance, percent);
    // Cut off, never rounded up: the amount must not exceed what the wallet holds.
    const text = floorUnitsToText(units, sendDecimals, 2);
    setSendAmount(percent === 0 ? '' : text);
  }
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

  /** What a real swap needs from the form, or the plain reason it cannot start. */
  function liveSwapInput():
    { input: QuoteInput } | { problem: string; connect?: () => void } {
    const far = farTokenFacts(selectedChain.name, selectedFarToken);
    if (!far) return { problem: 'This route is not configured in this build.' };
    if (!evm.address)
      return {
        problem: 'Connect your EVM wallet first.',
        connect: () => walletContext?.evm.connect(),
      };
    if (!bchAddress)
      return {
        problem: 'Connect your Bitcoin Cash wallet first.',
        connect: () => walletContext?.bch.connect(),
      };
    // The wallet that signs the lock must be connected now: a remembered address is not enough.
    if (isReverse && walletContext?.bch.status !== 'connected')
      return {
        problem:
          'Reconnect your Bitcoin Cash wallet: it is remembered but not connected, so it cannot sign the lock.',
        connect: () => walletContext?.bch.connect(),
      };
    if (!isReverse && evm.status !== 'connected')
      return {
        problem: 'Reconnect your EVM wallet to sign the lock.',
        connect: () => walletContext?.evm.connect(),
      };
    const bchToken = (
      isReverse ? selectedBchToken : receiveTokenSymbolRaw
    ).replace(/^t/, '');
    if (bchToken !== 'PUSD' && bchToken !== 'MUSD') {
      return { problem: 'This token is not available for live swaps.' };
    }
    let amountIn: bigint;
    try {
      amountIn = parseUnits(sendAmount.trim(), isReverse ? 2 : far.decimals);
    } catch {
      return { problem: 'Enter a valid amount.' };
    }
    return {
      input: {
        direction: isReverse ? 'BCH_TO_EVM' : 'EVM_TO_BCH',
        token: bchToken,
        chainId: far.chainId,
        evmToken: far.address,
        amountIn,
        evmTokenDecimals: far.decimals,
        bchTokenDecimals: 2,
        lane,
        // Picking the fast lane is the person's consent to it.
        fastOptIn: lane === 'fast',
      },
    };
  }
  const receiveTokenSymbolRaw = isReverse ? selectedFarToken : selectedBchToken;
  const liveSwap = livePanelOpen ? liveSwapInput() : null;

  async function handleSwap() {
    if (isReadOnly || !isValidRecipient) return;
    if (solver.isLive() && LIVE_EXECUTION_ENABLED) {
      const prepared = liveSwapInput();
      if ('problem' in prepared) {
        // A missing wallet opens that wallet's connect dialog (QR for Bitcoin Cash); other
        // problems are explained in a toast.
        if (prepared.connect) prepared.connect();
        else showToast(prepared.problem, 'error');
        return;
      }
      setLivePanelOpen(true);
      return;
    }
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
        window.location.assign(ROUTES.swapOrder(orderId));
      }
    } catch (err) {
      setIsSubmitting(false);
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === LIVE_EXECUTION_MESSAGE) {
        showToast(msg, 'error');
      } else if (msg.includes('rejected') || msg.includes('denied')) {
        setFailureState('wallet_rejected');
      } else if (msg.includes('expired')) {
        setFailureState('quote_expired');
      }
    }
  }

  // Calculated displayed receive amount
  // The EVM token's own decimals (6 for most, 18 for BNB Chain's USDT and USDC).
  const farDecimals =
    farTokenFacts(selectedChain.name, selectedFarToken)?.decimals ?? 6;
  const displayedReceiveAmount = useMemo(() => {
    if (bestSolverQuote) {
      const units = Number(bestSolverQuote.quote.receiveAmount);
      return (isReverse ? units / 10 ** farDecimals : units / 100).toFixed(2);
    }
    if (quote) {
      return quote.toAmount.toFixed(2);
    }
    return '0.00';
  }, [bestSolverQuote, quote, isReverse, farDecimals]);

  // What the person really gets for each unit sent, and what the swap costs them, from the amounts
  // on screen (both stablecoins count as one dollar here; the pricing line shows the references).
  const sentNumber = parseFloat(sendAmount) || 0;
  const receivedNumber = parseFloat(displayedReceiveAmount) || 0;
  const effectiveRate =
    sentNumber > 0 && receivedNumber > 0 ? receivedNumber / sentNumber : null;
  const feeShown =
    sentNumber > 0 && receivedNumber > 0 && sentNumber > receivedNumber
      ? `$${(sentNumber - receivedNumber).toFixed(2)} (${(
          ((sentNumber - receivedNumber) / sentNumber) *
          100
        ).toFixed(2)}%)`
      : null;

  // Swap block adapters: Ferry's chains and tokens expressed as the block's types.
  const reduceMotion = useReducedMotion();
  const [pickerSide, setPickerSide] = useState<TokenSide | null>(null);

  const bchBlockChain: Chain = {
    id: 'bch',
    name: 'Bitcoin Cash',
    tone: 'bg-primary text-primary-foreground',
    symbol: '₿',
  };
  const farBlockChains: Chain[] = farChains.map((c) => ({
    id: String(c.id),
    name: c.name,
    tone: 'bg-muted text-foreground',
    symbol: CHAIN_BADGES[c.chainKey ?? ''] ?? c.name.slice(0, 2),
  }));
  const bchBlockTokens: Token[] = bchTokens.map((sym) => ({
    id: `bch:${sym}`,
    symbol: sym,
    name: 'Bitcoin Cash',
    chainId: 'bch',
    usd: 1,
  }));
  const farBlockTokens: Token[] = farChains.flatMap((c) =>
    (c.tokenSymbols.length > 0 ? c.tokenSymbols : ['USDC']).map((sym) => ({
      id: `${String(c.id)}:${sym}`,
      symbol: sym,
      name: c.name,
      chainId: String(c.id),
      usd: 1,
      ...(c.enabled ? {} : { disabledReason: 'Not live yet' }),
    })),
  );
  const bchBlockToken = bchBlockTokens.find(
    (t) => t.symbol === selectedBchToken,
  ) ??
    bchBlockTokens[0] ?? { id: 'bch:', symbol: '', name: '', chainId: 'bch' };
  const farBlockToken = farBlockTokens.find(
    (t) =>
      t.chainId === String(selectedChain.id) && t.symbol === selectedFarToken,
  ) ?? {
    id: 'far:',
    symbol: selectedFarToken,
    name: selectedFarToken,
    chainId: String(selectedChain.id),
    usd: 1,
  };
  const farBlockChain =
    farBlockChains.find((c) => c.id === String(selectedChain.id)) ??
    farBlockChains[0] ??
    bchBlockChain;
  const fromBlockToken = isReverse ? bchBlockToken : farBlockToken;
  const fromBlockChain = isReverse ? bchBlockChain : farBlockChain;
  const toBlockToken = isReverse ? farBlockToken : bchBlockToken;
  const toBlockChain = isReverse ? farBlockChain : bchBlockChain;

  const pickerOnBch =
    (pickerSide === 'from' && isReverse) || (pickerSide === 'to' && !isReverse);
  const pickerChains = pickerOnBch ? [bchBlockChain] : farBlockChains;
  const pickerTokens = pickerOnBch ? bchBlockTokens : farBlockTokens;
  const pickerSelectedId = pickerOnBch ? bchBlockToken.id : farBlockToken.id;

  function handlePickToken(id: string) {
    const [chainPart, ...rest] = id.split(':');
    const symbol = rest.join(':');
    if (chainPart === 'bch') {
      setSelectedBchToken(symbol);
    } else {
      handleChainChange(chainPart ?? '');
      setSelectedFarToken(symbol);
    }
    setPickerSide(null);
  }

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
    <div className="mx-auto w-full max-w-md px-4 pt-1 pb-4">
      {/* Solver status disclaimer banner */}
      {!solver.isLive() && (
        <div
          data-testid="solver-label"
          className="mb-2 flex items-center justify-between rounded-lg border border-warn/30 bg-warn/10 px-3 py-1 text-xs"
        >
          <div className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-warn" />
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
      <div className="card-ring relative overflow-hidden rounded-card border border-hairline bg-surface-1 p-3.5 sm:p-4">
        {/* Lane Toggle & Liquidity Maximum Display */}
        <div className="mb-2.5 flex items-center justify-between gap-2">
          {availableLiquidity !== null ? (
            <div
              data-testid="liquidity-available"
              className="text-[11px] font-medium text-text-muted"
            >
              Available:{' '}
              <span className="font-semibold text-text">
                {availableLiquidity} {receiveTokenSymbol}
              </span>
            </div>
          ) : (
            <div
              data-testid="liquidity-available"
              className="text-[11px] font-medium text-text-muted"
            >
              Available: unknown
            </div>
          )}

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
              Fast
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
              Safe
            </button>
          </div>
        </div>

        {/* You pay / flip / you get: the swap block */}
        <div className="relative">
          <Field
            side="from"
            token={fromBlockToken}
            chain={fromBlockChain}
            amount={sendAmount}
            onAmount={setSendAmount}
            editable
            quoting={false}
            onOpenPicker={() => setPickerSide('from')}
            labels={{ youPay: copy.sendLabel }}
          />
          {walletBalance !== null && walletBalance > 0n && (
            <AmountSlider
              percent={sharePercent}
              onPercent={applyShare}
              balanceText={(Number(walletBalance) / 10 ** sendDecimals).toFixed(
                2,
              )}
              symbol={sendTokenSymbol}
            />
          )}
          <div className="my-1">
            <FlipButton
              rotation={isReverse ? 180 : 0}
              reduce={Boolean(reduceMotion)}
              onClick={handleFlipDirection}
            />
          </div>
          <Field
            side="to"
            token={toBlockToken}
            chain={toBlockChain}
            amount={displayedReceiveAmount}
            editable={false}
            quoting={quoteLoading}
            onOpenPicker={() => setPickerSide('to')}
            labels={{ youGet: copy.receiveLabel }}
          />
          {isChainDisabled && selectedChain.disabledReason && (
            <p className="mt-1 text-[11px] text-warn">
              Route disabled: {selectedChain.disabledReason}
            </p>
          )}
        </div>
        <TokenPicker
          open={pickerSide !== null}
          side={pickerSide}
          chains={pickerChains}
          tokens={pickerTokens}
          selectedId={pickerSelectedId}
          onPick={handlePickToken}
          onClose={() => setPickerSide(null)}
          reduce={Boolean(reduceMotion)}
        />

        {/* Destination Recipient Address Well (Judge Path - §13, §19) */}
        <div className="mt-2.5 rounded-well border border-hairline bg-surface-2 p-3 transition-colors focus-within:border-lime">
          <div className="flex items-center justify-between text-xs text-text-muted mb-1">
            <label htmlFor="recipient-address-input" className="font-medium">
              {isReverse
                ? `Destination EVM Address (${selectedChain.name})`
                : 'Destination Bitcoin Cash Address'}
            </label>
            <span className="text-xs text-text-dim">
              {isReverse ? 'Paste any EVM address' : 'CashAddr format'}
            </span>
          </div>
          {usingWalletRecipient ? (
            <div className="flex items-center justify-between gap-2">
              <span
                data-testid="recipient-from-wallet"
                className="min-w-0 truncate font-mono text-xs text-text"
                title={walletRecipient}
              >
                {walletRecipient}
              </span>
              <button
                type="button"
                data-testid="recipient-use-other"
                onClick={() => {
                  setCustomRecipient('');
                  setUseCustomRecipient(true);
                }}
                className="shrink-0 text-[11px] font-medium text-lime hover:underline cursor-pointer"
              >
                Use a different address
              </button>
            </div>
          ) : (
            <>
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
                  setCustomRecipient(e.target.value);
                  setFailureState(null);
                }}
                placeholder={isReverse ? '0x...' : 'bitcoincash:...'}
                className="w-full bg-transparent font-mono text-xs text-text outline-none placeholder:text-text-dim/50"
              />
              {walletRecipient !== '' && (
                <button
                  type="button"
                  data-testid="recipient-use-wallet"
                  onClick={() => {
                    setCustomRecipient('');
                    setUseCustomRecipient(false);
                  }}
                  className="mt-1.5 text-[11px] font-medium text-lime hover:underline cursor-pointer"
                >
                  Use my connected wallet
                </button>
              )}
            </>
          )}
          {hasAddressError && (
            <p
              data-testid="address-validation-error"
              className="mt-1.5 text-[11px] font-medium text-danger flex items-center gap-1"
            >
              <AlertIcon className="size-3.5 shrink-0" />
              <span>
                {isReverse
                  ? `Invalid EVM address format for ${selectedChain.name}. Must start with 0x followed by 40 hex characters.`
                  : 'Invalid Bitcoin Cash address format. Paste a CashAddr address (bitcoincash:...).'}
              </span>
            </p>
          )}
        </div>

        {/* Multi-solver Winning Badge & Collapsible Disclosure (FR-14) */}
        {/* Shown only when more than one solver is configured: with one there is nothing to compare. */}
        {bestSolverQuote && solverUrls.length > 1 && (
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
                              (isReverse ? 10 ** farDecimals : 100)
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
        {!refusal &&
          ((multiQuoteResult &&
            multiQuoteResult.quotes.length === 0 &&
            multiQuoteResult.failures.length > 0) ||
            failureState === 'all_solvers_refused') && (
            <div
              data-testid="all-solvers-refusing-alert"
              className="mt-2.5 rounded-lg border border-warn/30 bg-warn/10 p-2.5 text-xs text-warn"
              role="alert"
            >
              <p className="font-semibold">
                {failureDetail && solverUrls.length < 2
                  ? 'Quote unavailable'
                  : FAILURE_COPY.allSolversRefused.title}
              </p>
              <p className="mt-0.5 text-[11px] text-text-muted">
                {failureDetail ?? FAILURE_COPY.allSolversRefused.message}
              </p>
              <div className="mt-2 flex justify-end">
                <CopyDiagnosticsButton
                  data={{
                    route: `${sendTokenSymbol.toLowerCase()}-to-${receiveTokenSymbol.toLowerCase()}`,
                    errorCode: 'ALL_SOLVERS_REFUSED',
                    errorMessage:
                      failureDetail ?? FAILURE_COPY.allSolversRefused.message,
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
              className="ml-2 text-xs text-text underline hover:text-lime cursor-pointer shrink-0"
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
            <p className="flex items-center gap-1.5 font-medium">
              <AlertIcon className="size-3.5 shrink-0" />
              Reference price deviation
            </p>
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
              <span className="font-mono text-text" data-testid="quote-rate">
                1 {sendTokenSymbol} ={' '}
                {effectiveRate !== null
                  ? effectiveRate.toFixed(4)
                  : quote?.exchangeRate
                    ? quote.exchangeRate.toFixed(4)
                    : '—'}{' '}
                {receiveTokenSymbol}
              </span>
            </div>
            {feeShown && (
              <div className="flex items-center justify-between">
                <span className="text-text-dim">Fee</span>
                <span className="font-mono text-text" data-testid="quote-fee">
                  {feeShown}
                </span>
              </div>
            )}

            <div className="flex items-center justify-between">
              <span className="text-text-dim">Est. settlement</span>
              <span className="text-ok">
                {lane === 'fast'
                  ? '< 1 minute (Fast lane)'
                  : '≈ 1–2 minutes (Safe lane)'}
              </span>
            </div>
          </div>
        )}

        {/* Live mode: say plainly what works. The recovery file is offered once locking is switched on, because it must hold the real contract data. */}
        {solver.isLive() && !LIVE_EXECUTION_ENABLED && (
          <p
            data-testid="live-exec-note"
            className="mt-2.5 rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-[11px] leading-relaxed text-warn"
          >
            Quotes and route checks are live. Locking funds from this page is
            being switched on; until then this button does not move money.
          </p>
        )}

        {liveSwap && 'input' in liveSwap && walletContext && (
          <LiveSwapPanel
            open={livePanelOpen}
            onClose={() => setLivePanelOpen(false)}
            input={liveSwap.input}
            wallets={{ evm: walletContext.evm, bch: walletContext.bch }}
            solverUrl={solverUrls[0] ?? ''}
            describe={{
              pay: `${sendAmount} ${sendTokenSymbol}`,
              receive: `${displayedReceiveAmount} ${receiveTokenSymbol}`,
            }}
            onStart={(orderId) => {
              setLivePanelOpen(false);
              void navigate(ROUTES.swapOrder(orderId), {
                state: { start: true },
              });
            }}
          />
        )}

        {/* Real Recovery Download Action (Requirement 3) */}
        {bestSolverQuote && !solver.isLive() && (
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

        {/* Reverse swaps without connected EVM wallet: Rescue key prompt */}
        {isReverse && !evm.address && <RescueKeyPrompt />}

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
    </div>
  );
}
