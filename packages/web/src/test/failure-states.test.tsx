import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router';
import { SwapCard } from '../components/SwapCard';
import { SwapStatusPage } from '../routes/SwapStatusPage';
import { SolverProvider } from '../lib/solver/SolverProvider';
import { MockSolverClient } from '../lib/solver/mock';
import type { SwapOrder } from '../lib/solver/types';
import { FAILURE_COPY } from '../lib/copy';

describe('Failure States Handling', () => {
  it('1. solver unreachable: renders alert and allows switching to read-only mode', () => {
    render(
      <MemoryRouter>
        <SolverProvider client={new MockSolverClient()}>
          <SwapCard initialFailureState="solver_unreachable" />
        </SolverProvider>
      </MemoryRouter>,
    );

    expect(screen.getByTestId('solver-unreachable-alert')).toBeInTheDocument();
    expect(
      screen.getByText(FAILURE_COPY.solverUnreachable.title),
    ).toBeInTheDocument();
    expect(
      screen.getByText(FAILURE_COPY.solverUnreachable.message),
    ).toBeInTheDocument();

    const switchBtn = screen.getByTestId('switch-read-only-button');
    fireEvent.click(switchBtn);

    // Now enters read-only mode
    expect(screen.getByTestId('read-only-banner')).toBeInTheDocument();
  });

  it('2. all solvers refusing: renders refusal alert and disables submit', () => {
    render(
      <MemoryRouter>
        <SolverProvider client={new MockSolverClient()}>
          <SwapCard
            initialRecipient="0x1111222233334444555566667777888899990000"
            initialFailureState="all_solvers_refused"
          />
        </SolverProvider>
      </MemoryRouter>,
    );

    expect(
      screen.getByTestId('all-solvers-refusing-alert'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(FAILURE_COPY.allSolversRefused.title),
    ).toBeInTheDocument();

    const submitBtn = screen.getByTestId('swap-submit-button');
    expect(submitBtn).toBeDisabled();
  });

  it('3. quote expired while signing: renders quote expired alert with refresh button', () => {
    render(
      <MemoryRouter>
        <SolverProvider client={new MockSolverClient()}>
          <SwapCard initialFailureState="quote_expired" />
        </SolverProvider>
      </MemoryRouter>,
    );

    expect(screen.getByTestId('quote-expired-alert')).toBeInTheDocument();
    expect(
      screen.getByText(FAILURE_COPY.quoteExpired.title),
    ).toBeInTheDocument();

    const refreshBtn = screen.getByTestId('refresh-quote-button');
    fireEvent.click(refreshBtn);

    expect(screen.queryByTestId('quote-expired-alert')).not.toBeInTheDocument();
  });

  it('4. wallet rejected: renders wallet rejected alert with retry button', () => {
    render(
      <MemoryRouter>
        <SolverProvider client={new MockSolverClient()}>
          <SwapCard initialFailureState="wallet_rejected" />
        </SolverProvider>
      </MemoryRouter>,
    );

    expect(screen.getByTestId('wallet-rejected-alert')).toBeInTheDocument();
    expect(
      screen.getByText(FAILURE_COPY.walletRejected.title),
    ).toBeInTheDocument();

    const retryBtn = screen.getByTestId('try-again-button');
    fireEvent.click(retryBtn);

    expect(
      screen.queryByTestId('wallet-rejected-alert'),
    ).not.toBeInTheDocument();
  });

  it('5. wrong network: renders wrong network alert with switch network button', () => {
    render(
      <MemoryRouter>
        <SolverProvider client={new MockSolverClient()}>
          <SwapCard initialFailureState="wrong_network" />
        </SolverProvider>
      </MemoryRouter>,
    );

    expect(screen.getByTestId('wrong-network-alert')).toBeInTheDocument();
    expect(
      screen.getByText(FAILURE_COPY.wrongNetwork.title),
    ).toBeInTheDocument();

    const switchNetBtn = screen.getByTestId('switch-network-button');
    fireEvent.click(switchNetBtn);

    expect(screen.queryByTestId('wrong-network-alert')).not.toBeInTheDocument();
  });

  it('6. lock seen but counter-lock late on status page: renders refund countdown and action guide', async () => {
    const mockOrder: SwapOrder = {
      id: 'late-order-123',
      status: 'USER_LOCK_FINAL', // User locked, but solver counter-lock not seen
      mode: 'swap',
      lane: 'safe',
      fromToken: 'tPUSD',
      toToken: 'USDC',
      fromAmount: 10.0,
      toAmount: 9.98,
      fromChain: 'bch',
      toChain: 'base',
      userAddress: '0x1111222233334444555566667777888899990000',
      recipientAddress: '0x1111222233334444555566667777888899990000',
      solverAddress: '0x2222333344445555666677778888999900001111',
      currentConfirmations: 1,
      requiredConfirmations: 1,
      elapsedSeconds: 150,
      estimatedSecondsRemaining: 0,
      waitDescription: 'Solver counter-lock is taking longer than expected',
      isMock: true,
      transactions: [],
      createdAtSeconds: Date.now() / 1000 - 150,
      updatedAtSeconds: Date.now() / 1000,
    };

    const mockClient = new MockSolverClient();
    vi.spyOn(mockClient, 'getOrder').mockResolvedValue(mockOrder);

    render(
      <MemoryRouter initialEntries={['/swap/late-order-123']}>
        <SolverProvider client={mockClient}>
          <Routes>
            <Route path="/swap/:orderId" element={<SwapStatusPage />} />
          </Routes>
        </SolverProvider>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('status-plain-words')).toHaveTextContent(
        /Deposit Confirmed · Solver Locking/i,
      );
    });

    expect(screen.getByTestId('counter-lock-late-alert')).toBeInTheDocument();
    expect(
      screen.getByText(FAILURE_COPY.counterLockLate.title),
    ).toBeInTheDocument();
    expect(screen.getByText(/Refund Countdown:/i)).toBeInTheDocument();
  });

  it('7. degraded read-only mode: renders banner and disables submission', () => {
    render(
      <MemoryRouter>
        <SolverProvider client={new MockSolverClient()}>
          <SwapCard
            initialRecipient="0x1111222233334444555566667777888899990000"
            initialFailureState="read_only"
          />
        </SolverProvider>
      </MemoryRouter>,
    );

    expect(screen.getByTestId('read-only-banner')).toBeInTheDocument();
    expect(
      screen.getByText(FAILURE_COPY.readOnlyMode.banner),
    ).toBeInTheDocument();

    const submitBtn = screen.getByTestId('swap-submit-button');
    expect(submitBtn).toBeDisabled();
    expect(submitBtn).toHaveTextContent(FAILURE_COPY.readOnlyMode.button);
  });
});
