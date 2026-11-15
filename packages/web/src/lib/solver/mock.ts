import { SPREAD_BPS, FIXED_FEE_USD } from '../config';
import type {
  SolverClient,
  QuoteRequest,
  QuoteResponse,
  SolverStats,
  PaginatedRecentSwaps,
  RecentSwap,
  PegPrice,
} from './types';

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
    fromChain: 'TRON Nile',
    toToken: 'tMUSD',
    toAmount: 14.89,
    toChain: 'Bitcoin Cash Chipnet',
    durationSeconds: 44,
    sourceTxHash: 'mocktrona1b2c3d4e5f604',
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
    fromChain: 'Solana Devnet',
    toToken: 'tPUSD',
    toAmount: 4.93,
    toChain: 'Bitcoin Cash Chipnet',
    durationSeconds: 40,
    sourceTxHash: 'mocksolana1b2c3d4e5f606',
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
    fromAmount: 40.0,
    fromChain: 'Bitcoin Cash Chipnet',
    toToken: 'USDC',
    toAmount: 39.79,
    toChain: 'Solana Devnet',
    durationSeconds: 37,
    sourceTxHash: 'mockbcha1b2c3d4e5f613',
    targetTxHash: 'mocksolana1b2c3d4e5f613',
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
    durationSeconds: 49,
    sourceTxHash: '0xmocka1b2c3d4e5f614',
    targetTxHash: 'mockbcha1b2c3d4e5f614',
    isMock: true,
  },
  {
    id: 'mock-15',
    timestampSeconds: 1731617000,
    fromToken: 'USDT',
    fromChain: 'TRON Nile',
    fromAmount: 19.0,
    toToken: 'tMUSD',
    toAmount: 18.87,
    toChain: 'Bitcoin Cash Chipnet',
    durationSeconds: 46,
    sourceTxHash: 'mocktrona1b2c3d4e5f615',
    targetTxHash: 'mockbcha1b2c3d4e5f615',
    isMock: true,
  },
  {
    id: 'mock-16',
    timestampSeconds: 1731613000,
    fromToken: 'USDC',
    fromAmount: 11.0,
    fromChain: 'Base Sepolia',
    toToken: 'tPUSD',
    toAmount: 10.91,
    toChain: 'Bitcoin Cash Chipnet',
    durationSeconds: 38,
    sourceTxHash: '0xmocka1b2c3d4e5f616',
    targetTxHash: 'mockbcha1b2c3d4e5f616',
    isMock: true,
  },
  {
    id: 'mock-17',
    timestampSeconds: 1731609000,
    fromToken: 'tMUSD',
    fromAmount: 24.0,
    fromChain: 'Bitcoin Cash Chipnet',
    toToken: 'USDT',
    toAmount: 23.85,
    toChain: 'BSC Testnet',
    durationSeconds: 52,
    sourceTxHash: 'mockbcha1b2c3d4e5f617',
    targetTxHash: '0xmocka1b2c3d4e5f617',
    isMock: true,
  },
  {
    id: 'mock-18',
    timestampSeconds: 1731605000,
    fromToken: 'USDC',
    fromAmount: 7.0,
    fromChain: 'Arbitrum Sepolia',
    toToken: 'tPUSD',
    toAmount: 6.92,
    toChain: 'Bitcoin Cash Chipnet',
    durationSeconds: 36,
    sourceTxHash: '0xmocka1b2c3d4e5f618',
    targetTxHash: 'mockbcha1b2c3d4e5f618',
    isMock: true,
  },
  {
    id: 'mock-19',
    timestampSeconds: 1731601000,
    fromToken: 'USDC',
    fromAmount: 32.0,
    fromChain: 'Base Sepolia',
    toToken: 'tPUSD',
    toAmount: 31.82,
    toChain: 'Bitcoin Cash Chipnet',
    durationSeconds: 44,
    sourceTxHash: '0xmocka1b2c3d4e5f619',
    targetTxHash: 'mockbcha1b2c3d4e5f619',
    isMock: true,
  },
  {
    id: 'mock-20',
    timestampSeconds: 1731597000,
    fromToken: 'tPUSD',
    fromAmount: 13.0,
    fromChain: 'Bitcoin Cash Chipnet',
    toToken: 'USDC',
    toAmount: 12.9,
    toChain: 'Solana Devnet',
    durationSeconds: 40,
    sourceTxHash: 'mockbcha1b2c3d4e5f620',
    targetTxHash: 'mocksolana1b2c3d4e5f620',
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
    fromChain: 'TRON Nile',
    toToken: 'tMUSD',
    toAmount: 20.86,
    toChain: 'Bitcoin Cash Chipnet',
    durationSeconds: 45,
    sourceTxHash: 'mocktrona1b2c3d4e5f622',
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

  constructor(options?: { emptyStats?: boolean }) {
    this.emptyStats = options?.emptyStats ?? true; // Honest empty stats by default
  }

  isLive(): boolean {
    return false;
  }

  getLabel(): string {
    return 'Mock interface, no funds move';
  }

  async getQuote(req: QuoteRequest): Promise<QuoteResponse> {
    const spreadMultiplier = 1 - SPREAD_BPS / 10_000;
    const gross = req.fromAmount * spreadMultiplier;
    const net = Math.max(0, gross - FIXED_FEE_USD);
    const toAmount = Number(net.toFixed(2));
    const exchangeRate =
      req.fromAmount > 0 ? Number((toAmount / req.fromAmount).toFixed(4)) : 1;
    const estimatedSeconds = req.lane === 'fast' ? 45 : 600;

    return {
      fromToken: req.fromToken,
      toToken: req.toToken,
      fromAmount: req.fromAmount,
      toAmount,
      exchangeRate,
      spreadBps: SPREAD_BPS,
      estimatedSeconds,
      expiresInSeconds: 60,
    };
  }

  async getStats(): Promise<SolverStats> {
    if (this.emptyStats) {
      // Rule: Never show fake stats as real; an empty state is shown honestly
      return {
        completedSwaps: 0,
        totalVolumeUsd: 0,
        medianSecondsFast: 0,
        isHonestEmpty: true,
      };
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
    return [
      {
        symbol: 'tPUSD',
        priceUsd: 1.0,
        change24hPercent: 0.02,
        sparkline: [1.001, 0.999, 1.0, 1.002, 1.0, 0.998, 1.0],
      },
      {
        symbol: 'tMUSD',
        priceUsd: 1.0,
        change24hPercent: -0.01,
        sparkline: [0.999, 1.0, 1.001, 1.0, 0.999, 1.0, 1.0],
      },
    ];
  }
}
