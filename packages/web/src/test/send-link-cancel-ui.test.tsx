import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router';
import { SendLinksPage } from '../routes/SendLinksPage';
import { SendLinkPage } from '../routes/SendLinkPage';
import { SolverProvider } from '../lib/solver/SolverProvider';
import { MockSolverClient } from '../lib/solver/mock';
import { saveSendLink } from '../lib/paylink/send-store';
import { WalletContext } from '../lib/wallet/context';
import type { SendLinkData } from '../lib/paylink/link';

describe('Send Link Cancellation UI (Task B4-20)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  const sampleOpenLink: SendLinkData = {
    id: 'sl-cancel-test-01',
    destinationChain: 'Base',
    destinationToken: 'USDC',
    recipientEvmAddress: '0x1111222233334444555566667777888899990000',
    amount: 25,
    windowSeconds: 86_400,
    expiresAt: Math.floor(Date.now() / 1000) + 86_400,
    note: 'Dinner payment',
    status: 'open',
    createdAt: Math.floor(Date.now() / 1000) - 300,
  };

  const sampleCancelledLink: SendLinkData = {
    ...sampleOpenLink,
    id: 'sl-cancel-test-02',
    status: 'cancelled',
    lockStatus: 'cancelled',
  };

  it('renders SendLinkPage in cancelled state showing "cancelled by the sender"', async () => {
    saveSendLink(sampleCancelledLink);

    render(
      <MemoryRouter initialEntries={['/s/sl-cancel-test-02']}>
        <WalletContext.Provider
          value={
            {
              evm: {
                status: 'connected',
                address: '0x1111222233334444555566667777888899990000',
              },
              bch: { status: 'disconnected', address: null },
            } as never
          }
        >
          <SolverProvider client={new MockSolverClient()}>
            <Routes>
              <Route path="/s/:id" element={<SendLinkPage />} />
            </Routes>
          </SolverProvider>
        </WalletContext.Provider>
      </MemoryRouter>,
    );

    // Headline and wait state
    expect(await screen.findByTestId('send-link-status')).toHaveTextContent(
      'cancelled by the sender',
    );
    const submitBtn = screen.getByTestId('send-link-submit-button');
    expect(submitBtn).toBeDisabled();
    expect(submitBtn).toHaveTextContent(/Cancelled by the sender/i);
  });

  it('renders Cancel button for open send link in SendLinksPage and opens confirmation modal with quota', async () => {
    saveSendLink(sampleOpenLink);

    // Mock fetch for cancel-quota and cancel endpoint
    const fetchMock = vi
      .fn()
      .mockImplementation(async (url: string, init?: RequestInit) => {
        if (url.includes('/cancel-quota')) {
          return {
            ok: true,
            json: async () => ({
              dailyRemaining: 2,
              dailyLimit: 2,
              monthlyRemaining: 10,
              monthlyLimit: 10,
            }),
          };
        }
        if (url.includes('/cancel') && init?.method === 'POST') {
          return {
            ok: true,
            json: async () => ({
              success: true,
              orderId: 'sl-cancel-test-01',
              status: 'cancelled',
              refundTxId:
                'a1b2c3d4e5f60000000000000000000000000000000000000000000000000000',
              quota: {
                dailyRemaining: 1,
                dailyLimit: 2,
                monthlyRemaining: 9,
                monthlyLimit: 10,
              },
            }),
          };
        }
        return { ok: false, status: 404, json: async () => ({}) };
      });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <MemoryRouter>
        <WalletContext.Provider
          value={
            {
              evm: {
                status: 'connected',
                address: '0x9999999999999999999999999999999999999999',
              },
              bch: { status: 'disconnected', address: null },
            } as never
          }
        >
          <SendLinksPage />
        </WalletContext.Provider>
      </MemoryRouter>,
    );

    // Cancel button is visible in table
    const cancelBtn = await screen.findByTestId(
      'cancel-send-link-sl-cancel-test-01',
    );
    expect(cancelBtn).toBeInTheDocument();
    expect(cancelBtn).toHaveTextContent('Cancel');

    // Click Cancel opens GlassModal
    fireEvent.click(cancelBtn);

    expect(
      await screen.findByText('Cancel send link & refund'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /Cancelling returns your locked Bitcoin Cash directly to your address/i,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('25 USDC')).toBeInTheDocument();

    // Confirm cancel button
    const confirmBtn = screen.getByTestId('confirm-cancel-send-link');
    expect(confirmBtn).toBeInTheDocument();

    fireEvent.click(confirmBtn);

    await waitFor(() => {
      // Modal closes
      expect(screen.queryByText('Cancel send link & refund')).toBeNull();
    });

    // Row status updates to Cancelled
    await waitFor(() => {
      const rows = screen.getAllByTestId('links-row');
      expect(rows[0]!.textContent).toContain('Cancelled');
    });

    // Cancel button should no longer exist for cancelled link
    expect(
      screen.queryByTestId('cancel-send-link-sl-cancel-test-01'),
    ).toBeNull();
  });
});
