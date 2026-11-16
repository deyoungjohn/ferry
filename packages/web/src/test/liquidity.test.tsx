import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { MemoryRouter } from 'react-router';
import { SwapCard } from '../components/SwapCard';
import { SolverProvider } from '../lib/solver/SolverProvider';
import { MockSolverClient } from '../lib/solver/mock';

describe('Liquidity availability and typed refusals (FR-18)', () => {
  it('displays available route liquidity before the user types', async () => {
    render(
      <MemoryRouter>
        <SolverProvider client={new MockSolverClient()}>
          <SwapCard />
        </SolverProvider>
      </MemoryRouter>,
    );

    const liquidityBadge = screen.getByTestId('liquidity-available');
    expect(liquidityBadge).toBeInTheDocument();
    expect(liquidityBadge).toHaveTextContent(/Available:/i);

    await waitFor(() => {
      expect(liquidityBadge).toHaveTextContent(/5,000/i);
    });
  });

  it('renders INSUFFICIENT_LIQUIDITY refusal with Fill maximum button when amount exceeds liquidity', async () => {
    render(
      <MemoryRouter>
        <SolverProvider client={new MockSolverClient()}>
          <SwapCard />
        </SolverProvider>
      </MemoryRouter>,
    );

    const input = screen.getByLabelText(/You send/i);
    fireEvent.change(input, { target: { value: '6000' } });

    await waitFor(() => {
      expect(screen.getByTestId('quote-refusal')).toBeInTheDocument();
    });

    const fillMaxBtn = screen.getByRole('button', { name: /Fill maximum/i });
    expect(fillMaxBtn).toBeInTheDocument();

    // Clicking "Fill maximum" populates input with 5000.00
    fireEvent.click(fillMaxBtn);
    expect(input).toHaveValue(5000);
  });

  it('renders typed refusal when solver returns PEG_GUARD', async () => {
    const mockClient = new MockSolverClient();
    mockClient.getQuote = async () => ({
      fromToken: 'USDC',
      toToken: 'tPUSD',
      fromAmount: 100,
      toAmount: 0,
      exchangeRate: 1,
      spreadBps: 40,
      estimatedSeconds: 60,
      expiresInSeconds: 120,
      refusal: {
        reason: 'PEG_GUARD',
        asset: 'PUSD',
      },
    });

    render(
      <MemoryRouter>
        <SolverProvider client={mockClient}>
          <SwapCard />
        </SolverProvider>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('quote-refusal')).toBeInTheDocument();
    });

    expect(
      screen.getByText(
        /Quoting paused for PUSD because the peg guard is active/i,
      ),
    ).toBeInTheDocument();
  });

  it('renders typed refusal when solver returns OVER_MAX_SWAP', async () => {
    const mockClient = new MockSolverClient();
    mockClient.getQuote = async () => ({
      fromToken: 'USDC',
      toToken: 'tPUSD',
      fromAmount: 100000,
      toAmount: 0,
      exchangeRate: 1,
      spreadBps: 40,
      estimatedSeconds: 60,
      expiresInSeconds: 120,
      refusal: {
        reason: 'OVER_MAX_SWAP',
        asset: 'USDC',
        maxAmount: '10000.00',
      },
    });

    render(
      <MemoryRouter>
        <SolverProvider client={mockClient}>
          <SwapCard />
        </SolverProvider>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('quote-refusal')).toBeInTheDocument();
    });

    expect(
      screen.getByText(
        /Swap exceeds the 10000.00 USDC maximum; try 10000.00 or less/i,
      ),
    ).toBeInTheDocument();
  });
});
