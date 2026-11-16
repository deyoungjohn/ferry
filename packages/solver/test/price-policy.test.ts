import { describe, expect, it } from 'vitest';
import { loadChainConfig } from '@ferry/chain-config';
import type { EvmChainAdapter } from '@ferry/chain-evm';
import { RoutePriceSource } from '../src/pricing/composite-source.js';
import { MockPriceSource } from '../src/pricing/price-source.js';
import { QuoteBuilder } from '../src/pricing/quote-builder.js';
import { LiquidityManager } from '../src/pricing/liquidity.js';
import { BchQuorumClient } from '../src/bch/quorum-client.js';
import type { ElectrumTransport } from '../src/bch/transport.js';
import { checkRouteReadiness } from '../src/ops/routes-config.js';
import { buildServer } from '../src/api/server.js';
import { SolverDatabase } from '../src/db/database.js';
import { loadConfigFromEnv } from '../src/config.js';
import type { SolverEngine } from '../src/engine/runner.js';

describe('Price-Source Policy and BCH Transport (B4-08)', () => {
  const chainConfig = loadChainConfig({ network: 'testnet' });

  const baseTermsTemplate = {
    version: 1 as const,
    bchToken: 'PUSD' as const,
    bchTokenCategory:
      '0xec335fd3ffa45f80cef7217cf98e8adf562df5a3e33f354f69df2951703586ac' as `0x${string}`,
    evmToken: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as `0x${string}`,
    evmChainId: 8453,
    evmHtlc: '0x8b968625F983420B571C102eC0b57F7e509c916e' as `0x${string}`,
    userEvmAddress:
      '0x1111111111111111111111111111111111111111' as `0x${string}`,
    userBchLockingBytecode:
      '0x76a914111111111111111111111111111111111111111188ac' as `0x${string}`,
    solverEvmAddress:
      '0x2222222222222222222222222222222222222222' as `0x${string}`,
    solverBchLockingBytecode:
      '0x76a914222222222222222222222222222222222222222288ac' as `0x${string}`,
    hashLock:
      '0x3333333333333333333333333333333333333333333333333333333333333333' as `0x${string}`,
    evmDeadline: 1700086400,
    bchRefundHeight: 330000,
    bchCarrySats: 3000n,
    bchMaxFee: 1500n,
  };

  describe('1. Paryon staleness & secondary reference policy', () => {
    it('uses Cauldron spot as primary and Paryon as secondary with 2-hour max age', async () => {
      const now = 1700000000;
      const fakeBchSource = {
        async getPrice(asset: string) {
          if (asset === 'PUSD') {
            return {
              usdPrice: 998_000n, // $0.998
              source: 'cauldron',
              asOf: now - 30, // 30s old
            };
          }
          if (asset === 'PUSD_PARYON') {
            return {
              usdPrice: 995_000n, // $0.995
              source: 'paryon',
              asOf: now - 2160, // 36 minutes old (normal for Paryon)
            };
          }
          throw new Error(`Asset not found: ${asset}`);
        },
      };

      const routeSource = new RoutePriceSource({
        chainConfig,
        bchSource: fakeBchSource,
        nowSeconds: () => now,
        paryonMaxAgeSeconds: 7200, // 2 hours
      });

      const detailed = await routeSource.getDetailedPrice('PUSD');
      expect(detailed.usdPrice).toBe(998_000n);
      expect(detailed.source).toBe('cauldron');
      expect(detailed.primary.source).toBe('cauldron');
      expect(detailed.secondary).toBeDefined();
      expect(detailed.secondary?.source).toBe('paryon');
      expect(detailed.secondary?.available).toBe(true);
      expect(detailed.secondary?.status).toBe('ok');
    });

    it('stale secondary (> 2 hours) never refuses a quote; marked as unavailable in evidence', async () => {
      const now = 1700000000;
      const fakeBchSource = {
        async getPrice(asset: string) {
          if (asset === 'PUSD') {
            return {
              usdPrice: 1_000_000n,
              source: 'cauldron',
              asOf: now - 10,
            };
          }
          if (asset === 'PUSD_PARYON') {
            return {
              usdPrice: 994_000n,
              source: 'paryon',
              asOf: now - 7300, // > 2 hours (7200s) -> stale
            };
          }
          throw new Error('Not found');
        },
      };

      const routeSource = new RoutePriceSource({
        chainConfig,
        bchSource: fakeBchSource,
        evmSources: new Map([
          [
            'usdc',
            {
              getPrice: async () => ({
                usdPrice: 1_000_000n,
                source: 'chainlink',
                asOf: now - 5,
              }),
            },
          ],
        ]),
        nowSeconds: () => now,
        paryonMaxAgeSeconds: 7200,
      });

      const quoteBuilder = new QuoteBuilder(
        routeSource,
        new LiquidityManager(),
      );

      const quote = await quoteBuilder.buildQuote({
        quoteId: 'quote-paryon-stale',
        direction: 'EVM_TO_BCH',
        payAsset: 'USDC',
        receiveAsset: 'PUSD',
        amountIn: 10_000_000n,
        userAddress: '0xAlice',
        userIp: '1.2.3.4',
        currentInventory: 100_000_000n,
        openExposure: 0n,
        nowSeconds: now,
        termsTemplate: baseTermsTemplate,
      });

      // Quote MUST succeed despite secondary being stale
      expect(quote.ok).toBe(true);
      if (quote.ok) {
        // Evidence shows paryon as unavailable
        const paryonRef = quote.pricingEvidence.refs.find((r) =>
          r.source.startsWith('paryon'),
        );
        expect(paryonRef).toBeDefined();
        expect(paryonRef?.source).toContain('unavailable');
      }
    });

    it('failed/unreachable secondary never refuses a quote', async () => {
      const now = 1700000000;
      const fakeBchSource = {
        async getPrice(asset: string) {
          if (asset === 'PUSD') {
            return {
              usdPrice: 1_000_000n,
              source: 'cauldron',
              asOf: now - 10,
            };
          }
          throw new Error('Paryon stats API network timeout');
        },
      };

      const routeSource = new RoutePriceSource({
        chainConfig,
        bchSource: fakeBchSource,
        evmSources: new Map([
          [
            'usdc',
            {
              getPrice: async () => ({
                usdPrice: 1_000_000n,
                source: 'chainlink',
                asOf: now - 5,
              }),
            },
          ],
        ]),
        nowSeconds: () => now,
      });

      const quoteBuilder = new QuoteBuilder(
        routeSource,
        new LiquidityManager(),
      );

      const quote = await quoteBuilder.buildQuote({
        quoteId: 'quote-paryon-failed',
        direction: 'EVM_TO_BCH',
        payAsset: 'USDC',
        receiveAsset: 'PUSD',
        amountIn: 10_000_000n,
        userAddress: '0xAlice',
        userIp: '1.2.3.4',
        currentInventory: 100_000_000n,
        openExposure: 0n,
        nowSeconds: now,
        termsTemplate: baseTermsTemplate,
      });

      expect(quote.ok).toBe(true);
      if (quote.ok) {
        const paryonRef = quote.pricingEvidence.refs.find((r) =>
          r.source.startsWith('paryon'),
        );
        expect(paryonRef).toBeDefined();
        expect(paryonRef?.source).toContain('unavailable');
      }
    });
  });

  describe('2. Peg guard policy boundaries (Rule A: Primary Peg Guard)', () => {
    // Boundary: 1% (10,000 micros) from $1.00
    it('accepts primary price with deviation exactly at 10,000 micros boundary ($0.990000)', async () => {
      const now = 1700000000;
      const priceSource = new MockPriceSource();
      priceSource.setPrice('USDC', {
        usdPrice: 1_000_000n,
        source: 'chainlink',
        asOf: now,
      });
      priceSource.setPrice('PUSD', {
        usdPrice: 990_000n, // Exactly 10,000 micros deviation (1.00%)
        source: 'cauldron',
        asOf: now,
      });

      const quoteBuilder = new QuoteBuilder(
        priceSource,
        new LiquidityManager(),
        { spreadBps: 40, fixedFeeUsdMicros: 0n },
        10_000n, // 1% peg tolerance
      );

      const quote = await quoteBuilder.buildQuote({
        quoteId: 'quote-boundary-pass',
        direction: 'EVM_TO_BCH',
        payAsset: 'USDC',
        receiveAsset: 'PUSD',
        amountIn: 10_000_000n,
        userAddress: '0xAlice',
        userIp: '1.2.3.4',
        currentInventory: 100_000_000n,
        openExposure: 0n,
        nowSeconds: now,
        termsTemplate: baseTermsTemplate,
      });

      expect(quote.ok).toBe(true);
    });

    it('refuses primary price with deviation at 10,001 micros boundary ($0.989999) with numbers in message', async () => {
      const now = 1700000000;
      const priceSource = new MockPriceSource();
      priceSource.setPrice('USDC', {
        usdPrice: 1_000_000n,
        source: 'chainlink',
        asOf: now,
      });
      priceSource.setPrice('PUSD', {
        usdPrice: 989_999n, // 10,001 micros deviation (> 1.00%)
        source: 'cauldron',
        asOf: now,
      });

      const quoteBuilder = new QuoteBuilder(
        priceSource,
        new LiquidityManager(),
        { spreadBps: 40, fixedFeeUsdMicros: 0n },
        10_000n, // 1% peg tolerance
      );

      const quote = await quoteBuilder.buildQuote({
        quoteId: 'quote-boundary-fail',
        direction: 'EVM_TO_BCH',
        payAsset: 'USDC',
        receiveAsset: 'PUSD',
        amountIn: 10_000_000n,
        userAddress: '0xAlice',
        userIp: '1.2.3.4',
        currentInventory: 100_000_000n,
        openExposure: 0n,
        nowSeconds: now,
        termsTemplate: baseTermsTemplate,
      });

      expect(quote.ok).toBe(false);
      if (!quote.ok) {
        expect(quote.reason).toBe('PEG_GUARD');
        expect(quote.message).toContain('10001 micros');
        expect(quote.message).toContain('10000 micros');
        expect(quote.message).toContain('$0.989999');
      }
    });
  });

  describe('3. Source disagreement policy boundaries (Rule B: Cauldron vs Paryon)', () => {
    // Disagreement boundaries:
    // <= 10,000 micros: OK (no warning)
    // > 10,000 and <= 20,000 micros: WARN (quote allowed, warning in evidence)
    // > 20,000 micros: REFUSE (quote refused with PEG_GUARD and numbers in message)

    it('boundary <= 1%: accepts quote without warning when disagreement is 10,000 micros ($0.990 vs $1.000)', async () => {
      const now = 1700000000;
      const priceSource = new MockPriceSource();
      priceSource.setPrice('USDC', {
        usdPrice: 1_000_000n,
        source: 'chainlink',
        asOf: now,
      });
      priceSource.setPrice('PUSD', {
        usdPrice: 1_000_000n,
        source: 'cauldron',
        asOf: now,
      });
      priceSource.setSecondaryPrice('PUSD', {
        usdPrice: 990_000n, // 10,000 micros diff (1.00%)
        source: 'paryon',
        asOf: now - 60,
        available: true,
        status: 'ok',
      });

      const quoteBuilder = new QuoteBuilder(
        priceSource,
        new LiquidityManager(),
        { spreadBps: 40, fixedFeeUsdMicros: 0n },
        10_000n,
        {
          warnUsdMicros: 10_000n,
          refuseUsdMicros: 20_000n,
          paryonMaxAgeSeconds: 7200,
        },
      );

      const quote = await quoteBuilder.buildQuote({
        quoteId: 'quote-disagree-ok',
        direction: 'EVM_TO_BCH',
        payAsset: 'USDC',
        receiveAsset: 'PUSD',
        amountIn: 10_000_000n,
        userAddress: '0xAlice',
        userIp: '1.2.3.4',
        currentInventory: 100_000_000n,
        openExposure: 0n,
        nowSeconds: now,
        termsTemplate: baseTermsTemplate,
      });

      expect(quote.ok).toBe(true);
      if (quote.ok) {
        const paryonRef = quote.pricingEvidence.refs.find((r) =>
          r.source.startsWith('paryon'),
        );
        expect(paryonRef).toBeDefined();
        expect(paryonRef?.source).not.toContain('warn');
        expect(paryonRef?.source).toContain('disagreement');
      }
    });

    it('boundary > 1%: accepts quote with warning in evidence when disagreement is 10,001 micros', async () => {
      const now = 1700000000;
      const priceSource = new MockPriceSource();
      priceSource.setPrice('USDC', {
        usdPrice: 1_000_000n,
        source: 'chainlink',
        asOf: now,
      });
      priceSource.setPrice('PUSD', {
        usdPrice: 1_000_000n,
        source: 'cauldron',
        asOf: now,
      });
      priceSource.setSecondaryPrice('PUSD', {
        usdPrice: 989_999n, // 10,001 micros diff (1.0001%)
        source: 'paryon',
        asOf: now - 60,
        available: true,
        status: 'ok',
      });

      const quoteBuilder = new QuoteBuilder(
        priceSource,
        new LiquidityManager(),
        { spreadBps: 40, fixedFeeUsdMicros: 0n },
        10_000n,
        {
          warnUsdMicros: 10_000n,
          refuseUsdMicros: 20_000n,
          paryonMaxAgeSeconds: 7200,
        },
      );

      const quote = await quoteBuilder.buildQuote({
        quoteId: 'quote-disagree-warn-boundary',
        direction: 'EVM_TO_BCH',
        payAsset: 'USDC',
        receiveAsset: 'PUSD',
        amountIn: 10_000_000n,
        userAddress: '0xAlice',
        userIp: '1.2.3.4',
        currentInventory: 100_000_000n,
        openExposure: 0n,
        nowSeconds: now,
        termsTemplate: baseTermsTemplate,
      });

      expect(quote.ok).toBe(true);
      if (quote.ok) {
        const paryonRef = quote.pricingEvidence.refs.find((r) =>
          r.source.startsWith('paryon'),
        );
        expect(paryonRef).toBeDefined();
        expect(paryonRef?.source).toContain('warn');
        expect(paryonRef?.source).toContain('10001 micros');
      }
    });

    it('boundary <= 2%: accepts quote with warning when disagreement is exactly 20,000 micros', async () => {
      const now = 1700000000;
      const priceSource = new MockPriceSource();
      priceSource.setPrice('USDC', {
        usdPrice: 1_000_000n,
        source: 'chainlink',
        asOf: now,
      });
      priceSource.setPrice('PUSD', {
        usdPrice: 1_000_000n,
        source: 'cauldron',
        asOf: now,
      });
      priceSource.setSecondaryPrice('PUSD', {
        usdPrice: 980_000n, // Exactly 20,000 micros diff (2.00%)
        source: 'paryon',
        asOf: now - 60,
        available: true,
        status: 'ok',
      });

      const quoteBuilder = new QuoteBuilder(
        priceSource,
        new LiquidityManager(),
        { spreadBps: 40, fixedFeeUsdMicros: 0n },
        10_000n,
        {
          warnUsdMicros: 10_000n,
          refuseUsdMicros: 20_000n,
          paryonMaxAgeSeconds: 7200,
        },
      );

      const quote = await quoteBuilder.buildQuote({
        quoteId: 'quote-disagree-refuse-boundary-pass',
        direction: 'EVM_TO_BCH',
        payAsset: 'USDC',
        receiveAsset: 'PUSD',
        amountIn: 10_000_000n,
        userAddress: '0xAlice',
        userIp: '1.2.3.4',
        currentInventory: 100_000_000n,
        openExposure: 0n,
        nowSeconds: now,
        termsTemplate: baseTermsTemplate,
      });

      expect(quote.ok).toBe(true);
      if (quote.ok) {
        const paryonRef = quote.pricingEvidence.refs.find((r) =>
          r.source.startsWith('paryon'),
        );
        expect(paryonRef?.source).toContain('warn');
        expect(paryonRef?.source).toContain('20000 micros');
      }
    });

    it('boundary > 2%: refuses quote when disagreement is 20,001 micros with numbers in message', async () => {
      const now = 1700000000;
      const priceSource = new MockPriceSource();
      priceSource.setPrice('USDC', {
        usdPrice: 1_000_000n,
        source: 'chainlink',
        asOf: now,
      });
      priceSource.setPrice('PUSD', {
        usdPrice: 1_000_000n,
        source: 'cauldron',
        asOf: now,
      });
      priceSource.setSecondaryPrice('PUSD', {
        usdPrice: 979_999n, // 20,001 micros diff (> 2.00%)
        source: 'paryon',
        asOf: now - 60,
        available: true,
        status: 'ok',
      });

      const quoteBuilder = new QuoteBuilder(
        priceSource,
        new LiquidityManager(),
        { spreadBps: 40, fixedFeeUsdMicros: 0n },
        10_000n,
        {
          warnUsdMicros: 10_000n,
          refuseUsdMicros: 20_000n,
          paryonMaxAgeSeconds: 7200,
        },
      );

      const quote = await quoteBuilder.buildQuote({
        quoteId: 'quote-disagree-refuse-boundary-fail',
        direction: 'EVM_TO_BCH',
        payAsset: 'USDC',
        receiveAsset: 'PUSD',
        amountIn: 10_000_000n,
        userAddress: '0xAlice',
        userIp: '1.2.3.4',
        currentInventory: 100_000_000n,
        openExposure: 0n,
        nowSeconds: now,
        termsTemplate: baseTermsTemplate,
      });

      expect(quote.ok).toBe(false);
      if (!quote.ok) {
        expect(quote.reason).toBe('PEG_GUARD');
        expect(quote.message).toContain('20001 micros');
        expect(quote.message).toContain('20000 micros');
        expect(quote.message).toContain('$1.000000');
        expect(quote.message).toContain('$0.979999');
      }
    });
  });

  describe('4. BCH transport and quorum failure messages', () => {
    it('reports which hosts failed and why when genesis hash check fails on connect', async () => {
      const mockTransports: ElectrumTransport[] = [
        {
          url: 'wss://fulcrum-bad1.example.com:50004',
          connect: async () => {},
          close: () => {},
          isConnected: () => true,
          request: async <T>() => ({}) as T,
          getGenesisHash: () => 'wrong-hash-1',
          fetchFeatures: async () => ({ genesis_hash: 'wrong-hash-1' }),
          getTip: () => ({ height: 100, timestamp: Date.now() }),
          getLastConfirmedAt: () => Date.now(),
          ping: async () => true,
        },
        {
          url: 'wss://fulcrum-bad2.example.com:50004',
          connect: async () => {},
          close: () => {},
          isConnected: () => true,
          request: async <T>() => ({}) as T,
          getGenesisHash: () => 'wrong-hash-2',
          fetchFeatures: async () => ({ genesis_hash: 'wrong-hash-2' }),
          getTip: () => ({ height: 100, timestamp: Date.now() }),
          getLastConfirmedAt: () => Date.now(),
          ping: async () => true,
        },
      ];

      const client = new BchQuorumClient(mockTransports, 'mainnet');
      await expect(client.connect()).rejects.toThrow(
        /Genesis hash verification failed.*wss:\/\/fulcrum-bad1.*genesis mismatch.*wss:\/\/fulcrum-bad2.*genesis mismatch/i,
      );
    });

    it('reports failed hosts in getQuorumStatus and executeWithFailover', async () => {
      const mockTransport: ElectrumTransport = {
        url: 'wss://fulcrum-failing.example.com:50004',
        connect: async () => {},
        close: () => {},
        isConnected: () => true,
        request: async () => {
          throw new Error('Connection reset by peer');
        },
        getGenesisHash: () =>
          '000000001dd410c49a788668ce26751718cc797474d3152a5fc073dd44fd9f7b',
        fetchFeatures: async () => ({
          genesis_hash:
            '000000001dd410c49a788668ce26751718cc797474d3152a5fc073dd44fd9f7b',
        }),
        getTip: () => ({ height: 0, timestamp: 0 }),
        getLastConfirmedAt: () => 0,
        ping: async () => false,
        getLastError: () => new Error('Connection reset by peer'),
      };

      const client = new BchQuorumClient([mockTransport], 'testnet');
      await client.connect();

      // Check status reporting failed hosts
      const status = client.getQuorumStatus();
      expect(status.isQuorumHealthy).toBe(false);
      expect(
        status.failedHosts?.['wss://fulcrum-failing.example.com:50004'],
      ).toBeDefined();
      expect(status.quorumFailureMessage).toMatch(/Connection reset by peer/);

      // Check executeWithFailover reporting failed hosts
      await expect(client.broadcast('01000000')).rejects.toThrow(
        /wss:\/\/fulcrum-failing.*Connection reset by peer/i,
      );
    });
  });

  describe('5. Operator view (/v1/operator/routes)', () => {
    it('shows per source: last value, age, role, and refusal rule in effect', async () => {
      const now = Math.floor(Date.now() / 1000);
      const config = loadConfigFromEnv({
        NETWORK: 'testnet',
        ALLOW_DEV_KEYS: '1',
        OPERATOR_TOKEN: 'operator-secret-token-min-32-chars-long',
      });
      const db = new SolverDatabase(':memory:');
      const fakeEvmAdapter = {
        id: 'base',
        getTip: async () => ({ height: 12345, ageSeconds: 10, stale: false }),
      } as unknown as EvmChainAdapter;
      const fakeBchClient = {
        getQuorumStatus: () => ({
          isQuorumHealthy: true,
          quorumTip: 200000,
          liveServers: 2,
          totalServers: 2,
          ageSeconds: 5,
        }),
      } as unknown as BchQuorumClient;
      const fakeEngine = { stop: () => {} } as unknown as SolverEngine;

      const fakeBchSource = {
        async getPrice(asset: string) {
          if (asset === 'PUSD') {
            return {
              usdPrice: 998_000n,
              source: 'cauldron',
              asOf: now - 20,
            };
          }
          if (asset === 'PUSD_PARYON') {
            return {
              usdPrice: 995_000n,
              source: 'paryon',
              asOf: now - 1800, // 30 minutes old
            };
          }
          throw new Error('Not found');
        },
      };

      const priceSource = new RoutePriceSource({
        chainConfig,
        bchSource: fakeBchSource,
        evmSources: new Map([
          [
            'base',
            {
              getPrice: async () => ({
                usdPrice: 1_000_000n,
                source: 'chainlink-base',
                asOf: now - 5,
              }),
            },
          ],
        ]),
        nowSeconds: () => now,
      });

      const app = buildServer({
        config,
        db,
        evmAdapter: fakeEvmAdapter,
        bchClient: fakeBchClient,
        engine: fakeEngine,
        priceSource,
      });

      const res = await app.inject({
        method: 'GET',
        url: '/v1/operator/routes',
        headers: { authorization: `Bearer ${config.operatorToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.ok).toBe(true);
      expect(body.routes.length).toBeGreaterThan(0);

      const route0 = body.routes[0];
      expect(route0).toHaveProperty('sources');
      expect(Array.isArray(route0.sources)).toBe(true);
      expect(route0.sources.length).toBeGreaterThanOrEqual(2);

      // Verify source attributes
      const cauldronSrc = route0.sources.find(
        (s: { source: string }) => s.source === 'cauldron',
      );
      expect(cauldronSrc).toBeDefined();
      expect(cauldronSrc.role).toBe('primary');
      expect(cauldronSrc.value).toBe('$0.998000');
      expect(cauldronSrc.age).toBeGreaterThanOrEqual(19);
      expect(cauldronSrc.age).toBeLessThanOrEqual(25);
      expect(cauldronSrc.refusalRule).toContain('peg_guard');

      const paryonSrc = route0.sources.find(
        (s: { source: string }) => s.source === 'paryon',
      );
      expect(paryonSrc).toBeDefined();
      expect(paryonSrc.role).toBe('secondary');
      expect(paryonSrc.value).toBe('$0.995000');
      expect(paryonSrc.age).toBeGreaterThanOrEqual(1799);
      expect(paryonSrc.age).toBeLessThanOrEqual(1805);
      expect(paryonSrc.refusalRule).toContain('source_disagreement');
    });

    it('shows secondary Paryon as unavailable in /v1/operator/routes when stale (> 7200s)', async () => {
      const now = Math.floor(Date.now() / 1000);
      const fakeEvmAdapter = {
        id: 'base',
        getTip: async () => ({ height: 12345, ageSeconds: 10, stale: false }),
      } as unknown as EvmChainAdapter;
      const fakeBchClient = {
        getQuorumStatus: () => ({
          isQuorumHealthy: true,
          quorumTip: 200000,
          liveServers: 2,
          totalServers: 2,
          ageSeconds: 5,
        }),
      } as unknown as BchQuorumClient;

      const fakeBchSource = {
        async getPrice(asset: string) {
          if (asset === 'PUSD') {
            return {
              usdPrice: 1_000_000n,
              source: 'cauldron',
              asOf: now - 15,
            };
          }
          if (asset === 'PUSD_PARYON') {
            return {
              usdPrice: 990_000n,
              source: 'paryon',
              asOf: now - 8000, // > 7200s stale
            };
          }
          throw new Error('Not found');
        },
      };

      const priceSource = new RoutePriceSource({
        chainConfig,
        bchSource: fakeBchSource,
        evmSources: new Map([
          [
            'base',
            {
              getPrice: async () => ({
                usdPrice: 1_000_000n,
                source: 'chainlink-base',
                asOf: now,
              }),
            },
          ],
        ]),
        nowSeconds: () => now,
        paryonMaxAgeSeconds: 7200,
      });

      const readiness = await checkRouteReadiness({
        route: {
          key: 'USDC:base',
          chain: 'base' as const,
          asset: 'USDC' as const,
          htlcAddress: '0x8b968625F983420B571C102eC0b57F7e509c916e',
          deployBlock: 123000,
          logMaxRange: 50000,
          finality: {
            fast: 1,
            safe: 'finalized' as const,
            status: 'verified',
          },
          eligible: true,
          enabled: true,
          reasons: [],
        },
        evmAdapter: fakeEvmAdapter,
        bchClient: fakeBchClient,
        priceSource,
      });

      // Price fresh check remains green because stale secondary does not refuse quotes
      expect(readiness.checks.priceFresh.status).toBe('green');

      const paryonSrc = readiness.sources?.find((s) => s.source === 'paryon');
      expect(paryonSrc).toBeDefined();
      expect(paryonSrc?.status).toBe('unavailable');
      expect(paryonSrc?.value).toBe('unavailable');
      expect(paryonSrc?.role).toBe('secondary');
    });
  });
});
