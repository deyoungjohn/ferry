import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router';
import { SwapStatusPage } from '../routes/SwapStatusPage';
import { SolverProvider } from '../lib/solver/SolverProvider';
import { MockSolverClient } from '../lib/solver/mock';

describe('SwapStatusPage (/swap/:orderId)', () => {
  function renderWithOrder(orderId: string) {
    const client = new MockSolverClient();
    return render(
      <MemoryRouter initialEntries={[`/swap/${orderId}`]}>
        <SolverProvider client={client}>
          <Routes>
            <Route path="/swap/:orderId" element={<SwapStatusPage />} />
          </Routes>
        </SolverProvider>
      </MemoryRouter>,
    );
  }

  it('renders completed swap order with separated user and solver steps', async () => {
    renderWithOrder('mock-01');

    await waitFor(() => {
      expect(screen.getByText('Swap Status')).toBeInTheDocument();
    });

    // Check header & badges
    expect(screen.getByTestId('mock-order-badge')).toBeInTheDocument();
    expect(screen.getByText('DONE')).toBeInTheDocument();

    // Check amounts
    expect(screen.getByText('20.00 USDC')).toBeInTheDocument();
    expect(screen.getByText('19.87 tPUSD')).toBeInTheDocument();

    // Check current wait state banner
    const waitBanner = screen.getByTestId('wait-state-banner');
    expect(waitBanner).toHaveTextContent(/Swap completed successfully/i);

    // Separated step sections
    expect(screen.getByText(/Your Steps \(User\)/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Solver Steps \(Counterparty\)/i),
    ).toBeInTheDocument();

    // User steps
    expect(
      screen.getByText(/1\. Lock USDC on Base Sepolia/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/2\. Claim tPUSD on Bitcoin Cash Chipnet/i),
    ).toBeInTheDocument();

    // Solver steps
    expect(
      screen.getByText(/1\. Counter-Lock tPUSD on Bitcoin Cash Chipnet/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/2\. Solver Finalises Settlement/i),
    ).toBeInTheDocument();

    // Transactions list
    expect(screen.getByText('User Lock Transaction')).toBeInTheDocument();
    expect(screen.getByText('Solver Counter-Lock')).toBeInTheDocument();
    expect(screen.getByText('User Claim Transaction')).toBeInTheDocument();

    // Safe mock tx check: no external explorer link
    const links = screen.queryAllByRole('link');
    for (const link of links) {
      const href = link.getAttribute('href') ?? '';
      expect(href).not.toContain('basescan');
      expect(href).not.toContain('etherscan');
      expect(href).not.toContain('bch');
    }
  });

  it('renders in-progress USER_LOCK_SEEN order with block confirmation countdown and wait description', async () => {
    renderWithOrder('mock-lock-seen');

    await waitFor(() => {
      expect(screen.getByText('USER_LOCK_SEEN')).toBeInTheDocument();
    });

    const waitBanner = screen.getByTestId('wait-state-banner');
    expect(waitBanner).toHaveTextContent(
      'Waiting for block confirmation (0 of 1 confirmations)...',
    );
    expect(waitBanner).toHaveTextContent('~45s remaining');
    expect(waitBanner).toHaveTextContent('elapsed: 15s');
    expect(waitBanner).toHaveTextContent('0 of 1');
  });

  it('renders SOLVER_LOCK_FINAL with solver counter-lock confirmed and user ready to claim', async () => {
    renderWithOrder('mock-claim');

    await waitFor(() => {
      expect(screen.getByText('SOLVER_LOCK_FINAL')).toBeInTheDocument();
    });

    const waitBanner = screen.getByTestId('wait-state-banner');
    expect(waitBanner).toHaveTextContent(
      'Waiting for user claim submission...',
    );
    expect(screen.getByText('Ready to claim')).toBeInTheDocument();
  });

  it('renders pay-link mode with distinct copy ("Payment Status", "You pay", "They receive")', async () => {
    renderWithOrder('mock-paylink-01');

    await waitFor(() => {
      expect(screen.getByText('Payment Status')).toBeInTheDocument();
    });

    expect(screen.getByText('You pay')).toBeInTheDocument();
    expect(screen.getByText('They receive')).toBeInTheDocument();
  });

  it('renders send-link mode with distinct copy ("Transfer Status", "You send", "They receive")', async () => {
    renderWithOrder('mock-sendlink-01');

    await waitFor(() => {
      expect(screen.getByText('Transfer Status')).toBeInTheDocument();
    });

    expect(screen.getByText('You send')).toBeInTheDocument();
    expect(screen.getByText('They receive')).toBeInTheDocument();
  });

  it('renders honest not-found state when order does not exist', async () => {
    renderWithOrder('not-found');

    await waitFor(() => {
      expect(screen.getByText('Order Not Found')).toBeInTheDocument();
    });

    expect(
      screen.getByText(/could not be found or has not been indexed yet/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /Return to Swap/i }),
    ).toHaveAttribute('href', '/');
  });
});
