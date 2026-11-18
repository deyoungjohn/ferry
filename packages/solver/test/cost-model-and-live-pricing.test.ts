import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { sha256, type PublicClient } from 'viem';
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
import { buildServer, createSolverServer } from '../src/api/server.js';
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

      // EVM_TO_BCH: solver pays the relayed lock on Base (258,429 gas) and its own Bitcoin Cash lock (300 bytes) plus the carry (3,000 sats)
      expect(fwdCost.gasUnits).toBe(258_429n);
      expect(fwdCost.bchTxBytes).toBe(300);
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

      // BCH_TO_EVM: solver locks on Base (212,455 gas) and claims on Bitcoin Cash (250 bytes); the carry comes back
      expect(revCost.gasUnits).toBe(212_455n);
      expect(revCost.bchTxBytes).toBe(250);
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

      // Without min margin, a $20 swap's spread ($0.08) covers the cost ($0.030)
      const normalCost = calculateRouteCost({
        direction: 'EVM_TO_BCH',
        inputs,
        safetyMarginPercent: 25,
        minMarginUsdMicros: 0n,
      });

      const adjSpread = applyCostModelToQuote({
        amountInUsdMicros: 20_000_000n, // $20 -> 40 bps = $0.08
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
      expect(costs.bchTxBytes).toBe(300);
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
      expect(report.output).toContain('$1 swap: fee $0.030026 (cost_model)');
      expect(report.output).toContain('$5 swap: fee $0.030026 (cost_model)');
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

  describe('6. Multi-RPC Base Fallback & BCH/USD 3-Source Quorum (B4-12)', () => {
    it('falls back to second Base RPC client when first RPC client fails', async () => {
      const now = Math.floor(Date.now() / 1000);
      const failingClient = {
        readContract: vi
          .fn()
          .mockRejectedValue(new Error('RPC 1 ECONNREFUSED')),
        getGasPrice: vi.fn().mockRejectedValue(new Error('RPC 1 ECONNREFUSED')),
      } as unknown as PublicClient;

      const workingClient = {
        readContract: vi.fn().mockImplementation(async ({ functionName }) => {
          if (functionName === 'decimals') return 8;
          if (functionName === 'latestRoundData') {
            return [1n, 200_000_000_000n, 0n, BigInt(now - 10), 1n];
          }
          if (functionName === 'getL1Fee') return 1000n;
          return 0n;
        }),
        getGasPrice: vi.fn().mockResolvedValue(5_000_000_000n),
      } as unknown as PublicClient;

      const reader = new LiveCostModelReader({
        clients: [failingClient, workingClient],
      });

      const ethUsd = await reader.readEthUsd();
      expect(ethUsd.usdPriceMicros).toBe(2000_000_000n);
      expect(failingClient.readContract).toHaveBeenCalled();
      expect(workingClient.readContract).toHaveBeenCalled();

      const baseGas = await reader.readBaseGas();
      expect(baseGas.gasPriceWei).toBe(5_000_000_000n);
    });

    it('refuses with PRICE_UNAVAILABLE when all configured Base RPC clients fail', async () => {
      const client1 = {
        readContract: vi
          .fn()
          .mockRejectedValue(new Error('RPC 1 502 Bad Gateway')),
        getGasPrice: vi
          .fn()
          .mockRejectedValue(new Error('RPC 1 502 Bad Gateway')),
      } as unknown as PublicClient;
      const client2 = {
        readContract: vi
          .fn()
          .mockRejectedValue(new Error('RPC 2 Connection Timeout')),
        getGasPrice: vi
          .fn()
          .mockRejectedValue(new Error('RPC 2 Connection Timeout')),
      } as unknown as PublicClient;

      const reader = new LiveCostModelReader({
        clients: [client1, client2],
      });

      await expect(reader.readEthUsd()).rejects.toThrow(
        /All Base RPCs failed for ETH\/USD feed/,
      );
      await expect(reader.readBaseGas()).rejects.toThrow(
        /All Base RPCs failed for Base gas/,
      );
    });

    it('calculates median when all three BCH/USD sources answer', async () => {
      const now = Math.floor(Date.now() / 1000);
      const reader = new LiveCostModelReader({
        fetchCoinbaseFn: async () => ({
          source: 'coinbase-bch-usd',
          usdPrice: 200_000_000n, // $200.00
          asOf: now - 5,
        }),
        fetchKrakenFn: async () => ({
          source: 'kraken-bch-usd',
          usdPrice: 202_000_000n, // $202.00
          asOf: now - 3,
        }),
        fetchBitstampFn: async () => ({
          source: 'bitstamp-bch-usd',
          usdPrice: 201_000_000n, // $201.00
          usdPriceMicros: 201_000_000n,
          asOf: now - 4,
        }),
      });

      const reading = await reader.readBchUsd();
      expect(reading.usdPriceMicros).toBe(201_000_000n); // median of 200, 201, 202 is 201
      expect(reading.components).toHaveLength(3);
    });

    it('calculates median when 1 of 3 BCH/USD sources fails and 2 answer', async () => {
      const now = Math.floor(Date.now() / 1000);
      const reader = new LiveCostModelReader({
        fetchCoinbaseFn: async () => ({
          source: 'coinbase-bch-usd',
          usdPrice: 200_000_000n,
          asOf: now - 5,
        }),
        fetchKrakenFn: async () => {
          throw new Error('Kraken Cloudflare 520');
        },
        fetchBitstampFn: async () => ({
          source: 'bitstamp-bch-usd',
          usdPrice: 202_000_000n,
          usdPriceMicros: 202_000_000n,
          asOf: now - 4,
        }),
      });

      const reading = await reader.readBchUsd();
      expect(reading.usdPriceMicros).toBe(201_000_000n); // (200 + 202)/2 = 201
      expect(reading.components).toHaveLength(2);
    });

    it('refuses with PRICE_UNAVAILABLE when fewer than two BCH/USD sources answer', async () => {
      const now = Math.floor(Date.now() / 1000);
      const reader = new LiveCostModelReader({
        fetchCoinbaseFn: async () => ({
          source: 'coinbase-bch-usd',
          usdPrice: 200_000_000n,
          asOf: now - 5,
        }),
        fetchKrakenFn: async () => {
          throw new Error('Kraken 502');
        },
        fetchBitstampFn: async () => {
          throw new Error('Bitstamp 503');
        },
      });

      await expect(reader.readBchUsd()).rejects.toThrow(
        /Fewer than two public BCH\/USD sources available/,
      );
    });

    it('refuses with PEG_GUARD when BCH/USD sources disagree beyond configured percent', async () => {
      const now = Math.floor(Date.now() / 1000);
      const reader = new LiveCostModelReader({
        fetchCoinbaseFn: async () => ({
          source: 'coinbase-bch-usd',
          usdPrice: 200_000_000n, // $200
          asOf: now - 5,
        }),
        fetchKrakenFn: async () => ({
          source: 'kraken-bch-usd',
          usdPrice: 220_000_000n, // $220 (10% higher > 5% limit)
          asOf: now - 3,
        }),
        fetchBitstampFn: async () => ({
          source: 'bitstamp-bch-usd',
          usdPrice: 200_500_000n,
          usdPriceMicros: 200_500_000n,
          asOf: now - 4,
        }),
      });

      await expect(reader.readBchUsd()).rejects.toThrow(
        /BCH\/USD source disagreement.*exceeds 5% limit/,
      );
    });
  });

  describe('7. Cost Feed Grace Period & Last Known Good Fallback (B4-12)', () => {
    it('uses last known good reading within grace period and marks source as cached with age', async () => {
      const t0 = 1700000000;
      let ethCallCount = 0;

      const workingClient = {
        readContract: vi.fn().mockImplementation(async ({ functionName }) => {
          if (functionName === 'decimals') return 8;
          if (functionName === 'latestRoundData') {
            ethCallCount++;
            if (ethCallCount > 1) {
              throw new Error('Chainlink RPC Network Drop');
            }
            return [1n, 200_000_000_000n, 0n, BigInt(t0), 1n];
          }
          if (functionName === 'getL1Fee') return 1000n;
          return 0n;
        }),
        getGasPrice: vi.fn().mockResolvedValue(5_000_000_000n),
      } as unknown as PublicClient;

      const reader = new LiveCostModelReader({
        client: workingClient,
        costFeedGraceSeconds: 900,
        cacheTtlSeconds: 1, // short TTL so next read refreshes
        fetchCoinbaseFn: async () => ({
          source: 'coinbase-bch-usd',
          usdPrice: 200_000_000n,
          asOf: t0,
        }),
        fetchKrakenFn: async () => ({
          source: 'kraken-bch-usd',
          usdPrice: 200_000_000n,
          asOf: t0,
        }),
        fetchBitstampFn: async () => ({
          source: 'bitstamp-bch-usd',
          usdPrice: 200_000_000n,
          usdPriceMicros: 200_000_000n,
          asOf: t0,
        }),
      });

      // First read at t0 succeeds
      const inputs1 = await reader.readLiveInputs(t0);
      expect(inputs1.ethUsd.source).toBe('chainlink-base-eth-usd');

      // Second read at t0 + 200s: fresh read fails, but within 900s grace period
      const inputs2 = await reader.readLiveInputs(t0 + 200);
      expect(inputs2.ethUsd.source).toBe(
        'chainlink-base-eth-usd (cached, 200s old)',
      );
      expect(inputs2.ethUsd.usdPriceMicros).toBe(2000_000_000n);

      // Status check reflects cached state
      const statuses = reader.getFeedStatuses(t0 + 200);
      expect(statuses.ethUsd?.cached).toBe(true);
      expect(statuses.ethUsd?.lastError).toContain(
        'Chainlink RPC Network Drop',
      );
      expect(statuses.ethUsd?.ageSeconds).toBe(200);
    });

    it('refuses with PRICE_UNAVAILABLE when last known good reading exceeds grace period', async () => {
      const t0 = 1700000000;
      let ethCallCount = 0;

      const workingClient = {
        readContract: vi.fn().mockImplementation(async ({ functionName }) => {
          if (functionName === 'decimals') return 8;
          if (functionName === 'latestRoundData') {
            ethCallCount++;
            if (ethCallCount > 1) {
              throw new Error('Chainlink RPC Down');
            }
            return [1n, 200_000_000_000n, 0n, BigInt(t0), 1n];
          }
          if (functionName === 'getL1Fee') return 1000n;
          return 0n;
        }),
        getGasPrice: vi.fn().mockResolvedValue(5_000_000_000n),
      } as unknown as PublicClient;

      const reader = new LiveCostModelReader({
        client: workingClient,
        costFeedGraceSeconds: 900,
        cacheTtlSeconds: 1,
        fetchCoinbaseFn: async () => ({
          source: 'coinbase-bch-usd',
          usdPrice: 200_000_000n,
          asOf: t0,
        }),
        fetchKrakenFn: async () => ({
          source: 'kraken-bch-usd',
          usdPrice: 200_000_000n,
          asOf: t0,
        }),
        fetchBitstampFn: async () => ({
          source: 'bitstamp-bch-usd',
          usdPrice: 200_000_000n,
          usdPriceMicros: 200_000_000n,
          asOf: t0,
        }),
      });

      // Seed first read at t0
      await reader.readLiveInputs(t0);

      // At t0 + 1000s (> 900s grace period)
      await expect(reader.readLiveInputs(t0 + 1000)).rejects.toThrow(
        /ETH\/USD feed failed.*last known good reading is expired \(age: 1000s, grace: 900s\)/,
      );
    });
  });

  describe('8. GET /v1/health Visibility of Cost Feeds (B4-12)', () => {
    it('reports costFeeds with lastSuccessTime, lastError, and cache status', async () => {
      const now = Math.floor(Date.now() / 1000);
      const fakeInputs = createValidFakeLiveInputs(now);
      const costModelReader = new LiveCostModelReader({
        fakeInputs,
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

      const app = createSolverServer({
        config,
        db,
        bchClient: fakeBch,
        evmAdapter: fakeEvm,
        evmAdapters: new Map([['base', fakeEvm]]),
        routesContext: buildActiveRoutes(config),
        priceSource: new MockPriceSource(),
        engine: { isQuotingEnabled: () => true } as unknown as SolverEngine,
        costModelReader,
      });

      const res = await app.inject({
        method: 'GET',
        url: '/v1/health',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.ok).toBe(true);
      expect(body.costFeeds).toBeDefined();
      expect(body.costFeeds.ethUsd).toBeDefined();
      expect(body.costFeeds.bchUsd).toBeDefined();
      expect(body.costFeeds.baseGas).toBeDefined();
      expect(body.costFeeds.bchFeeRate).toBeDefined();

      db.close();
      await app.close();
    });
  });

  describe('9. Send Link Lifecycle & Relay-Claim (B4-12)', () => {
    it('reports pending_lock, locked, claimed, refunded, and expired accurately through lifecycle', async () => {
      const now = Math.floor(Date.now() / 1000);
      const config = SolverConfigSchema.parse({
        solverEvmPrivateKey: solverEvmKey,
        operatorToken,
        network: 'testnet',
      });
      const db = new SolverDatabase(':memory:');

      const terms = {
        version: 1,
        direction: 'BCH_TO_EVM',
        bchToken: 'PUSD',
        bchTokenCategory: '0x' + '11'.repeat(32),
        evmToken: '0x' + '22'.repeat(20),
        evmChainId: 8453,
        evmHtlc: '0x' + '33'.repeat(20),
        userEvmAddress: '0x' + '44'.repeat(20),
        userBchLockingBytecode: '0x' + '55'.repeat(25),
        solverEvmAddress: solverAccount.address,
        solverBchLockingBytecode: '0x' + '77'.repeat(25),
        hashLock: '0x' + '88'.repeat(32),
        evmDeadline: now + 3600, // 1h in future
        bchRefundHeight: 330100,
        bchCarrySats: 3000n,
        bchMaxFee: 10000n,
        bchTokenAmount: 500000n,
        evmAmount: 5000000n,
        quoteId: 'test-quote',
        quoteExpiry: now + 60,
      };

      const termsJson = JSON.stringify(terms, (_, v) =>
        typeof v === 'bigint' ? v.toString() + 'n' : v,
      );

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

      const app = createSolverServer({
        config,
        db,
        bchClient: fakeBch,
        evmAdapter: fakeEvm,
        evmAdapters: new Map([['base', fakeEvm]]),
        routesContext: buildActiveRoutes(config),
        priceSource: new MockPriceSource(),
        engine: { isQuotingEnabled: () => true } as unknown as SolverEngine,
      });

      const linkId1 = '0x' + 'aa'.repeat(32);
      // 1. QUOTED -> pending_lock
      db.saveOrder({
        id: linkId1,
        direction: 'BCH_TO_EVM',
        status: 'QUOTED',
        userCounterAddress: terms.userEvmAddress,
        lockId: 'lock1',
        termsJson,
        hashLock: terms.hashLock,
        lane: 'safe',
        fastOptIn: false,
        firstSeenAtMs: Date.now(),
        needsAttention: false,
        createdAt: now,
        updatedAt: now,
      });

      let res = await app.inject({
        method: 'GET',
        url: `/v1/send-links/${linkId1}`,
      });
      expect(res.json().status).toBe('pending_lock');

      // 2. USER_LOCK_SEEN -> locked
      const order = db.getOrder(linkId1)!;
      order.status = 'USER_LOCK_SEEN';
      db.saveOrder(order);
      res = await app.inject({
        method: 'GET',
        url: `/v1/send-links/${linkId1}`,
      });
      expect(res.json().status).toBe('locked');

      // 3. USER_CLAIM_SEEN -> claimed
      order.status = 'USER_CLAIM_SEEN';
      db.saveOrder(order);
      res = await app.inject({
        method: 'GET',
        url: `/v1/send-links/${linkId1}`,
      });
      expect(res.json().status).toBe('claimed');

      // 4. REFUNDED -> refunded
      order.status = 'REFUNDED';
      db.saveOrder(order);
      res = await app.inject({
        method: 'GET',
        url: `/v1/send-links/${linkId1}`,
      });
      expect(res.json().status).toBe('refunded');

      // 5. Past evmDeadline -> expired
      const expiredTerms = {
        ...terms,
        evmDeadline: now - 100, // 100s in past
      };
      const linkId2 = '0x' + 'dd'.repeat(32);
      db.saveOrder({
        id: linkId2,
        direction: 'BCH_TO_EVM',
        status: 'QUOTED',
        userCounterAddress: terms.userEvmAddress,
        lockId: 'lock2',
        termsJson: JSON.stringify(expiredTerms, (_, v) =>
          typeof v === 'bigint' ? v.toString() + 'n' : v,
        ),
        hashLock: terms.hashLock,
        lane: 'safe',
        fastOptIn: false,
        firstSeenAtMs: Date.now(),
        needsAttention: false,
        createdAt: now - 200,
        updatedAt: now - 200,
      });
      res = await app.inject({
        method: 'GET',
        url: `/v1/send-links/${linkId2}`,
      });
      expect(res.json().status).toBe('expired');

      db.close();
      await app.close();
    });

    it('sets secret, userClaimTxId, and USER_CLAIM_SEEN on BCH_TO_EVM relay-claim', async () => {
      const now = Math.floor(Date.now() / 1000);
      const config = SolverConfigSchema.parse({
        solverEvmPrivateKey: solverEvmKey,
        operatorToken,
        network: 'testnet',
        allowDevKeys: true,
      });
      const db = new SolverDatabase(':memory:');

      const terms = {
        version: 1,
        direction: 'BCH_TO_EVM',
        bchToken: 'PUSD',
        bchTokenCategory: '0x' + '11'.repeat(32),
        evmToken: '0x' + '22'.repeat(20),
        evmChainId: 8453,
        evmHtlc: '0x' + '33'.repeat(20),
        userEvmAddress: '0x' + '44'.repeat(20),
        userBchLockingBytecode: '0x' + '55'.repeat(25),
        solverEvmAddress: solverAccount.address,
        solverBchLockingBytecode: '0x' + '77'.repeat(25),
        hashLock: '0x' + '88'.repeat(32),
        evmDeadline: now + 3600,
        bchRefundHeight: 330100,
        bchCarrySats: 3000n,
        bchMaxFee: 10000n,
        bchTokenAmount: 500000n,
        evmAmount: 5000000n,
        quoteId: 'test-quote',
        quoteExpiry: now + 60,
      };

      const orderId = '0x' + 'ab'.repeat(32);
      db.saveOrder({
        id: orderId,
        direction: 'BCH_TO_EVM',
        status: 'SOLVER_LOCK_SEEN',
        userCounterAddress: terms.userEvmAddress,
        lockId: 'lock-test',
        termsJson: JSON.stringify(terms, (_, v) =>
          typeof v === 'bigint' ? v.toString() + 'n' : v,
        ),
        hashLock: terms.hashLock,
        lane: 'safe',
        fastOptIn: false,
        firstSeenAtMs: Date.now(),
        needsAttention: false,
        createdAt: now,
        updatedAt: now,
      });

      const fakeEvm = {
        id: 'base',
        address: solverAccount.address,
        getTokenBalance: async () => 0n,
        getNativeBalance: async () => 0n,
        getTip: async () => ({ height: 100, ageSeconds: 1, stale: false }),
        isFinal: async () => true,
        assets: [],
        getLock: async () => ({
          status: 'locked',
          sender: solverAccount.address,
          recipient: terms.userEvmAddress,
          amount: 5000000n,
          hashLock: terms.hashLock,
          expiration: now + 3600,
          token: terms.evmToken,
        }),
        claim: async () => ({
          chain: 'base',
          txId: '0x' + 'cc'.repeat(32),
        }),
      } as unknown as EvmChainAdapter;

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

      const app = createSolverServer({
        config,
        db,
        bchClient: fakeBch,
        evmAdapter: fakeEvm,
        evmAdapters: new Map([['base', fakeEvm]]),
        routesContext: buildActiveRoutes(config),
        priceSource: new MockPriceSource(),
        engine: { isQuotingEnabled: () => true } as unknown as SolverEngine,
      });

      const mockSecret = '0x' + 'bb'.repeat(32);
      const res = await app.inject({
        method: 'POST',
        url: `/v1/orders/${orderId}/relay-claim`,
        payload: {
          secret: mockSecret,
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().ok).toBe(true);

      const savedOrder = db.getOrder(orderId);
      expect(savedOrder?.secret).toBe(mockSecret);
      expect(savedOrder?.userClaimTxId).toBe('0x' + 'cc'.repeat(32));
      expect(savedOrder?.status).toBe('USER_CLAIM_SEEN');

      db.close();
      await app.close();
    });
  });
});
