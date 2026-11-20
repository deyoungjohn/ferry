import { describe, expect, it } from 'vitest';
import {
  PREDICTED_FERRY_HTLC_ADDRESS,
  loadChainConfig,
} from '@ferry/chain-config';
import { buildActiveRoutes } from '../src/ops/routes-config.js';
import { loadConfigFromEnv } from '../src/config.js';
import { RoutePriceSource } from '../src/pricing/composite-source.js';
import { QuoteBuilder } from '../src/pricing/quote-builder.js';
import { LiquidityManager } from '../src/pricing/liquidity.js';
import { calculateRouteCost } from '../src/pricing/cost-model.js';
import { buildServer } from '../src/api/server.js';
import { SolverDatabase } from '../src/db/database.js';
import { MockPriceSource } from '../src/pricing/price-source.js';
import type { EvmChainAdapter } from '@ferry/chain-evm';
import type { BchQuorumClient } from '../src/bch/quorum-client.js';
import type { SolverEngine } from '../src/engine/runner.js';
import { sha256 } from 'viem';

describe('USDG on Robinhood Chain (Route usdg:robinhood)', () => {
  it('enables usdg:robinhood in buildActiveRoutes with verified HTLC and token facts', () => {
    const config = loadConfigFromEnv({
      NETWORK: 'mainnet',
      SOLVER_EVM_PRIVATE_KEY:
        '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      OPERATOR_TOKEN: '12345678901234567890123456789012',
      ENABLED_ROUTES: 'usdg:robinhood',
      FERRY_HTLC_ADDRESS: PREDICTED_FERRY_HTLC_ADDRESS,
    });

    const routesContext = buildActiveRoutes(config, {
      ENABLED_ROUTES: 'usdg:robinhood',
      FERRY_HTLC_ADDRESS: PREDICTED_FERRY_HTLC_ADDRESS,
    });

    const route = routesContext.routes.find((r) => r.key === 'usdg:robinhood');
    expect(route).toBeDefined();
    expect(route?.enabled).toBe(true);
    expect(route?.eligible).toBe(true);
    expect(route?.htlcAddress).toBe(PREDICTED_FERRY_HTLC_ADDRESS);

    const chainFact = routesContext.chainConfig.facts.find(
      (c) => c.id === 'robinhood',
    );
    expect(chainFact?.chainId).toBe(4663);
    const usdg = chainFact?.assets.find((a) => a.symbol === 'USDG');
    expect(usdg).toBeDefined();
    expect(usdg?.address).toBe('0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168');
    expect(usdg?.decimals).toBe(6);
    expect(usdg?.permit).toBe(true);
    expect(usdg?.verified).toBe(true);
  });

  it('prices USDG on Robinhood at 1.00 USD via documented peg assumption', async () => {
    const chainConfig = loadChainConfig({
      network: 'mainnet',
      env: { ENABLED_ROUTES: 'usdg:robinhood' },
    });
    const now = Math.floor(Date.now() / 1000);
    const source = new RoutePriceSource({
      chainConfig,
      nowSeconds: () => now,
    });

    const reading = await source.getPrice('USDG', 'robinhood');
    expect(reading.usdPrice).toBe(1_000_000n); // $1.000000
    expect(reading.source).toBe('usdg-peg-assumption');
  });

  it('refuses USDG when its configured feed fails, instead of assuming $1.00', async () => {
    const chainConfig = loadChainConfig({
      network: 'mainnet',
      env: { ENABLED_ROUTES: 'usdg:robinhood' },
    });
    const now = Math.floor(Date.now() / 1000);
    const source = new RoutePriceSource({
      chainConfig,
      nowSeconds: () => now,
      evmSources: new Map([
        [
          'robinhood',
          {
            getPrice: () => Promise.reject(new Error('feed unreachable')),
          },
        ],
      ]),
    });
    await expect(source.getPrice('USDG', 'robinhood')).rejects.toThrow(
      /feed unreachable/,
    );
  });

  it('refuses USDG when peg deviation exceeds refusal threshold override', async () => {
    const chainConfig = loadChainConfig({
      network: 'mainnet',
      env: { ENABLED_ROUTES: 'usdg:robinhood' },
    });
    const now = Math.floor(Date.now() / 1000);
    const source = new RoutePriceSource({
      chainConfig,
      nowSeconds: () => now,
      usdgPegPriceUsdMicros: 1_030_000n, // $1.03 (3% off peg)
      usdgPegRefusalToleranceUsdMicros: 10_000n, // 1% tolerance
    });

    await expect(source.getPrice('USDG', 'robinhood')).rejects.toThrow(
      /Peg guard refused USDG primary price.*exceeding peg tolerance/,
    );
  });

  it('calculates Robinhood route gas costs with zero L1 fee and ETH gas token', () => {
    const now = Math.floor(Date.now() / 1000);
    const inputs = {
      ethUsd: {
        usdPriceMicros: 3_000_000_000n, // $3,000 / ETH
        source: 'test-eth-usd',
        asOf: now,
        decimals: 8,
      },
      bchUsd: {
        usdPriceMicros: 500_000_000n, // $500 / BCH
        source: 'test-bch-usd',
        asOf: now,
        components: [],
      },
      baseGas: {
        gasPriceWei: 20_000_000_000n, // 20 gwei
        l1FeeWeiPerRelayLock: 500_000_000_000_000n, // Base has L1 fee
        l1FeeWeiPerLock: 300_000_000_000_000n,
        source: 'base-oracle',
        asOf: now,
      },
      bchFeeRate: {
        relayFeeSatsPerByte: 1,
        estimateFeeSatsPerByte: 1,
        effectiveSatsPerByte: 1,
        source: 'test-bch-fee',
        asOf: now,
      },
    };

    // For Robinhood (chainId 4663), L1 fee must be 0
    const rhGasPriceWei = 21_156_000n; // Recent RPC reading ~0.021 Gwei
    const cost = calculateRouteCost({
      direction: 'EVM_TO_BCH',
      chainId: 4663,
      inputs,
      gasPriceWei: rhGasPriceWei,
    });

    expect(cost.l1FeeWei).toBe(0n);
    expect(cost.gasPriceWei).toBe(rhGasPriceWei);
    expect(cost.chainId).toBe(4663);
    expect(cost.gasCostUsdMicros).toBeGreaterThan(0n);
  });

  it('builds a quote on usdg:robinhood through QuoteBuilder', async () => {
    const now = Math.floor(Date.now() / 1000);
    const fakePriceSource = {
      async getPrice() {
        return {
          usdPrice: 1_000_000n, // $1.00 USD
          source: 'usdg-peg-assumption',
          asOf: now,
          heartbeatSeconds: 86400,
        };
      },
    };

    const builder = new QuoteBuilder(fakePriceSource, new LiquidityManager());
    const amountIn = 25_000_000n; // 25.000000 USDG ($25.00)

    const result = await builder.buildQuote({
      quoteId: 'quote-rh-usdg-1',
      direction: 'EVM_TO_BCH',
      payAsset: 'USDG',
      receiveAsset: 'PUSD',
      amountIn,
      inputDecimals: 6,
      outputDecimals: 2,
      fixedFeeUsdMicros: 10_000n, // $0.01 fixed fee
      minSwapUsdMicros: 1_000_000n,
      userAddress: '0x1111111111111111111111111111111111111111',
      userIp: '127.0.0.1',
      currentInventory: 1_000_000_000n,
      openExposure: 0n,
      nowSeconds: now,
      termsTemplate: {
        version: 1,
        bchToken: 'PUSD',
        bchTokenCategory:
          '0xec335fd3ffa45f80cef7217cf98e8adf562df5a3e33f354f69df2951703586ac',
        evmToken: '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168',
        evmChainId: 4663,
        evmHtlc: PREDICTED_FERRY_HTLC_ADDRESS,
        userEvmAddress: '0x1111111111111111111111111111111111111111',
        userBchLockingBytecode:
          '0x76a914111111111111111111111111111111111111111188ac',
        solverEvmAddress: '0x2222222222222222222222222222222222222222',
        solverBchLockingBytecode:
          '0x76a914222222222222222222222222222222222222222288ac',
        hashLock:
          '0x3333333333333333333333333333333333333333333333333333333333333333',
        evmDeadline: now + 3600,
        bchRefundHeight: 1000,
        bchCarrySats: 3000n,
        bchMaxFee: 1500n,
      },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.terms.evmChainId).toBe(4663);
      expect(result.terms.evmToken).toBe(
        '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168',
      );
      // 25 USDG * (1 - 0.004) = $24.90 minus $0.01 fee = 24.89 PUSD = 2489 base units
      expect(result.terms.bchTokenAmount).toBe(2489n);
    }
  });

  it('builds and signs a quote for usdg:robinhood via POST /v1/quotes', async () => {
    const config = loadConfigFromEnv({
      NETWORK: 'mainnet',
      SOLVER_EVM_PRIVATE_KEY:
        '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      OPERATOR_TOKEN: '12345678901234567890123456789012',
      ENABLED_ROUTES: 'usdg:robinhood',
      COST_MODEL_ENABLED: 'false',
      FERRY_HTLC_ADDRESS: PREDICTED_FERRY_HTLC_ADDRESS,
    });

    const db = new SolverDatabase(':memory:');
    const now = Math.floor(Date.now() / 1000);
    const mockPriceSource = new MockPriceSource();
    mockPriceSource.setPrice('USDG', {
      usdPrice: 1_000_000n,
      source: 'usdg-peg-assumption',
      asOf: now,
    });
    mockPriceSource.setPrice('PUSD', {
      usdPrice: 1_000_000n,
      source: 'cauldron',
      asOf: now,
    });

    const app = await buildServer({
      config,
      db,
      routesContext: buildActiveRoutes(config, {
        ENABLED_ROUTES: 'usdg:robinhood',
        FERRY_HTLC_ADDRESS: PREDICTED_FERRY_HTLC_ADDRESS,
      }),
      priceSource: mockPriceSource,
      engine: {
        isQuotingEnabled: () => true,
      } as unknown as SolverEngine,
      evmAdapter: {
        id: 'robinhood',
        address: '0x87Ea46fe296C1810eF234A8e8D782A2122deFaDd',
        getTokenBalance: async () => 100_000_000_000n,
        getNativeBalance: async () => 10_000_000_000_000_000_000n,
        getTip: async () => ({
          height: 1234567,
          ageSeconds: 5,
          stale: false,
        }),
      } as unknown as EvmChainAdapter,
      bchClient: {
        isHealthy: () => true,
        getQuorumStatus: () => ({
          isQuorumHealthy: true,
          quorumTip: 800000,
          liveServers: 2,
          totalServers: 2,
          ageSeconds: 5,
        }),
        listUnspent: async () => [
          {
            height: 330000,
            tx_hash: '11'.repeat(32),
            tx_pos: 0,
            value: 100000,
            token_data: {
              category:
                'ec335fd3ffa45f80cef7217cf98e8adf562df5a3e33f354f69df2951703586ac',
              amount: '100000000',
            },
          },
        ],
      } as unknown as BchQuorumClient,
    });

    const hashLock = sha256(('0x' + '22'.repeat(32)) as `0x${string}`);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/quotes',
      payload: {
        direction: 'EVM_TO_BCH',
        bchToken: 'PUSD',
        amountIn: '25000000', // 25 USDG
        evmChainId: 4663,
        evmToken: '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168',
        userEvmAddress: '0x87Ea46fe296C1810eF234A8e8D782A2122deFaDd',
        userBchLockingBytecode:
          '0x76a914000000000000000000000000000000000000000088ac',
        hashLock,
        lane: 'safe',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.orderId).toBeDefined();
    expect(body.terms.evmChainId).toBe(4663);
    expect(body.terms.evmToken.toLowerCase()).toBe(
      '0x5fc5360d0400a0fd4f2af552add042d716f1d168',
    );
    expect(body.signature).toBeDefined();

    await app.close();
    db.close();
  });
});
