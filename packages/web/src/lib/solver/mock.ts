import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import {
  orderId as computeOrderId,
  quoteOut,
  signOrderId,
  type Hex,
  type Hex32,
  type LiquidityResponse,
  type OrderTerms,
  type PricingEvidence,
  type QuoteRefusal,
} from '@ferry/core';
import { SPREAD_BPS, FIXED_FEE_USD } from '../config';
import { loadSendLink } from '../paylink/send-store';
import { formatPricingEvidence } from './pricing-display';
import { defaultMockServer } from './mock-fetch';
import type {
  SwitchSendLinkRouteRequest,
  SwitchSendLinkRouteResponse,
} from '@ferry/core/api';
import type {
  SendLinkView,
  SolverClient,
  QuoteRequest,
  QuoteResponse,
  QuoteResult,
  SignedQuote,
  SolverStats,
  PaginatedRecentSwaps,
  RecentSwap,
  PegPrice,
  SwapOrder,
  OrderStatus,
  OrderTransaction,
  SolverHealthResponse,
  OperatorRouteInfo,
} from './types';

// Ephemeral mock signing key generated dynamically at startup - zero hardcoded key material in repo
const MOCK_SOLVER_KEY = generatePrivateKey();
const mockSolverAccount = privateKeyToAccount(MOCK_SOLVER_KEY);

// 25 realistic mock swaps for testing pagination (10 per page => 3 pages)
const SAMPLE_MOCK_SWAPS: readonly RecentSwap[] = [
  {
    id: 'mock-01',
    timestampSeconds: 1731670000,
    fromToken: 'USDC',
    fromAmount: 20.0,
    fromChain: 'Base Sepolia',
    toToken: 'tPUSD',
    toAmount: 19.87,
    toChain: 'Bitcoin Cash Chipnet',
    durationSeconds: 42,
    sourceTxHash: '0xmocka1b2c3d4e5f601',
    targetTxHash: 'mockbcha1b2c3d4e5f601',
    isMock: true,
  },
  {
    id: 'mock-02',
    timestampSeconds: 1731668200,
    fromToken: 'tPUSD',
    fromAmount: 50.0,
    fromChain: 'Bitcoin Cash Chipnet',
    toToken: 'USDC',
    toAmount: 49.75,
    toChain: 'Base Sepolia',
    durationSeconds: 38,
    sourceTxHash: 'mockbcha1b2c3d4e5f602',
    targetTxHash: '0xmocka1b2c3d4e5f602',
    isMock: true,
  },
  {
    id: 'mock-03',
    timestampSeconds: 1731665000,
    fromToken: 'USDC',
    fromAmount: 10.0,
    fromChain: 'Ethereum Sepolia',
    toToken: 'tPUSD',
    toAmount: 9.91,
    toChain: 'Bitcoin Cash Chipnet',
    durationSeconds: 51,
    sourceTxHash: '0xmocka1b2c3d4e5f603',
    targetTxHash: 'mockbcha1b2c3d4e5f603',
    isMock: true,
  },
  {
    id: 'mock-04',
    timestampSeconds: 1731661000,
    fromToken: 'USDT',
    fromAmount: 15.0,
    fromChain: 'BNB Smart Chain Testnet',
    toToken: 'tMUSD',
    toAmount: 14.89,
    toChain: 'Bitcoin Cash Chipnet',
    durationSeconds: 44,
    sourceTxHash: '0xmocka1b2c3d4e5f604',
    targetTxHash: 'mockbcha1b2c3d4e5f604',
    isMock: true,
  },
  {
    id: 'mock-05',
    timestampSeconds: 1731657000,
    fromToken: 'USDC',
    fromAmount: 25.0,
    fromChain: 'Arbitrum Sepolia',
    toToken: 'tPUSD',
    toAmount: 24.85,
    toChain: 'Bitcoin Cash Chipnet',
    durationSeconds: 35,
    sourceTxHash: '0xmocka1b2c3d4e5f605',
    targetTxHash: 'mockbcha1b2c3d4e5f605',
    isMock: true,
  },
  {
    id: 'mock-06',
    timestampSeconds: 1731653000,
    fromToken: 'USDC',
    fromAmount: 5.0,
    fromChain: 'Base Sepolia',
    toToken: 'tPUSD',
    toAmount: 4.93,
    toChain: 'Bitcoin Cash Chipnet',
    durationSeconds: 40,
    sourceTxHash: '0xmocka1b2c3d4e5f606',
    targetTxHash: 'mockbcha1b2c3d4e5f606',
    isMock: true,
  },
  {
    id: 'mock-07',
    timestampSeconds: 1731649000,
    fromToken: 'tMUSD',
    fromAmount: 12.0,
    fromChain: 'Bitcoin Cash Chipnet',
    toToken: 'USDT',
    toAmount: 11.9,
    toChain: 'BSC Testnet',
    durationSeconds: 47,
    sourceTxHash: 'mockbcha1b2c3d4e5f607',
    targetTxHash: '0xmocka1b2c3d4e5f607',
    isMock: true,
  },
  {
    id: 'mock-08',
    timestampSeconds: 1731645000,
    fromToken: 'USDC',
    fromAmount: 30.0,
    fromChain: 'Base Sepolia',
    toToken: 'tPUSD',
    toAmount: 29.83,
    toChain: 'Bitcoin Cash Chipnet',
    durationSeconds: 39,
    sourceTxHash: '0xmocka1b2c3d4e5f608',
    targetTxHash: 'mockbcha1b2c3d4e5f608',
    isMock: true,
  },
  {
    id: 'mock-09',
    timestampSeconds: 1731641000,
    fromToken: 'tPUSD',
    fromAmount: 18.0,
    fromChain: 'Bitcoin Cash Chipnet',
    toToken: 'USDC',
    toAmount: 17.88,
    toChain: 'Ethereum Sepolia',
    durationSeconds: 55,
    sourceTxHash: 'mockbcha1b2c3d4e5f609',
    targetTxHash: '0xmocka1b2c3d4e5f609',
    isMock: true,
  },
  {
    id: 'mock-10',
    timestampSeconds: 1731637000,
    fromToken: 'USDC',
    fromAmount: 8.0,
    fromChain: 'Arbitrum Sepolia',
    toToken: 'tPUSD',
    toAmount: 7.92,
    toChain: 'Bitcoin Cash Chipnet',
    durationSeconds: 36,
    sourceTxHash: '0xmocka1b2c3d4e5f610',
    targetTxHash: 'mockbcha1b2c3d4e5f610',
    isMock: true,
  },
  {
    id: 'mock-11',
    timestampSeconds: 1731633000,
    fromToken: 'USDT',
    fromAmount: 14.0,
    fromChain: 'BSC Testnet',
    toToken: 'tPUSD',
    toAmount: 13.89,
    toChain: 'Bitcoin Cash Chipnet',
    durationSeconds: 43,
    sourceTxHash: '0xmocka1b2c3d4e5f611',
    targetTxHash: 'mockbcha1b2c3d4e5f611',
    isMock: true,
  },
  {
    id: 'mock-12',
    timestampSeconds: 1731629000,
    fromToken: 'USDC',
    fromAmount: 22.0,
    fromChain: 'Base Sepolia',
    toToken: 'tPUSD',
    toAmount: 21.86,
    toChain: 'Bitcoin Cash Chipnet',
    durationSeconds: 41,
    sourceTxHash: '0xmocka1b2c3d4e5f612',
    targetTxHash: 'mockbcha1b2c3d4e5f612',
    isMock: true,
  },
  {
    id: 'mock-13',
    timestampSeconds: 1731625000,
    fromToken: 'tPUSD',
    fromAmount: 35.0,
    fromChain: 'Bitcoin Cash Chipnet',
    toToken: 'USDC',
    toAmount: 34.81,
    toChain: 'Base Sepolia',
    durationSeconds: 37,
    sourceTxHash: 'mockbcha1b2c3d4e5f613',
    targetTxHash: '0xmocka1b2c3d4e5f613',
    isMock: true,
  },
  {
    id: 'mock-14',
    timestampSeconds: 1731621000,
    fromToken: 'USDC',
    fromAmount: 16.0,
    fromChain: 'Ethereum Sepolia',
    toToken: 'tPUSD',
    toAmount: 15.89,
    toChain: 'Bitcoin Cash Chipnet',
    durationSeconds: 50,
    sourceTxHash: '0xmocka1b2c3d4e5f614',
    targetTxHash: 'mockbcha1b2c3d4e5f614',
    isMock: true,
  },
  {
    id: 'mock-15',
    timestampSeconds: 1731617000,
    fromToken: 'USDT',
    fromAmount: 19.0,
    fromChain: 'BNB Smart Chain Testnet',
    toToken: 'tMUSD',
    toAmount: 18.87,
    toChain: 'Bitcoin Cash Chipnet',
    durationSeconds: 46,
    sourceTxHash: '0xmocka1b2c3d4e5f615',
    targetTxHash: 'mockbcha1b2c3d4e5f615',
    isMock: true,
  },
  {
    id: 'mock-16',
    timestampSeconds: 1731613000,
    fromToken: 'USDC',
    fromAmount: 40.0,
    fromChain: 'Arbitrum Sepolia',
    toToken: 'tPUSD',
    toAmount: 39.79,
    toChain: 'Bitcoin Cash Chipnet',
    durationSeconds: 34,
    sourceTxHash: '0xmocka1b2c3d4e5f616',
    targetTxHash: 'mockbcha1b2c3d4e5f616',
    isMock: true,
  },
  {
    id: 'mock-17',
    timestampSeconds: 1731609000,
    fromToken: 'tPUSD',
    fromAmount: 60.0,
    fromChain: 'Bitcoin Cash Chipnet',
    toToken: 'USDC',
    toAmount: 59.71,
    toChain: 'Base Sepolia',
    durationSeconds: 38,
    sourceTxHash: 'mockbcha1b2c3d4e5f617',
    targetTxHash: '0xmocka1b2c3d4e5f617',
    isMock: true,
  },
  {
    id: 'mock-18',
    timestampSeconds: 1731605000,
    fromToken: 'USDC',
    fromAmount: 7.0,
    fromChain: 'Base Sepolia',
    toToken: 'tPUSD',
    toAmount: 6.92,
    toChain: 'Bitcoin Cash Chipnet',
    durationSeconds: 42,
    sourceTxHash: '0xmocka1b2c3d4e5f618',
    targetTxHash: 'mockbcha1b2c3d4e5f618',
    isMock: true,
  },
  {
    id: 'mock-19',
    timestampSeconds: 1731601000,
    fromToken: 'USDT',
    fromAmount: 11.0,
    fromChain: 'BSC Testnet',
    toToken: 'tMUSD',
    toAmount: 10.91,
    toChain: 'Bitcoin Cash Chipnet',
    durationSeconds: 45,
    sourceTxHash: '0xmocka1b2c3d4e5f619',
    targetTxHash: 'mockbcha1b2c3d4e5f619',
    isMock: true,
  },
  {
    id: 'mock-20',
    timestampSeconds: 1731597000,
    fromToken: 'tMUSD',
    fromAmount: 25.0,
    fromChain: 'Bitcoin Cash Chipnet',
    toToken: 'USDT',
    toAmount: 24.85,
    toChain: 'BNB Smart Chain Testnet',
    durationSeconds: 43,
    sourceTxHash: 'mockbcha1b2c3d4e5f620',
    targetTxHash: '0xmocka1b2c3d4e5f620',
    isMock: true,
  },
  {
    id: 'mock-21',
    timestampSeconds: 1731593000,
    fromToken: 'USDC',
    fromAmount: 17.0,
    fromChain: 'Ethereum Sepolia',
    toToken: 'tPUSD',
    toAmount: 16.88,
    toChain: 'Bitcoin Cash Chipnet',
    durationSeconds: 48,
    sourceTxHash: '0xmocka1b2c3d4e5f621',
    targetTxHash: 'mockbcha1b2c3d4e5f621',
    isMock: true,
  },
  {
    id: 'mock-22',
    timestampSeconds: 1731589000,
    fromToken: 'USDT',
    fromAmount: 21.0,
    fromChain: 'BNB Smart Chain Testnet',
    toToken: 'tMUSD',
    toAmount: 20.86,
    toChain: 'Bitcoin Cash Chipnet',
    durationSeconds: 45,
    sourceTxHash: '0xmocka1b2c3d4e5f622',
    targetTxHash: 'mockbcha1b2c3d4e5f622',
    isMock: true,
  },
  {
    id: 'mock-23',
    timestampSeconds: 1731585000,
    fromToken: 'USDC',
    fromAmount: 28.0,
    fromChain: 'Base Sepolia',
    toToken: 'tPUSD',
    toAmount: 27.84,
    toChain: 'Bitcoin Cash Chipnet',
    durationSeconds: 39,
    sourceTxHash: '0xmocka1b2c3d4e5f623',
    targetTxHash: 'mockbcha1b2c3d4e5f623',
    isMock: true,
  },
  {
    id: 'mock-24',
    timestampSeconds: 1731581000,
    fromToken: 'tPUSD',
    fromAmount: 45.0,
    fromChain: 'Bitcoin Cash Chipnet',
    toToken: 'USDC',
    toAmount: 44.77,
    toChain: 'Arbitrum Sepolia',
    durationSeconds: 41,
    sourceTxHash: 'mockbcha1b2c3d4e5f624',
    targetTxHash: '0xmocka1b2c3d4e5f624',
    isMock: true,
  },
  {
    id: 'mock-25',
    timestampSeconds: 1731577000,
    fromToken: 'USDC',
    fromAmount: 9.0,
    fromChain: 'Base Sepolia',
    toToken: 'tPUSD',
    toAmount: 8.91,
    toChain: 'Bitcoin Cash Chipnet',
    durationSeconds: 37,
    sourceTxHash: '0xmocka1b2c3d4e5f625',
    targetTxHash: 'mockbcha1b2c3d4e5f625',
    isMock: true,
  },
];

export class MockSolverClient implements SolverClient {
  private readonly emptyStats: boolean;
  private readonly orders: Map<string, SwapOrder> = new Map();
  private mockRefusal?: QuoteRefusal | undefined;
  private readonly fetchFn: (
    input: string | URL | Request,
    init?: RequestInit,
  ) => Promise<Response>;

  constructor(options?: {
    emptyStats?: boolean;
    mockRefusal?: QuoteRefusal | undefined;
    fetch?: (
      input: string | URL | Request,
      init?: RequestInit,
    ) => Promise<Response>;
  }) {
    this.emptyStats = options?.emptyStats ?? true; // Honest empty stats by default
    this.mockRefusal = options?.mockRefusal;
    this.fetchFn = options?.fetch ?? defaultMockServer.fetch;
  }

  private getPrimarySolverUrl(): string {
    const envUrls = import.meta.env?.VITE_SOLVER_URLS as string | undefined;
    if (envUrls && envUrls.trim()) {
      return envUrls.split(',')[0]!.trim();
    }
    return 'https://mock-solver-alpha.local';
  }

  setMockRefusal(refusal: QuoteRefusal | undefined): void {
    this.mockRefusal = refusal;
  }

  isLive(): boolean {
    return false;
  }

  getLabel(): string {
    return 'Mock interface, no funds move';
  }

  async getHealth(): Promise<SolverHealthResponse> {
    try {
      const solverUrl = this.getPrimarySolverUrl();
      const res = await this.fetchFn(`${solverUrl}/v1/health`);
      if (res.ok) {
        const data = await res.json();
        return data as SolverHealthResponse;
      }
    } catch {
      // Fallback to local mock state
    }
    return {
      ok: true,
      quotingEnabled: true,
      timestamp: Math.floor(Date.now() / 1000),
    };
  }

  async getOperatorRoutes(
    token: string,
  ): Promise<readonly OperatorRouteInfo[]> {
    try {
      const solverUrl = this.getPrimarySolverUrl();
      const res = await this.fetchFn(`${solverUrl}/v1/operator/routes`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (res.ok) {
        const data = await res.json();
        return Array.isArray(data.routes) ? data.routes : [];
      }
    } catch {
      // Fallback
    }
    return [
      {
        route: 'base:USDC->bch:PUSD',
        enabled: true,
        availableUsd: 5000,
        skewBps: 20,
        lastError: null,
      },
      {
        route: 'bch:PUSD->base:USDC',
        enabled: true,
        availableUsd: 5000,
        skewBps: -20,
        lastError: null,
      },
    ];
  }

  async getLiquidity(): Promise<LiquidityResponse> {
    const now = Math.floor(Date.now() / 1000);
    return {
      routes: [
        {
          route: 'base:USDC->PUSD',
          asset: 'PUSD',
          decimals: 2,
          available: '500000', // 5,000.00 PUSD
          inventory: '600000',
          exposure: '50000',
          reserved: '50000',
        },
        {
          route: 'bch:PUSD->USDC',
          asset: 'USDC',
          decimals: 6,
          available: '5000000000', // 5,000.00 USDC
          inventory: '6000000000',
          exposure: '500000000',
          reserved: '500000000',
        },
        {
          route: 'base:USDC->MUSD',
          asset: 'MUSD',
          decimals: 2,
          available: '250000', // 2,500.00 MUSD
          inventory: '300000',
          exposure: '25000',
          reserved: '25000',
        },
      ],
      asOf: now,
    };
  }

  async getQuote(req: QuoteRequest): Promise<QuoteResponse> {
    const spreadMultiplier = 1 - SPREAD_BPS / 10_000;
    const gross = req.fromAmount * spreadMultiplier;
    const net = Math.max(0, gross - FIXED_FEE_USD);
    let toAmount = Number(net.toFixed(2));
    const exchangeRate =
      req.fromAmount > 0 ? Number((toAmount / req.fromAmount).toFixed(4)) : 1;
    const estimatedSeconds = req.lane === 'fast' ? 45 : 600;

    // Check custom mock refusal or liquidity limits
    let refusal: QuoteRefusal | undefined = this.mockRefusal;
    if (!refusal) {
      if (req.fromAmount > 10000) {
        refusal = {
          reason: 'OVER_MAX_SWAP',
          maxAmount: '10000.00',
          asset: req.toToken,
          message: `Swap exceeds the 10000.00 ${req.toToken} maximum; try 10000.00 or less`,
        };
      } else if (req.fromAmount > 5000) {
        refusal = {
          reason: 'INSUFFICIENT_LIQUIDITY',
          maxAmount: '5000.00',
          asset: req.toToken,
          message: `Only 5000.00 ${req.toToken} available; try 5000.00 or less`,
        };
      }
    }

    // Direction and token mapping
    const isForward =
      req.fromToken.toUpperCase().includes('USD') &&
      !req.fromToken.toUpperCase().includes('PUSD') &&
      !req.fromToken.toUpperCase().includes('MUSD');
    const direction: 'EVM_TO_BCH' | 'BCH_TO_EVM' = isForward
      ? 'EVM_TO_BCH'
      : 'BCH_TO_EVM';
    const bchToken: 'PUSD' | 'MUSD' =
      req.toToken.toUpperCase().includes('MUSD') ||
      req.fromToken.toUpperCase().includes('MUSD')
        ? 'MUSD'
        : 'PUSD';

    const now = Math.floor(Date.now() / 1000);
    const pricing: PricingEvidence = {
      refs: [
        {
          asset: bchToken,
          usdPrice: bchToken === 'PUSD' ? '0.998' : '1.000',
          source: 'Cauldron',
          asOf: now,
        },
        {
          asset: 'USDC',
          usdPrice: '1.000',
          source: 'Chainlink',
          asOf: now,
        },
      ],
      spreadBps: SPREAD_BPS,
      fixedFeeBase: 0n,
      rounding: 'floor',
    };

    const evmAmount =
      direction === 'EVM_TO_BCH'
        ? BigInt(Math.max(1, Math.round(req.fromAmount * 1_000_000)))
        : quoteOut(
            BigInt(Math.max(1, Math.round(req.fromAmount * 100))),
            2,
            6,
            pricing,
          );

    const bchAmount =
      direction === 'EVM_TO_BCH'
        ? quoteOut(evmAmount, 6, 2, pricing)
        : BigInt(Math.max(1, Math.round(req.fromAmount * 100)));

    toAmount =
      direction === 'EVM_TO_BCH'
        ? Number(bchAmount) / 100
        : Number(evmAmount) / 1_000_000;

    const userEvm =
      req.userAddress && /^0x[0-9a-fA-F]{40}$/.test(req.userAddress)
        ? (req.userAddress.toLowerCase() as Hex)
        : ('0x1111111111111111111111111111111111111111' as Hex);

    const terms: OrderTerms = {
      version: 1,
      direction,
      bchToken,
      bchTokenCategory:
        '0x0000000000000000000000000000000000000000000000000000000000000001' as Hex32,
      bchTokenAmount: bchAmount,
      evmAmount,
      evmToken: '0x036cbd53842c5426634e7929541ec2318f3dcf7e' as Hex,
      evmChainId: 84532,
      evmHtlc: '0x2222222222222222222222222222222222222222' as Hex,
      userEvmAddress: userEvm,
      userBchLockingBytecode:
        '0x76a914111111111111111111111111111111111111111188ac' as Hex,
      solverEvmAddress: mockSolverAccount.address,
      solverBchLockingBytecode:
        '0x76a914222222222222222222222222222222222222222288ac' as Hex,
      hashLock:
        '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef' as Hex32,
      evmDeadline:
        direction === 'EVM_TO_BCH' ? now + 24 * 3600 : now + 6 * 3600,
      bchRefundHeight: direction === 'EVM_TO_BCH' ? 170000 + 36 : 170000 + 108,
      bchCarrySats: 2000n,
      bchMaxFee: 1000n,
      quoteId: `quote-${now}`,
      quoteExpiry: now + 300,
      pricing,
    };

    const id = computeOrderId(terms);
    const signature = await signOrderId(id, mockSolverAccount);

    const signedQuote: SignedQuote = {
      orderId: id,
      terms,
      signature,
      signerAddress: mockSolverAccount.address,
    };

    const formattedPricingEvidence = formatPricingEvidence(pricing);

    const quoteRes: QuoteResponse = {
      fromToken: req.fromToken,
      toToken: req.toToken,
      fromAmount: req.fromAmount,
      toAmount,
      exchangeRate,
      spreadBps: SPREAD_BPS,
      estimatedSeconds,
      expiresInSeconds: 60,
      signedQuote,
      formattedPricingEvidence,
      ...(refusal ? { refusal } : {}),
    };

    return quoteRes;
  }

  async getQuoteWithResult(req: QuoteRequest): Promise<QuoteResult> {
    const quote = await this.getQuote(req);
    if (quote.refusal) {
      return { ok: false, refusal: quote.refusal };
    }
    return { ok: true, quote };
  }

  async createOrder(
    quote: SignedQuote,
    userAddress?: string,
  ): Promise<SwapOrder> {
    const terms = quote.terms;
    const now = Math.floor(Date.now() / 1000);
    const fromAmount =
      terms.direction === 'EVM_TO_BCH'
        ? Number(terms.evmAmount) / 1_000_000
        : Number(terms.bchTokenAmount) / 100;
    const toAmount =
      terms.direction === 'EVM_TO_BCH'
        ? Number(terms.bchTokenAmount) / 100
        : Number(terms.evmAmount) / 1_000_000;

    const fromToken =
      terms.direction === 'EVM_TO_BCH' ? 'USDC' : terms.bchToken;
    const toToken = terms.direction === 'EVM_TO_BCH' ? terms.bchToken : 'USDC';

    const order: SwapOrder = {
      id: quote.orderId,
      mode: 'swap',
      status: 'USER_LOCK_SEEN',
      lane: 'fast',
      fromToken,
      toToken,
      fromAmount,
      toAmount,
      fromChain:
        terms.direction === 'EVM_TO_BCH'
          ? 'Base Sepolia'
          : 'Bitcoin Cash Chipnet',
      toChain:
        terms.direction === 'EVM_TO_BCH'
          ? 'Bitcoin Cash Chipnet'
          : 'Base Sepolia',
      userAddress: userAddress || terms.userEvmAddress,
      recipientAddress: terms.userBchLockingBytecode,
      solverAddress: terms.solverEvmAddress,
      currentConfirmations: 0,
      requiredConfirmations: 1,
      estimatedSecondsRemaining: 45,
      elapsedSeconds: 5,
      waitDescription:
        terms.direction === 'EVM_TO_BCH'
          ? 'Waiting for user lock confirmation on Base Sepolia…'
          : 'Waiting for user lock confirmation on Bitcoin Cash…',
      transactions: [
        {
          id: 'user-lock-tx',
          label: 'User Lock Transaction',
          actor: 'user',
          chainName:
            terms.direction === 'EVM_TO_BCH'
              ? 'Base Sepolia'
              : 'Bitcoin Cash Chipnet',
          hash: '0xmocklocktx' + quote.orderId.slice(2, 10),
          isMock: true,
        },
      ],
      createdAtSeconds: now,
      updatedAtSeconds: now,
      isMock: true,
      signedQuote: quote,
    };

    this.orders.set(quote.orderId, order);
    return order;
  }

  async submitLock(orderId: string, txHash: string): Promise<SwapOrder> {
    const existing = await this.getOrder(orderId);
    if (!existing) {
      throw new Error(`Order ${orderId} not found`);
    }
    const updated: SwapOrder = {
      ...existing,
      status: 'SOLVER_LOCK_SEEN',
      waitDescription: 'Waiting for solver counter-lock on target chain…',
      transactions: [
        ...existing.transactions,
        {
          id: 'user-broadcast-tx',
          label: 'User Lock Confirmed',
          actor: 'user',
          chainName: existing.fromChain,
          hash: txHash,
          isMock: true,
        },
      ],
      updatedAtSeconds: Math.floor(Date.now() / 1000),
    };
    this.orders.set(orderId, updated);
    return updated;
  }

  async getStats(): Promise<SolverStats> {
    if (this.emptyStats) {
      return {
        completedSwaps: 0,
        totalVolumeUsd: 0,
        medianSecondsFast: 0,
        isHonestEmpty: true,
      };
    }

    try {
      const solverUrl = this.getPrimarySolverUrl();
      const res = await this.fetchFn(`${solverUrl}/v1/stats`);
      if (res.ok) {
        const stats = await res.json();
        const completedSwaps = Number(stats.completedSwaps ?? 0);
        return {
          completedSwaps,
          totalVolumeUsd: parseFloat(stats.totalVolumeUsd ?? '0') || 0,
          medianSecondsFast: Number(stats.medianFastSeconds ?? 0),
          isHonestEmpty: completedSwaps === 0,
        };
      }
    } catch {
      // Fallback to sample stats
    }

    return {
      completedSwaps: SAMPLE_MOCK_SWAPS.length,
      totalVolumeUsd: 486.0,
      medianSecondsFast: 41,
      isHonestEmpty: false,
    };
  }

  async getRecentSwaps(
    page: number = 1,
    pageSize: number = 10,
  ): Promise<PaginatedRecentSwaps> {
    try {
      const solverUrl = this.getPrimarySolverUrl();
      if (!solverUrl.includes('.local')) {
        const res = await this.fetchFn(`${solverUrl}/v1/orders/recent`);
        if (res.ok) {
          const data = await res.json();
          const orders = Array.isArray(data.orders) ? data.orders : [];
          if (orders.length === 0) {
            return {
              items: [],
              page: 1,
              pageSize,
              totalCount: 0,
              totalPages: 1,
            };
          }
          const totalCount = orders.length;
          const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
          const clampedPage = Math.min(Math.max(1, page), totalPages);
          const startIndex = (clampedPage - 1) * pageSize;
          const pagedOrders = (
            orders as Array<{
              orderId: string;
              settledAt: number;
              direction: string;
              bchToken: string;
              evmAmount: string | number;
              bchTokenAmount: string | number;
              durationSeconds: number;
            }>
          ).slice(startIndex, startIndex + pageSize);
          const items: RecentSwap[] = pagedOrders.map((o) => ({
            id: o.orderId,
            timestampSeconds: o.settledAt,
            fromToken: o.direction === 'EVM_TO_BCH' ? 'USDC' : o.bchToken,
            fromAmount:
              Number(o.evmAmount) /
              (o.direction === 'EVM_TO_BCH' ? 1_000_000 : 100),
            fromChain:
              o.direction === 'EVM_TO_BCH'
                ? 'Base Sepolia'
                : 'Bitcoin Cash Chipnet',
            toToken: o.direction === 'EVM_TO_BCH' ? o.bchToken : 'USDC',
            toAmount:
              Number(o.bchTokenAmount) /
              (o.direction === 'EVM_TO_BCH' ? 100 : 1_000_000),
            toChain:
              o.direction === 'EVM_TO_BCH'
                ? 'Bitcoin Cash Chipnet'
                : 'Base Sepolia',
            durationSeconds: o.durationSeconds,
            sourceTxHash: '0x' + o.orderId.slice(2, 18),
            targetTxHash: 'mockbch' + o.orderId.slice(2, 14),
            isMock: false,
          }));
          return {
            items,
            page: clampedPage,
            pageSize,
            totalCount,
            totalPages,
          };
        }
      }
    } catch {
      // Fallback
    }

    const validPage = Math.max(1, page);
    const totalCount = SAMPLE_MOCK_SWAPS.length;
    const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
    const clampedPage = Math.min(validPage, totalPages);
    const startIndex = (clampedPage - 1) * pageSize;
    const items = SAMPLE_MOCK_SWAPS.slice(startIndex, startIndex + pageSize);

    return {
      items,
      page: clampedPage,
      pageSize,
      totalCount,
      totalPages,
    };
  }

  async getPegPrices(): Promise<readonly PegPrice[]> {
    try {
      const solverUrl = this.getPrimarySolverUrl();
      const res = await this.fetchFn(`${solverUrl}/v1/pegs`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.tokens) && data.tokens.length > 0) {
          type SolverPegToken = {
            asset: string;
            currentUsdPrice?: string;
            points?: Array<{ usdPrice?: string }>;
          };
          return (data.tokens as SolverPegToken[]).map((t) => ({
            symbol: t.asset,
            priceUsd: parseFloat(t.currentUsdPrice ?? '1.0'),
            change24hPercent: 0,
            sparkline: Array.isArray(t.points)
              ? t.points.map((p) => parseFloat(p.usdPrice ?? '1.0'))
              : [1.0, 1.0],
          }));
        }
      }
    } catch {
      // Fallback
    }

    const now = Math.floor(Date.now() / 1000);
    return [
      {
        symbol: 'tPUSD',
        priceUsd: 1.0,
        change24hPercent: 0.02,
        sparkline: [1.001, 0.999, 1.0, 1.002, 1.0, 0.998, 1.0],
        source: 'Cauldron DEX spot',
        asOf: now,
      },
      {
        symbol: 'tMUSD',
        priceUsd: 1.0,
        change24hPercent: -0.01,
        sparkline: [0.999, 1.0, 1.001, 1.0, 0.999, 1.0, 1.0],
        source: 'Cauldron DEX spot',
        asOf: now,
      },
    ];
  }

  async getSendLink(id: string): Promise<SendLinkView | null> {
    // Links made in this browser (the solver does not hold them in mock mode).
    const link = loadSendLink(id);
    if (!link) return null;
    const expired = link.expiresAt * 1000 < Date.now();
    return {
      id: link.id,
      status:
        link.status === 'claimed'
          ? 'claimed'
          : link.status === 'cancelled'
            ? 'cancelled'
            : expired
              ? 'expired'
              : 'open',
      amount: link.amount,
      token: link.destinationToken,
      chain: link.destinationChain,
      recipientEvmAddress: link.recipientEvmAddress,
      expiresAt: link.expiresAt,
      note: link.note,
    };
  }

  async switchSendLinkRoute(
    id: string,
    request: SwitchSendLinkRouteRequest,
  ): Promise<SwitchSendLinkRouteResponse> {
    const link = loadSendLink(id);
    const now = Math.floor(Date.now() / 1000);
    return {
      ok: true,
      originalOrderId: (id.startsWith('0x') ? id : `0x${id}`) as `0x${string}`,
      newOrderId: (id.startsWith('0x') ? id : `0x${id}`) as `0x${string}`,
      chainId: request.chainId,
      token: request.token,
      evmAmount: 1_000_000n,
      expiresAt: link?.expiresAt ?? now + 86400,
      updatedAt: now,
    };
  }

  async getOrder(orderId: string): Promise<SwapOrder | null> {
    if (orderId === 'not-found') {
      return null;
    }

    if (this.orders.has(orderId)) {
      return this.orders.get(orderId)!;
    }

    const mode: 'swap' | 'pay-link' | 'send-link' = orderId.includes('paylink')
      ? 'pay-link'
      : orderId.includes('sendlink')
        ? 'send-link'
        : 'swap';

    let status: OrderStatus = 'DONE';
    let waitDescription = 'Swap completed successfully.';
    let currentConfirmations = 1;
    const requiredConfirmations = 1;
    let estimatedSecondsRemaining = 0;
    let elapsedSeconds = 42;

    const transactions: OrderTransaction[] = [];

    if (orderId.includes('quoted')) {
      status = 'QUOTED';
      waitDescription = 'Waiting for user lock transaction signature...';
      currentConfirmations = 0;
      estimatedSecondsRemaining = 60;
      elapsedSeconds = 5;
    } else if (orderId.includes('lock-seen')) {
      status = 'USER_LOCK_SEEN';
      waitDescription =
        'Waiting for block confirmation (0 of 1 confirmations)...';
      currentConfirmations = 0;
      estimatedSecondsRemaining = 45;
      elapsedSeconds = 15;
      transactions.push({
        id: 'tx-user-lock',
        label: 'User Lock Transaction',
        actor: 'user',
        chainName: 'Base Sepolia',
        hash: '0xmocklock1111111111111111111111111111111111111111111111111111111111',
        isMock: true,
      });
    } else if (orderId.includes('solver-lock')) {
      status = 'USER_LOCK_FINAL';
      waitDescription = 'Waiting for solver counter-lock transaction...';
      currentConfirmations = 1;
      estimatedSecondsRemaining = 30;
      elapsedSeconds = 30;
      transactions.push({
        id: 'tx-user-lock',
        label: 'User Lock Transaction',
        actor: 'user',
        chainName: 'Base Sepolia',
        hash: '0xmocklock1111111111111111111111111111111111111111111111111111111111',
        isMock: true,
      });
    } else if (orderId.includes('claim')) {
      status = 'SOLVER_LOCK_FINAL';
      waitDescription = 'Waiting for user claim submission...';
      currentConfirmations = 1;
      estimatedSecondsRemaining = 15;
      elapsedSeconds = 45;
      transactions.push(
        {
          id: 'tx-user-lock',
          label: 'User Lock Transaction',
          actor: 'user',
          chainName: 'Base Sepolia',
          hash: '0xmocklock1111111111111111111111111111111111111111111111111111111111',
          isMock: true,
        },
        {
          id: 'tx-solver-lock',
          label: 'Solver Counter-Lock',
          actor: 'solver',
          chainName: 'Bitcoin Cash Chipnet',
          hash: 'mockbchasolverlock22222222222222222222222222222222222222222222222222',
          isMock: true,
        },
      );
    } else if (orderId.includes('refunded')) {
      status = 'REFUNDED';
      waitDescription = 'Order refunded to sender after expiry deadline.';
      currentConfirmations = 1;
      estimatedSecondsRemaining = 0;
      elapsedSeconds = 120;
      transactions.push({
        id: 'tx-user-refund',
        label: 'User Refund Transaction',
        actor: 'user',
        chainName: 'Base Sepolia',
        hash: '0xmockrefund33333333333333333333333333333333333333333333333333333333',
        isMock: true,
      });
    } else {
      // Completed (DONE)
      transactions.push(
        {
          id: 'tx-user-lock',
          label: 'User Lock Transaction',
          actor: 'user',
          chainName: 'Base Sepolia',
          hash: '0xmocklock1111111111111111111111111111111111111111111111111111111111',
          isMock: true,
        },
        {
          id: 'tx-solver-lock',
          label: 'Solver Counter-Lock',
          actor: 'solver',
          chainName: 'Bitcoin Cash Chipnet',
          hash: 'mockbchasolverlock22222222222222222222222222222222222222222222222222',
          isMock: true,
        },
        {
          id: 'tx-user-claim',
          label: 'User Claim Transaction',
          actor: 'user',
          chainName: 'Bitcoin Cash Chipnet',
          hash: 'mockbchclaim33333333333333333333333333333333333333333333333333333333',
          isMock: true,
        },
      );
    }

    const now = Math.floor(Date.now() / 1000);
    return {
      id: orderId,
      mode,
      status,
      lane: 'fast',
      fromToken: 'USDC',
      toToken: 'tPUSD',
      fromAmount: 20.0,
      toAmount: 19.87,
      fromChain: 'Base Sepolia',
      toChain: 'Bitcoin Cash Chipnet',
      userAddress: '0x1111222233334444555566667777888899990000',
      recipientAddress: 'bchtest:zqg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zy6fphnwyk',
      solverAddress: '0xsolver111122223333444455556666777788889999',
      currentConfirmations,
      requiredConfirmations,
      estimatedSecondsRemaining,
      elapsedSeconds,
      waitDescription,
      transactions,
      createdAtSeconds: now - elapsedSeconds,
      updatedAtSeconds: now,
      isMock: true,
    };
  }
}
