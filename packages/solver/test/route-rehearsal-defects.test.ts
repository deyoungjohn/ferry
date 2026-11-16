import { describe, expect, it } from 'vitest';
import {
  tokenAmountToUsdMicros,
  usdMicrosToTokenAmount,
  QuoteBuilder,
} from '../src/pricing/quote-builder.js';
import {
  DEFAULT_ROUTE_FIXED_FEES_USD_MICROS,
  getRouteFixedFeeUsdMicros,
  routeMinSwapUsdMicros,
} from '../src/ops/routes-config.js';
import { LiquidityManager } from '../src/pricing/liquidity.js';
import type { PriceSource } from '../src/pricing/price-source.js';

describe('B4-06 Rehearsal Defects (Decimals & Route Fixed Fees)', () => {
  describe('tokenAmountToUsdMicros & usdMicrosToTokenAmount', () => {
    it('converts 6-decimal token amounts (USDC) to and from USD micros', () => {
      const oneDollar = 1_000_000n; // 1 USDC = 10^6
      const micros = tokenAmountToUsdMicros(oneDollar, 6);
      expect(micros).toBe(1_000_000n);

      const tokenAmount = usdMicrosToTokenAmount(micros, 6);
      expect(tokenAmount).toBe(oneDollar);
    });

    it('converts 18-decimal token amounts (BNB USDC/USDT) to and from USD micros', () => {
      const oneDollar18 = 1_000_000_000_000_000_000n; // 10^18
      const micros = tokenAmountToUsdMicros(oneDollar18, 18);
      expect(micros).toBe(1_000_000n);

      const twentyFiveDollars18 = 25n * oneDollar18;
      expect(tokenAmountToUsdMicros(twentyFiveDollars18, 18)).toBe(25_000_000n);

      const backToToken = usdMicrosToTokenAmount(1_000_000n, 18);
      expect(backToToken).toBe(oneDollar18);
    });

    it('converts 2-decimal token amounts (PUSD/MUSD) to and from USD micros', () => {
      const oneDollar2 = 100n; // 100 cents = 1.00 PUSD
      const micros = tokenAmountToUsdMicros(oneDollar2, 2);
      expect(micros).toBe(1_000_000n);

      const backToToken = usdMicrosToTokenAmount(10_000n, 2); // 1 cent = 10,000 micros
      expect(backToToken).toBe(1n);
    });
  });

  describe('Route Fixed Fees & Minimum Swap Scaling', () => {
    it('provides correct default fixed fees per route', () => {
      expect(getRouteFixedFeeUsdMicros('base')).toBe(10_000n); // $0.01
      expect(getRouteFixedFeeUsdMicros('arbitrum')).toBe(20_000n); // $0.02
      expect(getRouteFixedFeeUsdMicros('bnb')).toBe(10_000n); // $0.01
      expect(getRouteFixedFeeUsdMicros('ethereum')).toBe(340_000n); // $0.34
    });

    it('ensures fixed fee is at most 2% of minimum swap for every route', () => {
      for (const fee of Object.values(DEFAULT_ROUTE_FIXED_FEES_USD_MICROS)) {
        const minSwap = routeMinSwapUsdMicros(fee);
        // Fee must be <= 2% of minSwap: (fee * 100) / minSwap <= 2
        const feePercentageBps = (fee * 10_000n) / minSwap;
        expect(feePercentageBps).toBeLessThanOrEqual(200n); // <= 2.00%
      }
    });

    it('scales Ethereum minimum swap to approximately $20 to satisfy 2% cap', () => {
      const ethFee = getRouteFixedFeeUsdMicros('ethereum');
      expect(ethFee).toBe(340_000n);
      const ethMinSwap = routeMinSwapUsdMicros(ethFee);
      expect(ethMinSwap).toBe(20_000_000n); // $20.00
      // 340,000 / 20,000,000 = 1.7%
      expect(Number(ethFee) / Number(ethMinSwap)).toBe(0.017);
    });

    it('keeps Base, Arbitrum and BNB minimum swap at standard $1.00', () => {
      expect(routeMinSwapUsdMicros(getRouteFixedFeeUsdMicros('base'))).toBe(
        1_000_000n,
      );
      expect(routeMinSwapUsdMicros(getRouteFixedFeeUsdMicros('arbitrum'))).toBe(
        1_000_000n,
      );
      expect(routeMinSwapUsdMicros(getRouteFixedFeeUsdMicros('bnb'))).toBe(
        1_000_000n,
      );
    });
  });

  describe('QuoteBuilder with 18-decimal inputs and route fixed fees', () => {
    const fakePriceSource: PriceSource = {
      async getPrice() {
        return {
          usdPrice: 1_000_000n, // $1.00
          source: 'test',
          asOf: Math.floor(Date.now() / 1000),
          heartbeatSeconds: 86400,
        };
      },
    };

    it('accepts $1 swap with 18 decimals on BNB route and applies fixed fee', async () => {
      const builder = new QuoteBuilder(fakePriceSource, new LiquidityManager());
      const now = Math.floor(Date.now() / 1000);
      const oneBnbUsdc = 1_000_000_000_000_000_000n; // 10^18 ($1.00)

      const result = await builder.buildQuote({
        quoteId: 'quote-bnb-1',
        direction: 'EVM_TO_BCH',
        payAsset: 'USDC',
        receiveAsset: 'PUSD',
        amountIn: oneBnbUsdc,
        inputDecimals: 18,
        outputDecimals: 2,
        fixedFeeUsdMicros: 10_000n, // $0.01 fee
        minSwapUsdMicros: 1_000_000n,
        userAddress: '0x1111111111111111111111111111111111111111',
        userIp: '127.0.0.1',
        currentInventory: 100_000_000n,
        openExposure: 0n,
        nowSeconds: now,
        termsTemplate: {
          version: 1,
          bchToken: 'PUSD',
          bchTokenCategory:
            '0xec335fd3ffa45f80cef7217cf98e8adf562df5a3e33f354f69df2951703586ac',
          evmToken: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
          evmChainId: 56,
          evmHtlc: '0x0000000000000000000000000000000000000000',
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
        expect(result.terms.pricing.fixedFeeBase).toBe(1n); // $0.01 in PUSD 2-decimals = 1 cent
        // Gross receive = $1.00 - 0.4% spread = 99.6 cents = 99 cents floor.
        // Minus fixed fee (1 cent) = 98 cents.
        expect(result.terms.bchTokenAmount).toBe(98n);
      }
    });

    it('refuses Ethereum swap below route minimum ($20.00)', async () => {
      const builder = new QuoteBuilder(fakePriceSource, new LiquidityManager());
      const now = Math.floor(Date.now() / 1000);
      const tenDollars6 = 10_000_000n; // $10.00

      const result = await builder.buildQuote({
        quoteId: 'quote-eth-small',
        direction: 'EVM_TO_BCH',
        payAsset: 'USDC',
        receiveAsset: 'PUSD',
        amountIn: tenDollars6,
        inputDecimals: 6,
        outputDecimals: 2,
        fixedFeeUsdMicros: 340_000n,
        minSwapUsdMicros: 20_000_000n, // $20.00 min swap
        userAddress: '0x1111111111111111111111111111111111111111',
        userIp: '127.0.0.1',
        currentInventory: 100_000_000n,
        openExposure: 0n,
        nowSeconds: now,
        termsTemplate: {
          version: 1,
          bchToken: 'PUSD',
          bchTokenCategory:
            '0xec335fd3ffa45f80cef7217cf98e8adf562df5a3e33f354f69df2951703586ac',
          evmToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
          evmChainId: 1,
          evmHtlc: '0x0000000000000000000000000000000000000000',
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

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe('ROUTE_DISABLED');
        expect(result.message).toContain('below minimum swap of $20.00');
      }
    });
  });
});
