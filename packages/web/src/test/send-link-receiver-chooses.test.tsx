import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router';
import { SendLinkPage } from '../routes/SendLinkPage';
import { SolverProvider } from '../lib/solver/SolverProvider';
import { WalletContext } from '../lib/wallet/context';
import type { SendLinkView, SolverClient } from '../lib/solver/types';
import type { SendLinkSolverPort } from '../lib/send/ports';
import type { Hex, Hex32, LiquidityResponse } from '@ferry/core';

describe('SendLinkPage: Receiver chooses destination route', () => {
  const recipientAddress = '0x1111111111111111111111111111111111111111' as Hex;
  const strangerAddress = '0x9999999999999999999999999999999999999999' as Hex;
  const dummySecret = ('0x' + '33'.repeat(32)) as Hex32;
  const orderId = ('0x' + '44'.repeat(32)) as Hex32;

  const mockLiquidity: LiquidityResponse = {
    asOf: Math.floor(Date.now() / 1000),
    routes: [
      {
        route: 'usdc:base',
        asset: 'USDC',
        decimals: 6,
        available: '5000000', // 5 USDC (insufficient for 20 USDC)
        inventory: '5000000',
        exposure: '0',
        reserved: '0',
      },
      {
        route: 'usdc:arbitrum',
        asset: 'USDC',
        decimals: 6,
        available: '100000000000', // 100,000 USDC (sufficient)
        inventory: '100000000000',
        exposure: '0',
        reserved: '0',
      },
      {
        route: 'usdc:ethereum',
        asset: 'USDC',
        decimals: 6,
        available: '50000000000', // 50,000 USDC (sufficient)
        inventory: '50000000000',
        exposure: '0',
        reserved: '0',
      },
    ],
  };

  function createMockSolver(
    view: SendLinkView | null,
    extraOverrides: Partial<SolverClient> = {},
  ): SolverClient {
    return {
      isLive: () => true,
      getLabel: () => 'Mock Solver',
      getQuote: vi.fn(),
      getLiquidity: vi.fn(async () => mockLiquidity),
      getStats: vi.fn(),
      getRecentSwaps: vi.fn(),
      getPegPrices: vi.fn(),
      getOrder: vi.fn(),
      getSendLink: vi.fn(async () => view),
      switchSendLinkRoute: vi.fn(async (_id, req) => ({
        ok: true,
        originalOrderId: orderId,
        newOrderId: ('0x' + 'aa'.repeat(32)) as `0x${string}`,
        chainId: req.chainId,
        token: req.token,
        evmAmount: 20_000_000n,
        expiresAt: Math.floor(Date.now() / 1000) + 7200,
        updatedAt: Math.floor(Date.now() / 1000),
      })),
      confirmSendLinkRoute: vi.fn(async (_id, req) => ({
        ok: true,
        orderId,
        chainId: req.chainId ?? 8453,
        token: req.token ?? '0x' + 'aa'.repeat(20),
        status: 'confirmed',
        confirmedAt: Math.floor(Date.now() / 1000),
      })),
      relayClaim: vi.fn(async () => ({
        ok: true,
        orderId,
        txHash: ('0x' + '55'.repeat(32)) as Hex32,
      })),
      ...extraOverrides,
    } as unknown as SolverClient;
  }

  it('surfaces liquidity shortage clearly and offers buttons for alternative routes with liquidity', async () => {
    const view: SendLinkView = {
      id: orderId,
      orderId,
      status: 'pending_lock',
      amount: 20, // 20 USDC > 5 USDC available on Base
      token: 'USDC',
      chain: 'Base',
      recipientEvmAddress: recipientAddress,
      expiresAt: Math.floor(Date.now() / 1000) + 7200,
    };

    const solver = createMockSolver(view);

    render(
      <SolverProvider client={solver}>
        <MemoryRouter
          initialEntries={[`/s/${orderId}#${dummySecret.slice(2)}`]}
        >
          <Routes>
            <Route
              path="/s/:id"
              element={<SendLinkPage initialSecret={dummySecret} />}
            />
          </Routes>
        </MemoryRouter>
      </SolverProvider>,
    );

    // Warning banner is displayed
    const warning = await screen.findByTestId('send-link-liquidity-warning');
    expect(warning).toBeInTheDocument();
    expect(warning).toHaveTextContent('Not enough liquidity on Base right now');

    // Alternative route buttons are displayed for routes with liquidity
    expect(screen.getByTestId('switch-route-arbitrum')).toBeInTheDocument();
    expect(screen.getByTestId('switch-route-ethereum')).toBeInTheDocument();
  });

  it('allows receiver to switch route before solver lock with EIP-712 signature', async () => {
    // As the solver answers: the link is open, held, and already carries its lock id (computed
    // from the terms before any lock exists).
    const view: SendLinkView = {
      id: orderId,
      orderId,
      status: 'open',
      lockId: ('0x' + '33'.repeat(32)) as Hex32,
      isHeld: true,
      amount: 20,
      token: 'USDC',
      chain: 'Base',
      recipientEvmAddress: recipientAddress,
      expiresAt: Math.floor(Date.now() / 1000) + 7200,
    };

    const solver = createMockSolver(view);
    const signTypedDataMock = vi.fn(
      async () => ('0x' + '88'.repeat(65)) as Hex,
    );

    const mockWallets = {
      evm: {
        status: 'connected' as const,
        address: recipientAddress,
        chainId: 8453,
        connect: vi.fn(),
        disconnect: vi.fn(),
        switchChain: vi.fn(),
        signTypedData: signTypedDataMock,
      },
      bch: null,
    };

    render(
      <WalletContext.Provider value={mockWallets as never}>
        <SolverProvider client={solver}>
          <MemoryRouter
            initialEntries={[`/s/${orderId}#${dummySecret.slice(2)}`]}
          >
            <Routes>
              <Route
                path="/s/:id"
                element={
                  <SendLinkPage
                    isLive={true}
                    initialSecret={dummySecret}
                    dependencies={{
                      solver: solver as unknown as SendLinkSolverPort,
                    }}
                  />
                }
              />
            </Routes>
          </MemoryRouter>
        </SolverProvider>
      </WalletContext.Provider>,
    );

    const switchBtn = await screen.findByTestId('switch-route-arbitrum');
    fireEvent.click(switchBtn);

    const claimBtn = screen.getByTestId('send-link-submit-button');
    fireEvent.click(claimBtn);

    await waitFor(() => {
      // One signature switches the route; claiming the open link then signs the claim request.
      expect(signTypedDataMock).toHaveBeenCalled();
      expect(solver.switchSendLinkRoute).toHaveBeenCalledWith(
        orderId,
        expect.objectContaining({
          chainId: 42161, // Arbitrum One
          signature: expect.stringMatching(/^0x/),
        }),
      );
    });
  });

  it('refuses switch and warns when stranger tries to sign switch request', async () => {
    const view: SendLinkView = {
      id: orderId,
      orderId,
      status: 'pending_lock',
      amount: 20,
      token: 'USDC',
      chain: 'Base',
      recipientEvmAddress: recipientAddress,
      expiresAt: Math.floor(Date.now() / 1000) + 7200,
    };

    const solver = createMockSolver(view);
    const signTypedDataMock = vi.fn();

    const mockWallets = {
      evm: {
        status: 'connected' as const,
        address: strangerAddress, // Stranger connected!
        chainId: 8453,
        connect: vi.fn(),
        disconnect: vi.fn(),
        switchChain: vi.fn(),
        signTypedData: signTypedDataMock,
      },
      bch: null,
    };

    render(
      <WalletContext.Provider value={mockWallets as never}>
        <SolverProvider client={solver}>
          <MemoryRouter
            initialEntries={[`/s/${orderId}#${dummySecret.slice(2)}`]}
          >
            <Routes>
              <Route
                path="/s/:id"
                element={
                  <SendLinkPage
                    isLive={true}
                    initialSecret={dummySecret}
                    dependencies={{
                      solver: solver as unknown as SendLinkSolverPort,
                    }}
                  />
                }
              />
            </Routes>
          </MemoryRouter>
        </SolverProvider>
      </WalletContext.Provider>,
    );

    const switchBtn = await screen.findByTestId('switch-route-arbitrum');
    fireEvent.click(switchBtn);

    await waitFor(() => {
      expect(signTypedDataMock).not.toHaveBeenCalled();
      expect(solver.switchSendLinkRoute).not.toHaveBeenCalled();
      expect(screen.getByRole('alert')).toHaveTextContent(
        `Only ${recipientAddress} can change this route: sign the switch request with that wallet`,
      );
    });
  });

  it('refuses claim and switch when remaining time before refund is less than 30 minutes safety margin', async () => {
    const view: SendLinkView = {
      id: orderId,
      orderId,
      status: 'open',
      amount: 20,
      token: 'USDC',
      chain: 'Base',
      recipientEvmAddress: recipientAddress,
      expiresAt: Math.floor(Date.now() / 1000) + 15 * 60, // 15 minutes left (< 30 min safety margin)
    };

    const solver = createMockSolver(view);

    render(
      <SolverProvider client={solver}>
        <MemoryRouter
          initialEntries={[`/s/${orderId}#${dummySecret.slice(2)}`]}
        >
          <Routes>
            <Route
              path="/s/:id"
              element={<SendLinkPage initialSecret={dummySecret} />}
            />
          </Routes>
        </MemoryRouter>
      </SolverProvider>,
    );

    const notice = await screen.findByTestId('send-link-too-late-notice');
    expect(notice).toBeInTheDocument();
    expect(notice).toHaveTextContent(
      'This send link can no longer be claimed in time. The sender will receive a refund on Bitcoin Cash.',
    );

    // Shows time left
    const timeLeft = screen.getByTestId('send-link-time-left');
    expect(timeLeft).toBeInTheDocument();
    expect(timeLeft).toHaveTextContent(/1[45]m left/);

    // Claim button is disabled
    const claimBtn = screen.getByTestId('send-link-submit-button');
    expect(claimBtn).toBeDisabled();
    expect(claimBtn).toHaveTextContent(/cannot be claimed in time/i);
  });

  it('automatically switches wallet chain on claim when wallet is connected to a different network', async () => {
    const view: SendLinkView = {
      id: orderId,
      orderId,
      lockId: ('0x' + '22'.repeat(32)) as Hex32,
      chainId: 42161, // Link is on Arbitrum
      status: 'open',
      amount: 20,
      token: 'USDC',
      chain: 'Arbitrum',
      recipientEvmAddress: recipientAddress,
      expiresAt: Math.floor(Date.now() / 1000) + 7200,
    };

    const solver = createMockSolver(view);
    const switchChainMock = vi.fn(async () => {});

    const mockWallets = {
      evm: {
        status: 'connected' as const,
        address: recipientAddress,
        chainId: 8453, // Wallet is currently on Base!
        connect: vi.fn(),
        disconnect: vi.fn(),
        switchChain: switchChainMock,
        signTypedData: vi.fn(async () => ('0x' + '11'.repeat(65)) as Hex),
      },
      bch: null,
    };

    render(
      <WalletContext.Provider value={mockWallets as never}>
        <SolverProvider client={solver}>
          <MemoryRouter
            initialEntries={[`/s/${orderId}#${dummySecret.slice(2)}`]}
          >
            <Routes>
              <Route
                path="/s/:id"
                element={
                  <SendLinkPage
                    isLive={true}
                    initialSecret={dummySecret}
                    dependencies={{
                      solver: solver as unknown as SendLinkSolverPort,
                    }}
                  />
                }
              />
            </Routes>
          </MemoryRouter>
        </SolverProvider>
      </WalletContext.Provider>,
    );

    const claimBtn = await screen.findByTestId('send-link-submit-button');
    expect(claimBtn).not.toBeDisabled();
    fireEvent.click(claimBtn);

    await waitFor(() => {
      // Wallet was prompted to switch to Arbitrum (42161)
      expect(switchChainMock).toHaveBeenCalledWith(42161);
    });
  });

  it('the page flow signs once and claims for held default route', async () => {
    const view: SendLinkView = {
      id: orderId,
      orderId,
      lockId: ('0x' + '22'.repeat(32)) as Hex32,
      chainId: 8453,
      status: 'pending_lock',
      isHeld: true,
      amount: 20,
      token: 'USDC',
      chain: 'Base',
      recipientEvmAddress: recipientAddress,
      expiresAt: Math.floor(Date.now() / 1000) + 7200,
    };

    const solver = createMockSolver(view);
    const signTypedDataMock = vi.fn(
      async () => ('0x' + '99'.repeat(65)) as Hex,
    );

    const mockWallets = {
      evm: {
        status: 'connected' as const,
        address: recipientAddress,
        chainId: 8453,
        connect: vi.fn(),
        disconnect: vi.fn(),
        switchChain: vi.fn(),
        signTypedData: signTypedDataMock,
      },
      bch: null,
    };

    render(
      <WalletContext.Provider value={mockWallets as never}>
        <SolverProvider client={solver}>
          <MemoryRouter
            initialEntries={[`/s/${orderId}#${dummySecret.slice(2)}`]}
          >
            <Routes>
              <Route
                path="/s/:id"
                element={
                  <SendLinkPage
                    isLive={true}
                    initialSecret={dummySecret}
                    dependencies={{
                      solver: solver as unknown as SendLinkSolverPort,
                    }}
                  />
                }
              />
            </Routes>
          </MemoryRouter>
        </SolverProvider>
      </WalletContext.Provider>,
    );

    const claimBtn = await screen.findByTestId('send-link-submit-button');
    expect(claimBtn).toHaveTextContent(/Connect and claim/i);
    fireEvent.click(claimBtn);

    await waitFor(() => {
      // The route is confirmed first (one signature); the claim then signs its own request, and
      // only after the solver has locked.
      const kinds = (signTypedDataMock.mock.calls as unknown[][]).map(
        (call) =>
          (call[0] as { primaryType?: string } | undefined)?.primaryType,
      );
      expect(kinds[0]).toBe('ConfirmRouteRequest');
      expect(solver.confirmSendLinkRoute).toHaveBeenCalledWith(
        orderId,
        expect.objectContaining({
          chainId: 8453,
          signature: expect.stringMatching(/^0x/),
        }),
      );
    });
  });

  it('reads the link view through its client after the lock (a detached method lost `this`)', async () => {
    const view: SendLinkView = {
      id: orderId,
      orderId,
      lockId: ('0x' + '22'.repeat(32)) as Hex32,
      chainId: 8453,
      status: 'pending_lock',
      isHeld: true,
      amount: 20,
      token: 'USDC',
      chain: 'Base',
      recipientEvmAddress: recipientAddress,
      expiresAt: Math.floor(Date.now() / 1000) + 7200,
    };
    const base = createMockSolver(view);
    // Like the real client: getSendLink needs its object.
    class BoundSolver {
      calls = 0;
      readonly view = view;
      async getSendLink(): Promise<SendLinkView | null> {
        this.calls += 1;
        return this.view;
      }
    }
    const bound = new BoundSolver();
    const solver = Object.assign(Object.create(BoundSolver.prototype), base, {
      calls: 0,
      view,
    }) as BoundSolver & SolverClient;
    const signTypedDataMock = vi.fn(
      async () => ('0x' + '99'.repeat(65)) as Hex,
    );
    const mockWallets = {
      evm: {
        status: 'connected' as const,
        address: recipientAddress,
        chainId: 8453,
        connect: vi.fn(),
        disconnect: vi.fn(),
        switchChain: vi.fn(),
        signTypedData: signTypedDataMock,
      },
      bch: null,
    };
    void bound;
    // getSendLink from the prototype (uses this), not the vi.fn from createMockSolver.
    delete (solver as { getSendLink?: unknown }).getSendLink;
    render(
      <WalletContext.Provider value={mockWallets as never}>
        <SolverProvider client={solver}>
          <MemoryRouter
            initialEntries={[`/s/${orderId}#${dummySecret.slice(2)}`]}
          >
            <Routes>
              <Route
                path="/s/:id"
                element={
                  <SendLinkPage
                    isLive={true}
                    initialSecret={dummySecret}
                    dependencies={{
                      solver: solver as unknown as SendLinkSolverPort,
                    }}
                  />
                }
              />
            </Routes>
          </MemoryRouter>
        </SolverProvider>
      </WalletContext.Provider>,
    );
    const claimBtn = await screen.findByTestId('send-link-submit-button');
    fireEvent.click(claimBtn);
    await waitFor(() => {
      expect(solver.confirmSendLinkRoute).toHaveBeenCalled();
      expect(solver.calls).toBeGreaterThan(0);
    });
    expect(screen.queryByText(/Cannot read properties/)).toBeNull();
  });
});
