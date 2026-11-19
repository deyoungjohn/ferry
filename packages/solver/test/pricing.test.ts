import { describe, expect, it } from 'vitest';
import {
  assertFreshPrice,
  MockPriceSource,
  PriceUnavailableError,
  PRICE_MAX_AGE_S,
} from '../src/pricing/price-source.js';
import { LiquidityManager, QUOTE_TTL_S } from '../src/pricing/liquidity.js';
import { QuoteBuilder } from '../src/pricing/quote-builder.js';
import { parseOrderTerms } from '@ferry/core';

describe('Checkable quotes, price sources, and liquidity reservations (blueprint §3.5, FR-17, FR-18)', () => {
  const baseTermsTemplate = parseOrderTerms({
    version: 1,
    direction: 'EVM_TO_BCH',
    bchToken: 'PUSD',
    bchTokenCategory: `0x${'aa'.repeat(32)}`,
    bchTokenAmount: 2485n,
    evmAmount: 25000000n,
    evmToken: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    evmChainId: 8453,
    evmHtlc: '0x5A0C062f4B7b8fF2263530e12bc15De9C836a641',
    userEvmAddress: '0x87Ea46fe296C1810eF234A8e8D782A2122deFaDd',
    userBchLockingBytecode:
      '0x76a914000000000000000000000000000000000000000088ac',
    solverEvmAddress: '0xC9ec91859Bdb598dC2eeE715934D8231478f7A70',
    solverBchLockingBytecode:
      '0x76a914111111111111111111111111111111111111111188ac',
    hashLock: `0x${'cc'.repeat(32)}`,
    evmDeadline: 1700086400,
    bchRefundHeight: 330000,
    bchCarrySats: 3000n,
    bchMaxFee: 1500n,
    quoteId: 'template-quote',
    quoteExpiry: 1700000120,
    pricing: {
      refs: [
        {
          asset: 'PUSD',
          usdPrice: '1.000',
          source: 'cauldron',
          asOf: 1700000000,
        },
      ],
      spreadBps: 50,
      fixedFeeBase: 0n,
      rounding: 'floor',
    },
  });

  describe('Price sources and freshness enforcement (PRICE_MAX_AGE_S = 30s)', () => {
    it('accepts fresh price readings within 30 seconds', () => {
      const now = 1700000050;
      const reading = {
        usdPrice: 1_000_000n,
        source: 'cauldron',
        asOf: now - 15, // 15 seconds old
      };
      expect(() => assertFreshPrice(reading, now)).not.toThrow();
    });

    it('rejects stale price readings older than 30 seconds with PriceUnavailableError', () => {
      const now = 1700000050;
      const staleReading = {
        usdPrice: 998_000n,
        source: 'cauldron',
        asOf: now - (PRICE_MAX_AGE_S + 1), // 31 seconds old
      };
      expect(() => assertFreshPrice(staleReading, now)).toThrow(
        PriceUnavailableError,
      );
      expect(() => assertFreshPrice(staleReading, now)).toThrow(/stale/);
    });

    it('tolerates a reading a few seconds ahead of this clock, and refuses one far ahead', () => {
      const now = 1700000050;
      const ahead = (seconds: number) => ({
        usdPrice: 998_000n,
        source: 'cauldron',
        asOf: now + seconds,
      });
      expect(() => assertFreshPrice(ahead(1), now)).not.toThrow();
      expect(() => assertFreshPrice(ahead(60), now)).not.toThrow();
      expect(() => assertFreshPrice(ahead(61), now)).toThrow(
        PriceUnavailableError,
      );
    });

    it('throws PriceUnavailableError when price reading is missing', async () => {
      const mockSources = new MockPriceSource();
      await expect(mockSources.getPrice('PUSD')).rejects.toThrow(
        PriceUnavailableError,
      );
    });
  });

  describe('Checkable quote builder and typed refusals', () => {
    it('fills PricingEvidence with reference prices, sources, spread, and fee', async () => {
      const now = 1700000000;
      const priceSource = new MockPriceSource();
      priceSource.setPrice('USDC', {
        usdPrice: 1_000_000n,
        source: 'chainlink',
        asOf: now - 5,
      });
      priceSource.setPrice('PUSD', {
        usdPrice: 998_000n,
        source: 'cauldron',
        asOf: now - 10,
      });

      const liquidityManager = new LiquidityManager();
      const quoteBuilder = new QuoteBuilder(priceSource, liquidityManager, {
        spreadBps: 40,
        fixedFeeUsdMicros: 0n,
      });

      const quote = await quoteBuilder.buildQuote({
        quoteId: 'quote-1',
        direction: 'EVM_TO_BCH',
        payAsset: 'USDC',
        receiveAsset: 'PUSD',
        amountIn: 25_000_000n, // $25.00
        userAddress: '0xAlice',
        userIp: '1.2.3.4',
        currentInventory: 100_000_000n, // ample inventory
        openExposure: 0n,
        nowSeconds: now,
        termsTemplate: baseTermsTemplate,
      });

      expect(quote.ok).toBe(true);
      if (quote.ok) {
        expect(quote.pricingEvidence.refs).toHaveLength(2);
        expect(quote.pricingEvidence.refs[0]?.source).toBe('chainlink');
        expect(quote.pricingEvidence.refs[1]?.source).toBe('cauldron');
        expect(quote.pricingEvidence.spreadBps).toBe(40);
        expect(quote.terms.bchTokenAmount).toBe(2490n); // 24.90 PUSD (floor rounded)
      }
    });

    it('asks for the EVM stablecoin price on the route chain, not the Bitcoin Cash side', async () => {
      const now = 1700000000;
      const asked: Array<[string, string | undefined]> = [];
      const inner = new MockPriceSource();
      inner.setPrice('USDT', {
        usdPrice: 1_000_000n,
        source: 'chainlink',
        asOf: now,
      });
      inner.setPrice('PUSD', {
        usdPrice: 998_000n,
        source: 'cauldron',
        asOf: now,
      });
      const priceSource = {
        getPrice: (asset: string, chain?: string) => {
          asked.push([asset, chain]);
          return inner.getPrice(asset);
        },
      };
      const quoteBuilder = new QuoteBuilder(
        priceSource,
        new LiquidityManager(),
        {
          spreadBps: 40,
          fixedFeeUsdMicros: 0n,
        },
      );
      await quoteBuilder.buildQuote({
        quoteId: 'quote-chain',
        direction: 'EVM_TO_BCH',
        payAsset: 'USDT',
        receiveAsset: 'PUSD',
        evmChain: 'arbitrum',
        amountIn: 25_000_000n,
        userAddress: '0xAlice',
        userIp: '1.2.3.4',
        currentInventory: 100_000_000n,
        openExposure: 0n,
        nowSeconds: now,
        termsTemplate: baseTermsTemplate,
      });
      expect(asked).toContainEqual(['USDT', 'arbitrum']);
      expect(asked).toContainEqual(['PUSD', undefined]);
    });

    it('refuses an amount below the route minimum with BELOW_MINIMUM and the minimum', async () => {
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
      const quoteBuilder = new QuoteBuilder(
        priceSource,
        new LiquidityManager(),
        {
          spreadBps: 40,
          fixedFeeUsdMicros: 0n,
        },
      );
      const quote = await quoteBuilder.buildQuote({
        quoteId: 'quote-min',
        direction: 'EVM_TO_BCH',
        payAsset: 'USDC',
        receiveAsset: 'PUSD',
        amountIn: 2_000_000n,
        minSwapUsdMicros: 5_000_000n,
        userAddress: '0xAlice',
        userIp: '1.2.3.4',
        currentInventory: 100_000_000n,
        openExposure: 0n,
        nowSeconds: now,
        termsTemplate: baseTermsTemplate,
      });
      expect(quote.ok).toBe(false);
      if (!quote.ok) {
        expect(quote.reason).toBe('BELOW_MINIMUM');
        expect(quote).toMatchObject({ minAmount: '5.00' });
      }
    });

    it('refuses quote with PEG_GUARD when reference price deviates beyond tolerance', async () => {
      const now = 1700000000;
      const priceSource = new MockPriceSource();
      priceSource.setPrice('USDC', {
        usdPrice: 1_000_000n,
        source: 'chainlink',
        asOf: now,
      });
      // PUSD dropped to $0.97 (beyond default 2% tolerance)
      priceSource.setPrice('PUSD', {
        usdPrice: 970_000n,
        source: 'cauldron',
        asOf: now,
      });

      const liquidityManager = new LiquidityManager();
      const quoteBuilder = new QuoteBuilder(priceSource, liquidityManager);

      const quote = await quoteBuilder.buildQuote({
        quoteId: 'quote-peg-violation',
        direction: 'EVM_TO_BCH',
        payAsset: 'USDC',
        receiveAsset: 'PUSD',
        amountIn: 25_000_000n,
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
        expect(quote.message).toContain('peg tolerance');
      }
    });

    it('refuses quote with PRICE_UNAVAILABLE when any price source is stale', async () => {
      const now = 1700000000;
      const priceSource = new MockPriceSource();
      priceSource.setPrice('USDC', {
        usdPrice: 1_000_000n,
        source: 'chainlink',
        asOf: now,
      });
      // Stale reading: 35s old
      priceSource.setPrice('PUSD', {
        usdPrice: 1_000_000n,
        source: 'cauldron',
        asOf: now - 35,
      });

      const liquidityManager = new LiquidityManager();
      const quoteBuilder = new QuoteBuilder(priceSource, liquidityManager);

      const quote = await quoteBuilder.buildQuote({
        quoteId: 'quote-stale-refusal',
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
        expect(quote.reason).toBe('PRICE_UNAVAILABLE');
      }
    });
  });

  describe('Liquidity reservations and refusals (FR-18)', () => {
    it('test two simultaneous quotes for the last inventory: the second is refused and states current maximum', async () => {
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

      const liquidityManager = new LiquidityManager();
      const quoteBuilder = new QuoteBuilder(priceSource, liquidityManager);

      // Total inventory: exactly 25 PUSD (2500 units)
      const currentInventory = 2500n;

      // Quote 1 requests ~25 USDC -> ~24.90 PUSD (2490 units)
      const quote1 = await quoteBuilder.buildQuote({
        quoteId: 'quote-winner',
        direction: 'EVM_TO_BCH',
        payAsset: 'USDC',
        receiveAsset: 'PUSD',
        amountIn: 25_000_000n,
        userAddress: '0xAlice',
        userIp: '1.1.1.1',
        currentInventory,
        openExposure: 0n,
        nowSeconds: now,
        termsTemplate: baseTermsTemplate,
      });
      expect(quote1.ok).toBe(true);

      // Quote 2 requests another 25 USDC for the last inventory: MUST be refused!
      const quote2 = await quoteBuilder.buildQuote({
        quoteId: 'quote-loser',
        direction: 'EVM_TO_BCH',
        payAsset: 'USDC',
        receiveAsset: 'PUSD',
        amountIn: 25_000_000n,
        userAddress: '0xBob',
        userIp: '2.2.2.2',
        currentInventory,
        openExposure: 0n,
        nowSeconds: now,
        termsTemplate: baseTermsTemplate,
      });

      expect(quote2.ok).toBe(false);
      if (!quote2.ok) {
        expect(quote2.reason).toBe('INSUFFICIENT_LIQUIDITY');
        // Available was 2500 - 2490 = 10 units of 0.01 = 0.1 PUSD, shown as a plain decimal
        expect(quote2.maxAmount).toBe('0.1');
        expect(quote2.asset).toBe('PUSD');
        expect(quote2.message).toContain('Only 0.1 PUSD available');
      }
    });

    it('releases reserved liquidity upon quote expiry (QUOTE_TTL_S = 60s)', async () => {
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

      const liquidityManager = new LiquidityManager();
      const quoteBuilder = new QuoteBuilder(priceSource, liquidityManager);

      const currentInventory = 2500n;

      // Quote 1 reserves 2490 units at t=now
      const quote1 = await quoteBuilder.buildQuote({
        quoteId: 'quote-expiring',
        direction: 'EVM_TO_BCH',
        payAsset: 'USDC',
        receiveAsset: 'PUSD',
        amountIn: 25_000_000n,
        userAddress: '0xAlice',
        userIp: '1.1.1.1',
        currentInventory,
        openExposure: 0n,
        nowSeconds: now,
        termsTemplate: baseTermsTemplate,
      });
      expect(quote1.ok).toBe(true);

      // Advance time by 61 seconds (TTL is 60s)
      const afterExpiry = now + QUOTE_TTL_S + 1;

      // Update mock prices so they are fresh at afterExpiry
      priceSource.setPrice('USDC', {
        usdPrice: 1_000_000n,
        source: 'chainlink',
        asOf: afterExpiry,
      });
      priceSource.setPrice('PUSD', {
        usdPrice: 1_000_000n,
        source: 'cauldron',
        asOf: afterExpiry,
      });

      // Quote 2 now succeeds because Quote 1's reservation expired
      const quote2 = await quoteBuilder.buildQuote({
        quoteId: 'quote-after-expiry',
        direction: 'EVM_TO_BCH',
        payAsset: 'USDC',
        receiveAsset: 'PUSD',
        amountIn: 25_000_000n,
        userAddress: '0xBob',
        userIp: '2.2.2.2',
        currentInventory,
        openExposure: 0n,
        nowSeconds: afterExpiry,
        termsTemplate: baseTermsTemplate,
      });
      expect(quote2.ok).toBe(true);
    });

    it('releases reservation when user lock is seen (transitioning to exposure)', () => {
      const liquidityManager = new LiquidityManager();
      const now = 1000;
      const res = liquidityManager.reserveQuote({
        quoteId: 'quote-to-lock',
        userAddress: '0xAlice',
        userIp: '1.1.1.1',
        asset: 'PUSD',
        amount: 2500n,
        currentInventory: 5000n,
        openExposure: 0n,
        nowSeconds: now,
      });
      expect(res.success).toBe(true);
      expect(liquidityManager.getActiveReservationsForAsset('PUSD', now)).toBe(
        2500n,
      );

      // User lock seen on chain
      liquidityManager.onUserLockSeen('quote-to-lock');
      expect(liquidityManager.getActiveReservationsForAsset('PUSD', now)).toBe(
        0n,
      );
    });

    it('a new quote from the same address for the same asset replaces its earlier quote, so repeated previews never hit the cap', () => {
      // Cap of $100 per address; each quote is $40.
      const manager = new LiquidityManager(100_000_000n, 100_000_000n);
      const now = 1000;
      const quote = (id: string) =>
        manager.reserveQuote({
          quoteId: id,
          userAddress: '0xAlice',
          userIp: '1.1.1.1',
          asset: 'USDC',
          amount: 40_000_000n,
          amountMicros: 40_000_000n,
          currentInventory: 500_000_000n,
          openExposure: 0n,
          nowSeconds: now,
        });
      // Five quotes in a row (a person retyping an amount) all succeed.
      for (let i = 0; i < 5; i++) expect(quote(`q${i}`).success).toBe(true);
      // Only the latest is held.
      expect(manager.getActiveReservationsForAsset('USDC', now)).toBe(
        40_000_000n,
      );
      expect(manager.getActiveReservationsForAddress('0xAlice', now)).toBe(
        40_000_000n,
      );
    });

    it('a different address still counts against the shared limits, and one address cannot exceed its own cap with one quote', () => {
      const manager = new LiquidityManager(100_000_000n, 100_000_000n);
      const now = 1000;
      const base = {
        asset: 'USDC',
        currentInventory: 500_000_000n,
        openExposure: 0n,
        nowSeconds: now,
        userIp: '1.1.1.1',
      };
      expect(
        manager.reserveQuote({
          ...base,
          quoteId: 'a',
          userAddress: '0xA',
          amount: 60_000_000n,
          amountMicros: 60_000_000n,
        }).success,
      ).toBe(true);
      // Same IP, other address: 60 + 60 passes the per-address cap but not the per-IP cap.
      const second = manager.reserveQuote({
        ...base,
        quoteId: 'b',
        userAddress: '0xB',
        amount: 60_000_000n,
        amountMicros: 60_000_000n,
      });
      expect(second.success).toBe(false);
      // One quote over the cap on its own is refused.
      const big = manager.reserveQuote({
        ...base,
        quoteId: 'c',
        userAddress: '0xC',
        userIp: '9.9.9.9',
        amount: 150_000_000n,
        amountMicros: 150_000_000n,
      });
      expect(big.success).toBe(false);
    });

    it('GET /v1/liquidity data function reports inventory, exposure, and active reservations', () => {
      const liquidityManager = new LiquidityManager();
      const now = 1000;
      liquidityManager.reserveQuote({
        quoteId: 'q1',
        userAddress: '0xAlice',
        userIp: '1.1.1.1',
        asset: 'PUSD',
        amount: 1500n,
        currentInventory: 10000n,
        openExposure: 2000n,
        nowSeconds: now,
      });

      const data = liquidityManager.getLiquidityData(
        'PUSD',
        10000n,
        2000n,
        2,
        now,
      );
      expect(data.inventory).toBe('10000');
      expect(data.exposure).toBe('2000');
      expect(data.reserved).toBe('1500');
      expect(data.available).toBe('6500'); // 10000 - 2000 - 1500
    });
  });

  describe('Inventory skew calculation and pricing adjustment (blueprint §21.1)', () => {
    it('calculateSkewBps produces correct positive, negative, and capped skew', async () => {
      const { calculateSkewBps } = await import('../src/pricing/liquidity.js');

      // Balanced: skew 0
      expect(calculateSkewBps(1000_000n, 1000_000n, 50)).toBe(0);

      // BCH low (PUSD low): positive skew (e.g. EVM = 300, BCH = 100 -> diff 200 / total 400 = 0.5)
      // 50% of skewMaxBps (50) = 25 bps
      expect(calculateSkewBps(100_000n, 300_000n, 50)).toBe(25);

      // BCH high: negative skew
      expect(calculateSkewBps(300_000n, 100_000n, 50)).toBe(-25);

      // Maximum skew clamp at 100% imbalance
      expect(calculateSkewBps(0n, 1000_000n, 50)).toBe(50);
      expect(calculateSkewBps(1000_000n, 0n, 50)).toBe(-50);
    });

    it('applies skew to widen forward spread and narrow reverse spread', async () => {
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

      const liquidityManager = new LiquidityManager();
      const quoteBuilder = new QuoteBuilder(priceSource, liquidityManager, {
        spreadBps: 40,
        fixedFeeUsdMicros: 0n,
      });

      // Forward swap with positive skew +20 bps (PUSD low)
      // Effective forward spread should be 40 + 20 = 60 bps
      const fwdQuote = await quoteBuilder.buildQuote({
        quoteId: 'quote-fwd-skew',
        direction: 'EVM_TO_BCH',
        payAsset: 'USDC',
        receiveAsset: 'PUSD',
        amountIn: 25_000_000n,
        userAddress: '0xAlice',
        userIp: '1.2.3.4',
        currentInventory: 100_000_000n,
        openExposure: 0n,
        nowSeconds: now,
        termsTemplate: baseTermsTemplate,
        skewBps: 20,
      });

      expect(fwdQuote.ok).toBe(true);
      if (fwdQuote.ok) {
        expect(fwdQuote.terms.pricing?.spreadBps).toBe(60);
      }

      // Reverse swap with positive skew +20 bps (PUSD low)
      // Effective reverse spread should be 40 - 20 = 20 bps
      const revQuote = await quoteBuilder.buildQuote({
        quoteId: 'quote-rev-skew',
        direction: 'BCH_TO_EVM',
        payAsset: 'PUSD',
        receiveAsset: 'USDC',
        amountIn: 2500n,
        userAddress: '0xAlice',
        userIp: '1.2.3.4',
        currentInventory: 100_000_000n,
        openExposure: 0n,
        nowSeconds: now,
        termsTemplate: baseTermsTemplate,
        skewBps: 20,
      });

      expect(revQuote.ok).toBe(true);
      if (revQuote.ok) {
        expect(revQuote.terms.pricing?.spreadBps).toBe(20);
      }
    });
  });
});
