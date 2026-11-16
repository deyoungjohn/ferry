import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import axe from 'axe-core';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, it, expect, vi } from 'vitest';
import { HomePage } from '../routes/HomePage';
import { SwapStatusPage } from '../routes/SwapStatusPage';
import { ActivityPage } from '../routes/ActivityPage';
import { RecoverPage } from '../routes/RecoverPage';
import { PayLinksPage } from '../routes/PayLinksPage';
import { PayLinkPage } from '../routes/PayLinkPage';
import { SendLinksPage } from '../routes/SendLinksPage';
import { SendLinkPage } from '../routes/SendLinkPage';
import { RouteStatusPage } from '../routes/RouteStatusPage';
import { HelpPage } from '../routes/HelpPage';
import { NotFoundPage } from '../routes/NotFoundPage';
import { NetworkBlockedPage } from '../components/NetworkBlockedPage';
import { SwapCard } from '../components/SwapCard';
import { SolverProvider } from '../lib/solver/SolverProvider';
import { MockSolverClient } from '../lib/solver/mock';
import type { SwapOrder } from '../lib/solver/types';

async function checkA11y(container: HTMLElement) {
  const results = await axe.run(container);
  const violations = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  if (violations.length > 0) {
    console.error(
      'A11y violations found:',
      JSON.stringify(violations, null, 2),
    );
  }
  expect(violations).toEqual([]);
}

describe('Accessibility Audit (axe-core): Every Route', () => {
  it('1. HomePage (/) has zero serious or critical violations', async () => {
    const { container } = render(
      <MemoryRouter>
        <SolverProvider client={new MockSolverClient()}>
          <HomePage />
        </SolverProvider>
      </MemoryRouter>,
    );
    await checkA11y(container);
  });

  it('2. SwapStatusPage (/swap/:orderId) has zero serious or critical violations', async () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/swap/ord_chipnet_test123']}>
        <SolverProvider client={new MockSolverClient()}>
          <Routes>
            <Route path="/swap/:orderId" element={<SwapStatusPage />} />
          </Routes>
        </SolverProvider>
      </MemoryRouter>,
    );
    await checkA11y(container);
  });

  it('3. ActivityPage (/activity) has zero serious or critical violations', async () => {
    const { container } = render(
      <MemoryRouter>
        <ActivityPage />
      </MemoryRouter>,
    );
    await checkA11y(container);
  });

  it('4. RecoverPage (/recover) has zero serious or critical violations', async () => {
    const { container } = render(
      <MemoryRouter>
        <RecoverPage />
      </MemoryRouter>,
    );
    await checkA11y(container);
  });

  it('5. PayLinksPage (/pay-links) has zero serious or critical violations', async () => {
    const { container } = render(
      <MemoryRouter>
        <PayLinksPage />
      </MemoryRouter>,
    );
    await checkA11y(container);
  });

  it('6. PayLinkPage (/p/:id) has zero serious or critical violations', async () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/p/pl-test-01']}>
        <SolverProvider client={new MockSolverClient()}>
          <Routes>
            <Route path="/p/:id" element={<PayLinkPage />} />
          </Routes>
        </SolverProvider>
      </MemoryRouter>,
    );
    await checkA11y(container);
  });

  it('7. SendLinksPage (/send-links) has zero serious or critical violations', async () => {
    const { container } = render(
      <MemoryRouter>
        <SendLinksPage />
      </MemoryRouter>,
    );
    await checkA11y(container);
  });

  it('8. SendLinkPage (/s/:id) has zero serious or critical violations', async () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/s/sl-test-01']}>
        <SolverProvider client={new MockSolverClient()}>
          <Routes>
            <Route path="/s/:id" element={<SendLinkPage />} />
          </Routes>
        </SolverProvider>
      </MemoryRouter>,
    );
    await checkA11y(container);
  });

  it('9. RouteStatusPage (/status) has zero serious or critical violations', async () => {
    const { container } = render(
      <MemoryRouter>
        <SolverProvider client={new MockSolverClient()}>
          <RouteStatusPage />
        </SolverProvider>
      </MemoryRouter>,
    );
    await checkA11y(container);
  });

  it('10. HelpPage (/help) has zero serious or critical violations', async () => {
    const { container } = render(
      <MemoryRouter>
        <HelpPage />
      </MemoryRouter>,
    );
    await checkA11y(container);
  });

  it('11. NotFoundPage (*) has zero serious or critical violations', async () => {
    const { container } = render(
      <MemoryRouter>
        <NotFoundPage />
      </MemoryRouter>,
    );
    await checkA11y(container);
  });
});

describe('Accessibility Audit (axe-core): Every Failure State', () => {
  it('1. NetworkBlockedPage has zero serious or critical violations', async () => {
    const { container } = render(
      <MemoryRouter>
        <NetworkBlockedPage />
      </MemoryRouter>,
    );
    await checkA11y(container);
  });

  it('2. SwapCard solver unreachable failure state has zero serious or critical violations', async () => {
    const { container } = render(
      <MemoryRouter>
        <SolverProvider client={new MockSolverClient()}>
          <SwapCard initialFailureState="solver_unreachable" />
        </SolverProvider>
      </MemoryRouter>,
    );
    await checkA11y(container);
  });

  it('3. SwapCard all solvers refused failure state has zero serious or critical violations', async () => {
    const { container } = render(
      <MemoryRouter>
        <SolverProvider client={new MockSolverClient()}>
          <SwapCard
            initialRecipient="0x1111222233334444555566667777888899990000"
            initialFailureState="all_solvers_refused"
          />
        </SolverProvider>
      </MemoryRouter>,
    );
    await checkA11y(container);
  });

  it('4. SwapCard quote expired failure state has zero serious or critical violations', async () => {
    const { container } = render(
      <MemoryRouter>
        <SolverProvider client={new MockSolverClient()}>
          <SwapCard initialFailureState="quote_expired" />
        </SolverProvider>
      </MemoryRouter>,
    );
    await checkA11y(container);
  });

  it('5. SwapStatusPage late counter-lock alert state has zero serious or critical violations', async () => {
    const mockOrder: SwapOrder = {
      id: 'late-order-123',
      status: 'USER_LOCK_FINAL',
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

    const { container } = render(
      <MemoryRouter initialEntries={['/swap/late-order-123']}>
        <SolverProvider client={mockClient}>
          <Routes>
            <Route path="/swap/:orderId" element={<SwapStatusPage />} />
          </Routes>
        </SolverProvider>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('counter-lock-late-alert')).toBeInTheDocument();
    });

    await checkA11y(container);
  });

  it('6. RecoverPage invalid recovery JSON error alert has zero serious or critical violations', async () => {
    const { container } = render(
      <MemoryRouter>
        <RecoverPage />
      </MemoryRouter>,
    );

    const textarea = screen.getByLabelText(/Or paste recovery file JSON:/i);
    const loadBtn = screen.getByRole('button', { name: /Load File/i });

    fireEvent.change(textarea, { target: { value: '{ bad-json' } });
    fireEvent.click(loadBtn);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    await checkA11y(container);
  });
});
