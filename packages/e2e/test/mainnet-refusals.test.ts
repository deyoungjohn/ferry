import { describe, expect, it } from 'vitest';
import { sha256 } from 'viem';
import {
  ActivityReadUnavailableError,
  loadChainConfig,
  selectActivityLogEndpoint,
  type ChainFactView,
} from '@ferry/chain-config';
import { EvmChainAdapter, fetchLogsChunked } from '@ferry/chain-evm';
import {
  MockPriceSource,
  SolverDatabase,
  SolverEngine,
  buildServer,
  loadConfigFromEnv,
  runPreflightCheck,
  type BchChainPort,
  type BchQuorumClient,
  type EvmChainPort,
} from '@ferry/solver';

const VALID_MAINNET_ENV: Record<string, string> = {
  NETWORK: 'mainnet',
  OPERATOR_TOKEN: `op_prod_${'a'.repeat(32)}`,
  BCH_ELECTRUM_URLS:
    'wss://blackie.c3-soft.com:50004,wss://bch.imaginary.cash:50004',
  SOLVER_EVM_PRIVATE_KEY: `0x${'ab'.repeat(32)}`,
  // Dummy mainnet-format WIF (never funded or broadcast)
  SOLVER_BCH_WIF: 'L1aW4aubDFB7yfras2S1mN3bqg9nwySY8nkoLmJebSLD5BWv3ENZ',
  BASE_FERRY_HTLC_ADDRESS: '0x8b968625F983420B571C102eC0b57F7e509c916e',
  BASE_USDC_ADDRESS: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  BASE_CHAIN_ID: '8453',
  BASE_RPC_URL: 'https://mainnet.base.org',
};

function makeStubHarness(
  config: ReturnType<typeof loadConfigFromEnv>,
  priceSource: MockPriceSource,
) {
  const bchPort: BchChainPort = {
    isQuorumHealthy: () => true,
    isQuotingEnabled: () => true,
    getTip: async () => ({ height: 870_000, hash: '00'.repeat(32) }),
    broadcast: async (txHex) => txHex,
    isOnChain: async () => true,
    getScriptHashHistory: async () => [],
  };
  const bchClient = {
    ...bchPort,
    getQuorumStatus: () => ({
      quorumTip: 870_000,
      tips: {
        'wss://blackie.c3-soft.com:50004': 870_000,
        'wss://bch.imaginary.cash:50004': 870_000,
      },
      isQuorumHealthy: true,
      isLivenessHealthy: true,
      ageSeconds: 5,
      lastConfirmedAt: Math.floor(Date.now() / 1000) - 5,
      livenessAgeSeconds: 5,
      healthyServersCount: 2,
      quotingAllowed: true,
      quotingState: 'HEALTHY',
    }),
    waitForDoubleSpendProof: async () => ({ hasProof: false }),
    broadcastTransaction: async (txHex: string) => txHex,
    start: async () => {},
    stop: async () => {},
  } as unknown as BchQuorumClient;

  const evmPort: EvmChainPort = {
    getTip: async () => ({ height: 22_000_000, finalized: true }),
    getLock: async () => ({ status: 'locked' }),
    isFinal: async () => true,
    broadcast: async (txHex) => txHex,
    isOnChain: async () => true,
  };

  const evmAdapter = new EvmChainAdapter({
    config: {
      id: 'base',
      chainId: config.baseChainId,
      htlcAddress: config.baseHtlcAddress as `0x${string}`,
      rpcUrls: [config.baseRpcUrl],
      explorerUrl: 'https://basescan.org',
      nativeGas: 'ETH',
      finality: { fast: 1, safe: 1 },
      relayCostUsd: 0.01,
      assets: [
        {
          symbol: 'USDC',
          address: config.baseUsdcAddress as `0x${string}`,
          decimals: 6,
          permit: true,
        },
      ],
    },
  });

  const db = new SolverDatabase(':memory:');
  const engine = new SolverEngine(db, bchPort, evmPort, config);
  const app = buildServer({
    config,
    db,
    evmAdapter,
    bchClient,
    engine,
    priceSource,
  });

  return {
    app,
    close: async () => {
      await app.close();
      db.close();
    },
  };
}

describe('Mainnet safety refusals', () => {
  it('1. refuses startup with only one Fulcrum host', () => {
    expect(() =>
      loadConfigFromEnv({
        ...VALID_MAINNET_ENV,
        BCH_ELECTRUM_URLS: 'wss://blackie.c3-soft.com:50004',
      }),
    ).toThrow(/at least two distinct electrum hosts/i);
  });

  it('2. refuses startup with a short operator token (<32 chars)', () => {
    expect(() =>
      loadConfigFromEnv({
        ...VALID_MAINNET_ENV,
        OPERATOR_TOKEN: 'too-short',
      }),
    ).toThrow(/operator token.*32/i);
  });

  it('3. refuses startup with a placeholder/dev EVM private key', () => {
    expect(() =>
      loadConfigFromEnv({
        ...VALID_MAINNET_ENV,
        SOLVER_EVM_PRIVATE_KEY:
          '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
      }),
    ).toThrow(/placeholder private key/i);
  });

  it('4. refuses quoting when a route is disabled', async () => {
    const config = loadConfigFromEnv({
      ...VALID_MAINNET_ENV,
      QUOTING_ENABLED: 'false',
    });
    runPreflightCheck(config);

    const now = Math.floor(Date.now() / 1000);
    const priceSource = new MockPriceSource(
      new Map([
        ['usdc', { usdPrice: 1_000_000n, source: 'reference', asOf: now }],
        ['pusd', { usdPrice: 1_000_000n, source: 'reference', asOf: now }],
      ]),
    );
    const harness = makeStubHarness(config, priceSource);
    try {
      const res = await harness.app.inject({
        method: 'POST',
        url: '/v1/quotes',
        payload: {
          direction: 'EVM_TO_BCH',
          token: 'TMUSD',
          chainId: 8453,
          evmToken: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
          amountIn: '5000000',
          userEvmAddress: '0x1111111111111111111111111111111111111111',
          userBchLockingBytecode:
            '0x76a914111111111111111111111111111111111111111188ac',
          hashLock: sha256('0x01'),
          lane: 'safe',
        },
      });
      expect(res.statusCode).toBeGreaterThanOrEqual(400);
      expect(res.statusCode).toBeLessThan(500);
    } finally {
      await harness.close();
    }
  });

  it('5. refuses startup when HTLC address is missing / zero', () => {
    const config = loadConfigFromEnv({
      ...VALID_MAINNET_ENV,
      BASE_FERRY_HTLC_ADDRESS: '0x0000000000000000000000000000000000000000',
    });
    expect(() => runPreflightCheck(config)).toThrow(/BASE_HTLC_ADDRESS/i);
  });

  it('6. refuses quoting when the price feed is stale', async () => {
    const config = loadConfigFromEnv(VALID_MAINNET_ENV);
    runPreflightCheck(config);

    const now = Math.floor(Date.now() / 1000);
    const staleTs = now - 3_600;
    const priceSource = new MockPriceSource(
      new Map([
        ['usdc', { usdPrice: 1_000_000n, source: 'reference', asOf: staleTs }],
        ['pusd', { usdPrice: 1_000_000n, source: 'reference', asOf: staleTs }],
      ]),
    );
    const harness = makeStubHarness(config, priceSource);
    try {
      const res = await harness.app.inject({
        method: 'POST',
        url: '/v1/quotes',
        payload: {
          direction: 'EVM_TO_BCH',
          token: 'PUSD',
          chainId: 8453,
          evmToken: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
          amountIn: '5000000',
          userEvmAddress: '0x1111111111111111111111111111111111111111',
          userBchLockingBytecode:
            '0x76a914111111111111111111111111111111111111111188ac',
          hashLock: sha256('0x02'),
          lane: 'safe',
        },
      });
      expect(res.statusCode).toBe(422);
      expect(res.body).toMatch(/STALE_PRICE|stale/i);
    } finally {
      await harness.close();
    }
  });

  it('7. refuses activity scan on an activity-incapable RPC (10-block cap)', async () => {
    const realArc = loadChainConfig({ network: 'mainnet' }).facts.find(
      (f) => f.id === 'arc',
    )!;
    const arcView: ChainFactView = {
      ...realArc,
      rpcEndpoints: [
        {
          url: realArc.rpcUrls[0]!,
          host: new URL(realArc.rpcUrls[0]!).host,
          source: 'public',
          maxLogRange: 10,
        },
      ],
    };
    expect(() => selectActivityLogEndpoint(arcView)).toThrow(
      ActivityReadUnavailableError,
    );

    await expect(
      fetchLogsChunked(
        {
          getLogs: async () => [],
        } as unknown as Parameters<typeof fetchLogsChunked>[0],
        '0x8b968625F983420B571C102eC0b57F7e509c916e',
        1n,
        1_000_000n,
        { maxRange: 10n },
      ),
    ).rejects.toThrow(/exceeding limit/i);
  });
});
