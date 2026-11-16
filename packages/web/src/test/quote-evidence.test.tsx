import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { MemoryRouter } from 'react-router';
import { SwapCard } from '../components/SwapCard';
import { SolverProvider } from '../lib/solver/SolverProvider';
import { MockSolverClient } from '../lib/solver/mock';
import { MockPriceReader } from '../lib/pricing/mock';
import {
  verifySignedQuote,
  CHECKABLE_QUOTE_WORDING,
} from '../lib/solver/verify';

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

  it('verifySignedQuote verifies a valid quote and its pricing', async () => {
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
    const reader = new MockPriceReader();

    const verification = await verifySignedQuote(
      signedQuote,
      {
        direction: 'EVM_TO_BCH',
        bchToken: 'PUSD',
        fromAmount: 20,
        evmChainId: 84532,
      },
      reader,
    );

    expect(verification.valid).toBe(true);
    expect(verification.termsMatch).toBe(true);
    expect(verification.signatureValid).toBe(true);
    expect(verification.orderId).toBeDefined();
    expect(verification.pricingCheck.status).toBe('ok');
  });

  it('verifySignedQuote warns when quoted reference price diverges from live Cauldron spot', async () => {
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
    // Reader with divergent spot price ($0.85 instead of $0.998)
    const reader = new MockPriceReader({
      PUSD: {
        asset: 'PUSD',
        usdPrice: '0.850',
        source: 'Cauldron',
        asOf: Math.floor(Date.now() / 1000),
      },
    });

    const verification = await verifySignedQuote(
      signedQuote,
      {
        direction: 'EVM_TO_BCH',
        bchToken: 'PUSD',
        fromAmount: 20,
        evmChainId: 84532,
      },
      reader,
      '0.02',
    );

    expect(verification.valid).toBe(true);
    expect(verification.pricingCheck.status).toBe('warn');
  });

  it('verifySignedQuote rejects mismatched amounts or directions', async () => {
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
    const reader = new MockPriceReader();

    const mismatchAmount = await verifySignedQuote(
      signedQuote,
      {
        direction: 'EVM_TO_BCH',
        bchToken: 'PUSD',
        fromAmount: 50, // Expected 50 but signed for 20
        evmChainId: 84532,
      },
      reader,
    );
    expect(mismatchAmount.valid).toBe(false);
    expect(mismatchAmount.error).toContain('Amount mismatch');

    const mismatchDirection = await verifySignedQuote(
      signedQuote,
      {
        direction: 'BCH_TO_EVM', // Expected reverse
        bchToken: 'PUSD',
        fromAmount: 20,
        evmChainId: 84532,
      },
      reader,
    );
    expect(mismatchDirection.valid).toBe(false);
    expect(mismatchDirection.error).toContain('Direction mismatch');
  });

  it('renders reference price line and evidence wording in SwapCard', async () => {
    render(
      <MemoryRouter>
        <SolverProvider client={new MockSolverClient()}>
          <SwapCard />
        </SolverProvider>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(
        screen.getByText(
          'every quote shows its reference price and you can check it',
        ),
      ).toBeInTheDocument();
    });

    expect(screen.getByText(/Cauldron/i)).toBeInTheDocument();
    expect(screen.getByText(/Reference price/i)).toBeInTheDocument();
  });
});
