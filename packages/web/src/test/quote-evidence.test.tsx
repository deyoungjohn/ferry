import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { MemoryRouter } from 'react-router';
import { verifyQuote } from '@ferry/solver-client';
import { verifyPricing } from '@ferry/core';
import type { QuoteResponse as ApiQuoteResponse } from '@ferry/core/api';
import { SwapCard } from '../components/SwapCard';
import { SolverProvider } from '../lib/solver/SolverProvider';
import { MockSolverClient } from '../lib/solver/mock';
import { MockPriceReader } from '../lib/pricing/mock';
import { CHECKABLE_QUOTE_WORDING } from '../lib/solver/pricing-display';

describe('Quote row with evidence (FR-17) & PriceReader', () => {
  it('exposes the required checkable quote wording constant', () => {
    expect(CHECKABLE_QUOTE_WORDING).toBe(
      'every quote shows its reference price and you can check it',
    );
  });

  it('MockPriceReader returns Cauldron spot price $0.998 for PUSD and $1.000 for USDC', async () => {
    const reader = new MockPriceReader();
    const pusdPrice = await reader.readPrice('PUSD');
    const usdcPrice = await reader.readPrice('USDC');

    expect(pusdPrice.usdPrice).toBe('0.998');
    expect(pusdPrice.source).toBe('Cauldron');
    expect(usdcPrice.usdPrice).toBe('1.000');
  });

  it('verifyQuote from @ferry/solver-client verifies a valid quote and its terms', async () => {
    const client = new MockSolverClient();
    const quoteRes = await client.getQuote({
      fromToken: 'USDC',
      toToken: 'tPUSD',
      fromChain: 'Base Sepolia',
      toChain: 'BCH Chipnet',
      fromAmount: 20,
      lane: 'fast',
    });

    expect(quoteRes.signedQuote).toBeDefined();
    const signedQuote = quoteRes.signedQuote!;

    const verified = await verifyQuote(
      {
        orderId: signedQuote.orderId,
        terms: signedQuote.terms as unknown as ApiQuoteResponse['terms'],
        signature: signedQuote.signature,
        signerAddress: signedQuote.signerAddress,
      },
      {
        direction: 'EVM_TO_BCH',
        token: 'PUSD',
        chainId: 84532,
        evmToken: signedQuote.terms.evmToken,
        amountIn: 20_000_000n,
        userEvmAddress: signedQuote.terms.userEvmAddress,
        userBchLockingBytecode: signedQuote.terms.userBchLockingBytecode,
        hashLock: signedQuote.terms.hashLock,
        lane: 'fast',
      },
      {
        bchTipHeight: 170000,
        evmTokenDecimals: 6,
        bchTokenDecimals: 2,
        nowSeconds: signedQuote.terms.quoteExpiry - 100,
      },
    );

    expect(verified.orderId.toLowerCase()).toBe(
      signedQuote.orderId.toLowerCase(),
    );
    expect(verified.signature).toBe(signedQuote.signature);
    expect(verified.signerAddress.toLowerCase()).toBe(
      signedQuote.signerAddress.toLowerCase(),
    );
  });

  it('verifyPricing from @ferry/core warns when quoted reference price diverges from live Cauldron spot', async () => {
    const client = new MockSolverClient();
    const quoteRes = await client.getQuote({
      fromToken: 'USDC',
      toToken: 'tPUSD',
      fromChain: 'Base Sepolia',
      toChain: 'BCH Chipnet',
      fromAmount: 20,
      lane: 'fast',
    });

    const signedQuote = quoteRes.signedQuote!;
    const reader = new MockPriceReader({
      PUSD: {
        asset: 'PUSD',
        usdPrice: '0.850', // Divergent spot price vs quoted 0.998
        source: 'Cauldron',
        asOf: Math.floor(Date.now() / 1000),
      },
    });

    const spot = await reader.readPrice('PUSD');
    const result = verifyPricing(signedQuote.terms, spot.usdPrice, '0.02');

    expect(result.status).toBe('warn');
  });

  it('verifyQuote rejects mismatched amounts or directions', async () => {
    const client = new MockSolverClient();
    const quoteRes = await client.getQuote({
      fromToken: 'USDC',
      toToken: 'tPUSD',
      fromChain: 'Base Sepolia',
      toChain: 'BCH Chipnet',
      fromAmount: 20,
      lane: 'fast',
    });

    const signedQuote = quoteRes.signedQuote!;

    await expect(
      verifyQuote(
        {
          orderId: signedQuote.orderId,
          terms: signedQuote.terms as unknown as ApiQuoteResponse['terms'],
          signature: signedQuote.signature,
          signerAddress: signedQuote.signerAddress,
        },
        {
          direction: 'EVM_TO_BCH',
          token: 'PUSD',
          chainId: 84532,
          evmToken: signedQuote.terms.evmToken,
          amountIn: 50_000_000n, // Mismatch (quoted 20, requested 50)
          userEvmAddress: signedQuote.terms.userEvmAddress,
          userBchLockingBytecode: signedQuote.terms.userBchLockingBytecode,
          hashLock: signedQuote.terms.hashLock,
          lane: 'fast',
        },
        {
          bchTipHeight: 170000,
          evmTokenDecimals: 6,
          bchTokenDecimals: 2,
          nowSeconds: signedQuote.terms.quoteExpiry - 100,
        },
      ),
    ).rejects.toThrow();
  });

  it('shows the rate and the fee, and no pricing line, in the SwapCard', async () => {
    render(
      <MemoryRouter>
        <SolverProvider client={new MockSolverClient()}>
          <SwapCard />
        </SolverProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByTestId('quote-rate')).toBeInTheDocument();
    expect(screen.queryByTestId('quote-evidence-line')).toBeNull();
    expect(
      screen.queryByText(
        'every quote shows its reference price and you can check it',
      ),
    ).toBeNull();
  });
});
