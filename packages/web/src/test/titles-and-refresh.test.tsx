import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { titleFor } from '../App';
import { SendLinksPage } from '../routes/SendLinksPage';
import { saveSendLink, listSendLinks } from '../lib/paylink/send-store';

describe('page titles', () => {
  it('names each page', () => {
    expect(titleFor('/', '')).toBe(
      'Ferry | Atomic Stablecoin Swaps on Bitcoin Cash',
    );
    expect(titleFor('/features', '')).toBe('Features | Ferry');
    expect(titleFor('/app/swap', '')).toBe('Swap | Ferry');
    expect(titleFor('/app/swap/0xabc', '')).toBe('Swap | Ferry');
    expect(titleFor('/app/pay-link', '')).toBe('Pay | Ferry');
    expect(titleFor('/app/pay-link', '?type=send')).toBe('Send | Ferry');
    expect(titleFor('/pay/pl-1', '')).toBe('Pay | Ferry');
    expect(titleFor('/send/sl-1', '')).toBe('Send | Ferry');
  });
});

describe('the send links table follows the solver', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  it('a link that was claimed shows as claimed, with its date, and offers no QR code', async () => {
    window.localStorage.clear();
    vi.stubEnv('VITE_SOLVER_URLS', 'https://solver.test');
    const now = Math.floor(Date.now() / 1000);
    saveSendLink({
      id: `0x${'ab'.repeat(32)}`,
      destinationChain: 'Base',
      destinationToken: 'USDC',
      recipientEvmAddress: '0x1111222233334444555566667777888899990000',
      amount: 2,
      windowSeconds: 86_400,
      expiresAt: now + 86_400,
      status: 'open',
      createdAt: now - 600,
      lockStatus: 'locked',
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          state: 'DONE',
          txids: {},
          updatedAt: now,
          timeline: [{ status: 'SECRET_KNOWN', at: now - 30 }],
        }),
      ),
    );
    render(
      <MemoryRouter>
        <SendLinksPage />
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(screen.getByTestId('links-row')).toHaveTextContent('Claimed'),
    );
    expect(screen.queryByText('View QR')).toBeNull();
    expect(listSendLinks()[0]?.claimedAt).toBe(now - 30);
  });
});
