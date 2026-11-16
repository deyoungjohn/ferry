import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router';
import { RouteStatusPage } from '../routes/RouteStatusPage';
import { SolverProvider } from '../lib/solver/SolverProvider';
import { MockSolverClient } from '../lib/solver/mock';
import type { SolverClient } from '../lib/solver/types';

describe('Route Check Page (/status) (Task B3-07)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    sessionStorage.clear();
  });

  function renderPage(client: SolverClient = new MockSolverClient()) {
    return render(
      <MemoryRouter initialEntries={['/status']}>
        <SolverProvider client={client}>
          <RouteStatusPage />
        </SolverProvider>
      </MemoryRouter>,
    );
  }

  it('1. renders healthy route states with solver reachable, liquidity, and green reasons', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId('solver-health-badge')).toHaveTextContent(
        /Solver Reachable/i,
      );
    });

    expect(screen.getByTestId('quoting-status-badge')).toHaveTextContent(
      /Quoting Active/i,
    );
    expect(screen.getByTestId('enabled-routes-count')).toBeInTheDocument();

    // Check that at least one green route card is rendered
    const greenPills = screen.getAllByTestId('route-status-green');
    expect(greenPills.length).toBeGreaterThan(0);

    // Check available liquidity and price evidence
    const liquidityValues = screen.getAllByTestId('route-available-liquidity');
    expect(liquidityValues.length).toBeGreaterThan(0);
    expect(liquidityValues[0]).toHaveTextContent(/(USDC|tPUSD)/);

    const priceEvidenceValues = screen.getAllByTestId('route-price-evidence');
    expect(priceEvidenceValues.length).toBeGreaterThan(0);
    expect(priceEvidenceValues[0]).toHaveTextContent(/Cauldron/i);

    // Check plain green diagnosis
    const reasons = screen.getAllByTestId('route-reason');
    expect(reasons[0]).toHaveTextContent(/Quoting active/i);
  });

  it('2. handles solver unreachable state with plain red diagnosis', async () => {
    const unreachableClient = new MockSolverClient();
    vi.spyOn(unreachableClient, 'getHealth').mockRejectedValue(
      new Error('Connection refused'),
    );
    vi.spyOn(unreachableClient, 'getLiquidity').mockRejectedValue(
      new Error('Network error'),
    );

    renderPage(unreachableClient);

    await waitFor(() => {
      expect(screen.getByTestId('solver-health-badge')).toHaveTextContent(
        /Solver Unreachable/i,
      );
    });

    const redPills = screen.getAllByTestId('route-status-red');
    expect(redPills.length).toBeGreaterThan(0);

    const reasons = screen.getAllByTestId('route-reason');
    expect(reasons[0]).toHaveTextContent(
      /Solver is currently unreachable over network/i,
    );
  });

  it('3. renders disabled route state with plain red reason from chain facts', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId('routes-list')).toBeInTheDocument();
    });

    // Find cards with disabled routes (e.g. BNB or Robinhood in testnet)
    const disabledCards = screen.queryAllByText(/Route Disabled/i);
    expect(disabledCards.length).toBeGreaterThan(0);

    // Assert red reason on disabled route
    const redPills = screen.getAllByTestId('route-status-red');
    expect(redPills.length).toBeGreaterThan(0);
  });

  it('4. renders quoting paused state with red diagnosis when operator pauses quotes', async () => {
    const pausedClient = new MockSolverClient();
    vi.spyOn(pausedClient, 'getHealth').mockResolvedValue({
      ok: true,
      quotingEnabled: false,
      timestamp: Math.floor(Date.now() / 1000),
    });

    renderPage(pausedClient);

    await waitFor(() => {
      expect(screen.getByTestId('quoting-status-badge')).toHaveTextContent(
        /Quoting Paused/i,
      );
    });

    const reasons = screen.getAllByTestId('route-reason');
    expect(reasons[0]).toHaveTextContent(
      /Solver quoting is globally paused by operator/i,
    );
  });

  it('5. runs quote-only dry-run test suite across routes without locking funds', async () => {
    const mockClient = new MockSolverClient();
    const getQuoteSpy = vi.spyOn(mockClient, 'getQuote');
    const createOrderSpy = vi.spyOn(mockClient, 'createOrder');

    renderPage(mockClient);

    await waitFor(() => {
      expect(screen.getByTestId('test-all-routes-button')).toBeInTheDocument();
    });

    const testAllBtn = screen.getByTestId('test-all-routes-button');
    fireEvent.click(testAllBtn);

    await waitFor(() => {
      expect(getQuoteSpy).toHaveBeenCalled();
    });

    // CRITICAL: Must be quote-only and NEVER lock funds or create orders
    expect(createOrderSpy).not.toHaveBeenCalled();

    // Check that test result appeared
    await waitFor(() => {
      const results = screen.getAllByTestId('route-test-result');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]).toHaveTextContent(/Quote dry-run succeeded/i);
    });
  });

  it('6. displays red refusal when test quote is declined by solver', async () => {
    const mockClient = new MockSolverClient();
    vi.spyOn(mockClient, 'getQuote').mockResolvedValue({
      fromToken: 'USDC',
      toToken: 'tPUSD',
      fromAmount: 1.0,
      toAmount: 0,
      exchangeRate: 0,
      estimatedSeconds: 45,
      spreadBps: 20,
      expiresInSeconds: 60,
      refusal: {
        reason: 'INSUFFICIENT_LIQUIDITY',
        maxAmount: '0',
        asset: 'tPUSD',
        message: 'Insufficient inventory for route',
      },
    });

    renderPage(mockClient);

    await waitFor(() => {
      expect(screen.getByTestId('test-all-routes-button')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('test-all-routes-button'));

    await waitFor(() => {
      const results = screen.getAllByTestId('route-test-result');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]).toHaveTextContent(/Insufficient inventory for route/i);
    });

    const reasons = screen.getAllByTestId('route-reason');
    expect(reasons[0]).toHaveTextContent(/Quote refused/i);
  });

  it('7. accepts operator token in memory only and queries operator telemetry', async () => {
    const mockClient = new MockSolverClient();
    const operatorSpy = vi.spyOn(mockClient, 'getOperatorRoutes');

    renderPage(mockClient);

    await waitFor(() => {
      expect(screen.getByTestId('operator-token-input')).toBeInTheDocument();
    });

    const input = screen.getByTestId('operator-token-input');
    const button = screen.getByTestId('operator-token-button');

    fireEvent.change(input, {
      target: { value: 'secret-operator-token-123' },
    });
    fireEvent.click(button);

    await waitFor(() => {
      expect(operatorSpy).toHaveBeenCalledWith('secret-operator-token-123');
    });

    await waitFor(() => {
      expect(screen.getByTestId('operator-telemetry-view')).toBeInTheDocument();
    });

    // Verify token was NOT stored in storage
    expect(localStorage.getItem('operatorToken')).toBeNull();
    expect(sessionStorage.getItem('operatorToken')).toBeNull();
  });
});
