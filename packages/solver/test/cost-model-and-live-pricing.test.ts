import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sha256 } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  type EvmAssetConfig,
  type Hex32,
  type LockState,
  QuoteRefusalSchema,
  orderTermsFromJson,
} from '@ferry/core';
import type { EvmChainAdapter } from '@ferry/chain-evm';
import { verifyQuote } from '@ferry/solver-client';
import { buildServer } from '../src/api/server.js';
import { SolverDatabase } from '../src/db/database.js';
import { SolverConfigSchema } from '../src/config.js';
import { SolverEngine } from '../src/engine/runner.js';
import type { BchQuorumClient } from '../src/bch/quorum-client.js';
import { MockPriceSource } from '../src/pricing/price-source.js';
import {
  calculateRouteCost,
  applyCostModelToQuote,
  LiveCostModelReader,
  verifyLiveInputs,
  type LiveCostInputs,
  DEFAULT_LIVE_INPUT_LIMITS,
} from '../src/pricing/cost-model.js';
import { InventoryReader } from '../src/pricing/inventory-reader.js';
import { runSelfCheck } from '../src/ops/selfcheck.js';
import { buildActiveRoutes } from '../src/ops/routes-config.js';

function createValidFakeLiveInputs(nowSeconds: number): LiveCostInputs {
  return {
    ethUsd: {
      usdPriceMicros: 1_764_320_000n, // $1,764.32
      source: 'chainlink-base',
      asOf: nowSeconds - 10,
      decimals: 8,
      roundId: '12345',
    },
    bchUsd: {
      usdPriceMicros: 500_000_000n, // $500.00
      source: 'bch-usd-median',
      asOf: nowSeconds - 10,
      components: [
        {
          source: 'coinbase',
          usdPriceMicros: 499_000_000n, // $499.00
          asOf: nowSeconds - 10,
        },
        {
          source: 'kraken',
          usdPriceMicros: 501_000_000n, // $501.00
          asOf: nowSeconds - 10,
        },
      ],
    },
    baseGas: {
      gasPriceWei: 6_000_000n, // 0.006 gwei
      l1FeeWeiPerRelayLock: 2_500_000_000_000n,
      l1FeeWeiPerLock: 2_200_000_000_000n,
      source: 'base-gas-price-oracle',
      asOf: nowSeconds - 5,
    },
    bchFeeRate: {
      relayFeeSatsPerByte: 1,
      estimateFeeSatsPerByte: 1.25,
      effectiveSatsPerByte: 1.25,
      source: 'electrum-quorum',
      asOf: nowSeconds - 15,
    },
  };
}

describe('Live Cost Model and Pricing Engine (B4-11)', () => {
  const solverEvmKey =
    '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' as const;
  const solverAccount = privateKeyToAccount(solverEvmKey);
  const operatorToken = 'test-operator-token-32-chars-long-secret!';

  describe('1. Input Freshness, Validation, and Typed Refusals', () => {
    it('accepts fresh, valid live inputs', () => {
      const now = 1_700_000_000;
      const inputs = createValidFakeLiveInputs(now);
      expect(() =>
        verifyLiveInputs(inputs, DEFAULT_LIVE_INPUT_LIMITS, now),
      ).not.toThrow();
    });

    it('refuses quote with PRICE_UNAVAILABLE when ETH/USD is stale stating age and limit', () => {
      const now = 1_700_000_000;
      const inputs = createValidFakeLiveInputs(now);
      inputs.ethUsd.asOf = now - 1805; // limit is 1800s

      expect(() =>
        verifyLiveInputs(inputs, DEFAULT_LIVE_INPUT_LIMITS, now),
      ).toThrowError(
        /ETH\/USD price .* is stale \(asOf: \d+, age: 1805s, max: 1800s\)/,
      );
    });

    it('refuses quote with PRICE_UNAVAILABLE when ETH/USD is non-positive', () => {
      const now = 1_700_000_000;
      const inputs = createValidFakeLiveInputs(now);
      inputs.ethUsd.usdPriceMicros = 0n;

      expect(() =>
        verifyLiveInputs(inputs, DEFAULT_LIVE_INPUT_LIMITS, now),
      ).toThrowError(/ETH\/USD price .* must be positive/);
    });

    it('refuses quote with PRICE_UNAVAILABLE when BCH/USD is stale stating age and limit', () => {
      const now = 1_700_000_000;
      const inputs = createValidFakeLiveInputs(now);
      inputs.bchUsd.asOf = now - 350; // limit is 300s

      expect(() =>
        verifyLiveInputs(inputs, DEFAULT_LIVE_INPUT_LIMITS, now),
      ).toThrowError(/BCH\/USD price .* is stale/);
    });

    it('refuses quote with PEG_GUARD when public BCH/USD feeds disagree by > configured percent', () => {
      const now = 1_700_000_000;
      const inputs = createValidFakeLiveInputs(now);
      // Coinbase $499, Kraken $540 = ~8% divergence (> 5% default limit)
      inputs.bchUsd.components = [
        {
          source: 'coinbase',
          usdPriceMicros: 499_000_000n,
          asOf: now - 10,
        },
        {
          source: 'kraken',
          usdPriceMicros: 540_000_000n,
          asOf: now - 10,
        },
      ];

      expect(() =>
        verifyLiveInputs(inputs, DEFAULT_LIVE_INPUT_LIMITS, now),
      ).toThrowError(/BCH\/USD source disagreement/);
    });

    it('refuses quote with PRICE_UNAVAILABLE when Base gas is stale stating age and limit', () => {
      const now = 1_700_000_000;
      const inputs = createValidFakeLiveInputs(now);
      inputs.baseGas.asOf = now - 75; // limit is 60s

      expect(() =>
        verifyLiveInputs(inputs, DEFAULT_LIVE_INPUT_LIMITS, now),
      ).toThrowError(/Base gas price .* is stale/);
    });

    it('refuses quote with PRICE_UNAVAILABLE when BCH fee rate is stale stating age and limit', () => {
      const now = 1_700_000_000;
      const inputs = createValidFakeLiveInputs(now);
      inputs.bchFeeRate.asOf = now - 320; // limit is 300s

      expect(() =>
        verifyLiveInputs(inputs, DEFAULT_LIVE_INPUT_LIMITS, now),
      ).toThrowError(/fee rate .* is stale/);
    });

    it('refuses quote when BCH fee rate is below 1 sat/byte minimum', () => {
      const now = 1_700_000_000;
      const inputs = createValidFakeLiveInputs(now);
      inputs.bchFeeRate.effectiveSatsPerByte = 0.5;

      expect(() =>
        verifyLiveInputs(inputs, DEFAULT_LIVE_INPUT_LIMITS, now),
      ).toThrowError(/below relay minimum/);
    });
  });

  describe('2. Route Cost Model and Pricing Choices at $1, $5, and $50', () => {
    it('calculates measured gas units and byte costs accurately for Base routes', () => {
      const now = 1_700_000_000;
      const inputs = createValidFakeLiveInputs(now);

      const fwdCost = calculateRouteCost({
        direction: 'EVM_TO_BCH',
        inputs,
        safetyMarginPercent: 25,
        minMarginUsdMicros: 0n,
      });

      // EVM_TO_BCH: solver executes relayLock on Base (258,429 gas) + pays BCH carry (3,000 sats)
      expect(fwdCost.gasUnits).toBe(258_429n);
      expect(fwdCost.bchTxBytes).toBe(250);
      expect(fwdCost.gasCostUsdMicros).toBeGreaterThan(0n);
      expect(fwdCost.totalCostUsdMicros).toBeGreaterThan(0n);
      const expectedWithMargin = (fwdCost.totalCostUsdMicros * 125n) / 100n;
      expect(fwdCost.costWithMarginUsdMicros).toBe(expectedWithMargin);

      const revCost = calculateRouteCost({
        direction: 'BCH_TO_EVM',
        inputs,
        safetyMarginPercent: 25,
        minMarginUsdMicros: 0n,
      });

      // BCH_TO_EVM: solver executes lock on Base (212,455 gas) + pays BCH carry (3,000 sats)
      expect(revCost.gasUnits).toBe(212_455n);
      expect(revCost.bchTxBytes).toBe(300);
    });

    it('picks cost_model at $1 swap: proportional spread < cost, fixed fee covers cost floor', () => {
      const now = 1_700_000_000;
      const inputs = createValidFakeLiveInputs(now);
      const routeCost = calculateRouteCost({
        direction: 'EVM_TO_BCH',
        inputs,
        safetyMarginPercent: 25,
        minMarginUsdMicros: 0n,
      });

      // $1.00 swap (1_000_000 micros), 40 bps spread = $0.004 (4,000 micros)
      const adj = applyCostModelToQuote({
        amountInUsdMicros: 1_000_000n,
        baseSpreadBps: 40,
        routeCost,
        costModelEnabled: true,
      });

      expect(adj.pricingChoice).toBe('cost_model');
      expect(adj.fixedFeeUsdMicros).toBeGreaterThan(0n);
      expect(adj.totalFeeUsdMicros).toBe(routeCost.costWithMarginUsdMicros);
      expect(adj.solverNetProfitUsdMicros).toBeGreaterThanOrEqual(0n);
    });

    it('picks cost_model at $5 swap when cost floor exceeds spread, or spread when spread exceeds cost', () => {
      const now = 1_700_000_000;
      const inputs = createValidFakeLiveInputs(now);

      // With an added $0.03 minimum margin, required cost is ~$0.05 > $0.02 spread
      const highCost = calculateRouteCost({
        direction: 'EVM_TO_BCH',
        inputs,
        safetyMarginPercent: 25,
        minMarginUsdMicros: 30_000n,
      });

      const adjCostModel = applyCostModelToQuote({
        amountInUsdMicros: 5_000_000n, // $5.00 swap -> 40 bps = $0.02
        baseSpreadBps: 40,
        routeCost: highCost,
        costModelEnabled: true,
      });

      expect(adjCostModel.pricingChoice).toBe('cost_model');
      expect(adjCostModel.fixedFeeUsdMicros).toBeGreaterThan(0n);
      expect(adjCostModel.totalFeeUsdMicros).toBe(
        highCost.requiredFeeUsdMicros,
      );

      // Without min margin, spread ($0.02) covers cost ($0.015)
      const normalCost = calculateRouteCost({
        direction: 'EVM_TO_BCH',
        inputs,
        safetyMarginPercent: 25,
        minMarginUsdMicros: 0n,
      });

      const adjSpread = applyCostModelToQuote({
        amountInUsdMicros: 5_000_000n,
        baseSpreadBps: 40,
        routeCost: normalCost,
        costModelEnabled: true,
      });

      expect(adjSpread.pricingChoice).toBe('spread');
      expect(adjSpread.fixedFeeUsdMicros).toBe(0n);
    });

    it('picks spread at $50 swap: proportional spread exceeds cost, fixed fee is 0', () => {
      const now = 1_700_000_000;
      const inputs = createValidFakeLiveInputs(now);
      const routeCost = calculateRouteCost({
        direction: 'EVM_TO_BCH',
        inputs,
        safetyMarginPercent: 25,
        minMarginUsdMicros: 0n,
      });

      // $50.00 swap (50_000_000 micros), 40 bps spread = $0.20 (200,000 micros)
      const adj = applyCostModelToQuote({
        amountInUsdMicros: 50_000_000n,
        baseSpreadBps: 40,
        routeCost,
        costModelEnabled: true,
      });

      expect(adj.pricingChoice).toBe('spread');
      expect(adj.fixedFeeUsdMicros).toBe(0n);
      expect(adj.totalFeeUsdMicros).toBe(200_000n); // pure 40 bps spread
      expect(adj.solverNetProfitUsdMicros).toBe(
        200_000n - routeCost.totalCostUsdMicros,
      );
      expect(adj.solverNetProfitUsdMicros).toBeGreaterThan(0n);
    });
  });

  describe('3. Quote Endpoint Evidence Round Trip with verifyQuote', () => {
    let db: SolverDatabase;
    let mockPrices: MockPriceSource;
    let fakeBchClient: BchQuorumClient;
    let fakeEvmAdapter: EvmChainAdapter;
    let engine: SolverEngine;

    beforeAll(() => {
      db = new SolverDatabase(':memory:');
      const now = Math.floor(Date.now() / 1000);

      mockPrices = new MockPriceSource();
      mockPrices.setPrice('USDC', {
        usdPrice: 1_000_000n,
        source: 'chainlink',
        asOf: now,
      });
      mockPrices.setPrice('PUSD', {
        usdPrice: 1_000_000n,
        source: 'cauldron',
        asOf: now,
      });
      mockPrices.setPrice('MUSD', {
        usdPrice: 1_000_000n,
        source: 'cauldron',
        asOf: now,
      });

      fakeBchClient = {
        getQuorumStatus: () => ({
          quorumTip: 330000,
          tips: { 'wss://mock1': 330000 },
          isQuorumHealthy: true,
          isLivenessHealthy: true,
          ageSeconds: 5,
          lastConfirmedAt: now - 5,
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
              amount: '10000000', // 100,000 PUSD
            },
          },
        ],
        subscribeScriptHash: async () => {},
        unsubscribeScriptHash: async () => {},
        close: () => {},
      } as unknown as BchQuorumClient;

      const mockAsset: EvmAssetConfig = {
        symbol: 'USDC',
        decimals: 6,
        address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        permit: false,
      };
      const knownLocks = new Map<string, LockState>();
      fakeEvmAdapter = {
        id: 'base',
        address: solverAccount.address,
        getTokenBalance: async () => 100_000_000_000n, // $100,000 USDC
        getNativeBalance: async () => 10_000_000_000_000_000_000n,
        getTip: async () => ({
          height: 1234567,
          ageSeconds: 5,
          stale: false,
        }),
        getLock: async (lockId: string) => {
          return (
            knownLocks.get(lockId.toLowerCase()) ?? {
              status: 'absent' as const,
            }
          );
        },
        isFinal: async () => true,
        relayLock: async () => ({
          chain: 'base' as const,
          txId: ('0x' + 'aa'.repeat(32)) as Hex32,
        }),
        assets: [mockAsset],
      } as unknown as EvmChainAdapter;

      engine = {
        isQuotingEnabled: () => true,
        start: async () => {},
        stop: () => {},
      } as unknown as SolverEngine;
    });

    afterAll(() => {
      db.close();
    });

    it('embeds live cost breakdown in pricing evidence and passes verifyQuote in solver-client', async () => {
      const now = Math.floor(Date.now() / 1000);
      const fakeInputs = createValidFakeLiveInputs(now);
      const costModelReader = new LiveCostModelReader({
        fakeInputs,
        costSafetyPercent: 25,
      });

      const config = SolverConfigSchema.parse({
        solverEvmPrivateKey: solverEvmKey,
        operatorToken,
        network: 'testnet',
        costModelEnabled: true,
      });

      const server = buildServer({
        config,
        db,
        evmAdapter: fakeEvmAdapter,
        bchClient: fakeBchClient,
        engine,
        priceSource: mockPrices,
        costModelReader,
      });
      await server.ready();

      const hashLock = sha256(('0x' + '22'.repeat(32)) as `0x${string}`);
      const quoteRes = await server.inject({
        method: 'POST',
        url: '/v1/quotes',
        payload: {
          direction: 'EVM_TO_BCH',
          bchToken: 'PUSD',
          amountIn: '1000000', // $1.00
          userEvmAddress: '0x87Ea46fe296C1810eF234A8e8D782A2122deFaDd',
          userBchLockingBytecode:
            '0x76a914000000000000000000000000000000000000000088ac',
          hashLock,
          lane: 'safe',
        },
      });

      expect(quoteRes.statusCode).toBe(200);
      const quote = quoteRes.json();

      // Pricing evidence contains cost breakdown
      expect(quote.terms.pricing.costs).toBeDefined();
      const costs = quote.terms.pricing.costs;
      expect(costs.pricingChoice).toBe('cost_model');
      expect(costs.gasUnits).toBe('258429');
      expect(costs.bchTxBytes).toBe(250);
      expect(costs.sources.length).toBe(4);
      expect(costs.sources.map((s: { name: string }) => s.name)).toContain(
        'ETH/USD',
      );
      expect(costs.sources.map((s: { name: string }) => s.name)).toContain(
        'BCH/USD',
      );
      expect(costs.sources.map((s: { source: string }) => s.source)).toContain(
        'chainlink-base',
      );
      expect(costs.sources.map((s: { source: string }) => s.source)).toContain(
        'bch-usd-median',
      );

      // Verify round-trip through @ferry/solver-client verifyQuote
      const verified = await verifyQuote(
        {
          ...quote,
          terms: orderTermsFromJson(quote.terms),
        },
        {
          direction: 'EVM_TO_BCH',
          token: 'PUSD',
          amountIn: 1_000_000n,
          chainId: 84532,
          evmToken: quote.terms.evmToken,
          userEvmAddress: '0x87Ea46fe296C1810eF234A8e8D782A2122deFaDd',
          userBchLockingBytecode:
            '0x76a914000000000000000000000000000000000000000088ac',
          hashLock,
          lane: 'safe',
        },
        {
          bchTipHeight: 330000,
          nowSeconds: now,
          evmTokenDecimals: 6,
          bchTokenDecimals: 2,
        },
      );

      expect(verified.orderId).toBe(quote.orderId);
      expect(verified.terms.pricing.costs).toBeDefined();

      await server.close();
    });

    it('returns 422 with typed QuoteRefusal when live cost model throws LiveCostError', async () => {
      const now = Math.floor(Date.now() / 1000);
      const staleInputs = createValidFakeLiveInputs(now);
      staleInputs.ethUsd.asOf = now - 2000; // Stale

      const costModelReader = new LiveCostModelReader({
        fakeInputs: staleInputs,
      });

      const config = SolverConfigSchema.parse({
        solverEvmPrivateKey: solverEvmKey,
        operatorToken,
        network: 'testnet',
        costModelEnabled: true,
      });

      const server = buildServer({
        config,
        db,
        evmAdapter: fakeEvmAdapter,
        bchClient: fakeBchClient,
        engine,
        priceSource: mockPrices,
        costModelReader,
      });
      await server.ready();

      const hashLock = sha256(('0x' + '33'.repeat(32)) as `0x${string}`);
      const res = await server.inject({
        method: 'POST',
        url: '/v1/quotes',
        payload: {
          direction: 'EVM_TO_BCH',
          bchToken: 'PUSD',
          amountIn: '1000000',
          userEvmAddress: '0x87Ea46fe296C1810eF234A8e8D782A2122deFaDd',
          userBchLockingBytecode:
            '0x76a914000000000000000000000000000000000000000088ac',
          hashLock,
        },
      });

      expect(res.statusCode).toBe(422);
      const refusal = res.json();
      expect(refusal.reason).toBe('PRICE_UNAVAILABLE');
      expect(refusal.message).toContain(
        'ETH/USD price from chainlink-base is stale',
      );
      const parsedRefusal = QuoteRefusalSchema.safeParse(refusal);
      expect(parsedRefusal.success).toBe(true);

      await server.close();
    });
  });

  describe('4. GET /v1/liquidity EVM-side USDC Entries', () => {
    let db: SolverDatabase;
    let mockPrices: MockPriceSource;
    let fakeBchClient: BchQuorumClient;
    let fakeEvmAdapter: EvmChainAdapter;
    let engine: SolverEngine;

    beforeAll(() => {
      db = new SolverDatabase(':memory:');
      const now = Math.floor(Date.now() / 1000);

      mockPrices = new MockPriceSource();
      fakeBchClient = {
        getQuorumStatus: () => ({
          quorumTip: 330000,
          tips: { 'wss://mock1': 330000 },
          isQuorumHealthy: true,
          isLivenessHealthy: true,
          ageSeconds: 5,
          lastConfirmedAt: now - 5,
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
              amount: '500000', // 5,000.00 PUSD
            },
          },
        ],
        subscribeScriptHash: async () => {},
        unsubscribeScriptHash: async () => {},
        close: () => {},
      } as unknown as BchQuorumClient;

      fakeEvmAdapter = {
        id: 'base',
        address: solverAccount.address,
        getTokenBalance: async () => 12_500_000_000n, // $12,500.00 USDC (6 decimals)
        getNativeBalance: async () => 1_000_000_000_000_000_000n,
        getTip: async () => ({ height: 100, ageSeconds: 1, stale: false }),
        isFinal: async () => true,
        assets: [],
      } as unknown as EvmChainAdapter;

      engine = {
        isQuotingEnabled: () => true,
        start: async () => {},
        stop: () => {},
      } as unknown as SolverEngine;
    });

    afterAll(() => {
      db.close();
    });

    it('reports EVM-side USDC liquidity in 6 decimals alongside BCH entries', async () => {
      const config = SolverConfigSchema.parse({
        solverEvmPrivateKey: solverEvmKey,
        operatorToken,
        network: 'testnet',
      });

      const server = buildServer({
        config,
        db,
        evmAdapter: fakeEvmAdapter,
        bchClient: fakeBchClient,
        engine,
        priceSource: mockPrices,
      });
      await server.ready();

      const res = await server.inject({
        method: 'GET',
        url: '/v1/liquidity',
      });

      expect(res.statusCode).toBe(200);
      const data = res.json();

      // Check BCH entries (2 decimals)
      const bchEntry = data.routes.find(
        (r: { route: string }) => r.route === 'base-usdc-to-bch-pusd',
      );
      expect(bchEntry).toBeDefined();
      expect(bchEntry.decimals).toBe(2);
      expect(bchEntry.asset).toBe('PUSD');

      // Check EVM USDC entries (6 decimals)
      const evmEntry = data.routes.find(
        (r: { route: string }) => r.route === 'bch-pusd-to-base-usdc',
      );
      expect(evmEntry).toBeDefined();
      expect(evmEntry.decimals).toBe(6);
      expect(evmEntry.asset).toBe('USDC');
      expect(evmEntry.available).toBe('12500000000');

      await server.close();
    });

    it('omits EVM liquidity entry when inventory read fails rather than reporting 0', async () => {
      const failingEvmAdapter = {
        ...fakeEvmAdapter,
        getTokenBalance: async () => {
          throw new Error('RPC connection failed');
        },
      } as unknown as EvmChainAdapter;

      const config = SolverConfigSchema.parse({
        solverEvmPrivateKey: solverEvmKey,
        operatorToken,
        network: 'testnet',
      });

      const server = buildServer({
        config,
        db,
        evmAdapter: failingEvmAdapter,
        bchClient: fakeBchClient,
        engine,
        priceSource: mockPrices,
      });
      await server.ready();

      const res = await server.inject({
        method: 'GET',
        url: '/v1/liquidity',
      });

      expect(res.statusCode).toBe(200);
      const data = res.json();

      // BCH entry is still present
      const bchEntry = data.routes.find(
        (r: { route: string }) => r.route === 'base-usdc-to-bch-pusd',
      );
      expect(bchEntry).toBeDefined();

      // EVM USDC entry is omitted due to failing read
      const evmEntry = data.routes.find(
        (r: { route: string }) => r.route === 'bch-pusd-to-base-usdc',
      );
      expect(evmEntry).toBeUndefined();

      await server.close();
    });
  });

  describe('5. Extended Selfcheck with Live Cost Model', () => {
    it('prints live inputs, route costs, and $1, $5, $50 economics in selfcheck report', async () => {
      const now = Math.floor(Date.now() / 1000);
      const fakeInputs = createValidFakeLiveInputs(now);
      const costModelReader = new LiveCostModelReader({
        fakeInputs,
        costSafetyPercent: 25,
      });

      const config = SolverConfigSchema.parse({
        solverEvmPrivateKey: solverEvmKey,
        operatorToken,
        network: 'testnet',
        maxSwapUsdMicros: 50_000_000n, // $50 cap for testing
      });

      const db = new SolverDatabase(':memory:');
      const fakeBch = {
        getQuorumStatus: () => ({
          quorumTip: 330000,
          tips: { 'wss://mock1': 330000 },
          isQuorumHealthy: true,
          isLivenessHealthy: true,
          ageSeconds: 5,
          lastConfirmedAt: now - 5,
        }),
        listUnspent: async () => [
          {
            height: 330000,
            tx_hash: '11'.repeat(32),
            tx_pos: 0,
            value: 50000, // 50,000 sats fee balance
            token_data: {
              category:
                'ec335fd3ffa45f80cef7217cf98e8adf562df5a3e33f354f69df2951703586ac',
              amount: '100000000', // 1,000,000 PUSD
            },
          },
        ],
        connect: async () => {},
        subscribeScriptHash: async () => {},
        unsubscribeScriptHash: async () => {},
        close: () => {},
      } as unknown as BchQuorumClient;

      const fakeEvm = {
        id: 'base',
        address: solverAccount.address,
        getTokenBalance: async () => 100_000_000_000n,
        getNativeBalance: async () => 10_000_000_000_000_000_000n,
        getTip: async () => ({ height: 100, ageSeconds: 1, stale: false }),
        isFinal: async () => true,
        assets: [],
      } as unknown as EvmChainAdapter;

      const evmAdapters = new Map<string, EvmChainAdapter>([['base', fakeEvm]]);
      const routesContext = buildActiveRoutes(config);
      const mockPrices = new MockPriceSource();
      mockPrices.setPrice('PUSD', {
        usdPrice: 1_000_000n,
        source: 'cauldron',
        asOf: now,
      });
      mockPrices.setPrice('MUSD', {
        usdPrice: 1_000_000n,
        source: 'cauldron',
        asOf: now,
      });
      mockPrices.setPrice('USDC', {
        usdPrice: 1_000_000n,
        source: 'chainlink',
        asOf: now,
      });

      const reader = new InventoryReader({
        config,
        bchClient: fakeBch,
        evmAdapter: fakeEvm,
        evmAdapters,
        solverEvmAddress: solverAccount.address,
      });

      const report = await runSelfCheck({
        config,
        bchClient: fakeBch,
        inventoryReader: reader,
        priceSource: mockPrices,
        evmAdapters,
        routesContext,
        db,
        costModelReader,
      });

      expect(report.passed).toBe(true);
      expect(report.output).toContain(
        '5. Live Cost Model Inputs & Route Economics:',
      );
      expect(report.output).toContain('ETH/USD:       $1764.320000');
      expect(report.output).toContain('BCH/USD:       $500.000000');
      expect(report.output).toContain('Base Gas:      0.0060 gwei');
      expect(report.output).toContain('BCH Fee Rate:  1.25 sats/byte');
      expect(report.output).toContain('usdc:base (EVM_TO_BCH)');
      expect(report.output).toContain('usdc:base (BCH_TO_EVM)');
      expect(report.output).toContain('$1 swap: fee $0.010888 (cost_model)');
      expect(report.output).toContain('$5 swap: fee $0.020000 (spread)');
      expect(report.output).toContain('$50 swap: fee $0.200000 (spread)');

      db.close();
    });

    it('reports failure in selfcheck when live inputs are stale', async () => {
      const now = Math.floor(Date.now() / 1000);
      const staleInputs = createValidFakeLiveInputs(now);
      staleInputs.ethUsd.asOf = now - 3000; // 3000s stale

      const costModelReader = new LiveCostModelReader({
        fakeInputs: staleInputs,
      });

      const config = SolverConfigSchema.parse({
        solverEvmPrivateKey: solverEvmKey,
        operatorToken,
        network: 'testnet',
      });

      const db = new SolverDatabase(':memory:');
      const fakeBch = {
        getQuorumStatus: () => ({
          quorumTip: 330000,
          tips: { 'wss://mock1': 330000 },
          isQuorumHealthy: true,
          isLivenessHealthy: true,
          ageSeconds: 5,
          lastConfirmedAt: now - 5,
        }),
        listUnspent: async () => [],
        connect: async () => {},
        subscribeScriptHash: async () => {},
        unsubscribeScriptHash: async () => {},
        close: () => {},
      } as unknown as BchQuorumClient;

      const fakeEvm = {
        id: 'base',
        address: solverAccount.address,
        getTokenBalance: async () => 0n,
        getNativeBalance: async () => 0n,
        getTip: async () => ({ height: 100, ageSeconds: 1, stale: false }),
        isFinal: async () => true,
        assets: [],
      } as unknown as EvmChainAdapter;

      const report = await runSelfCheck({
        config,
        bchClient: fakeBch,
        inventoryReader: new InventoryReader({
          config,
          bchClient: fakeBch,
          evmAdapter: fakeEvm,
          solverEvmAddress: solverAccount.address,
        }),
        priceSource: new MockPriceSource(),
        evmAdapters: new Map([['base', fakeEvm]]),
        routesContext: buildActiveRoutes(config),
        db,
        costModelReader,
      });

      expect(report.passed).toBe(false);
      expect(report.output).toContain('[FAIL] Live cost inputs error');
      expect(report.output).toContain(
        'ETH/USD price from chainlink-base is stale',
      );

      db.close();
    });
  });
});
