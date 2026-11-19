import { render, screen } from '@testing-library/react';
import {
  describe,
  it,
  expect,
  beforeEach,
  beforeAll,
  afterAll,
  vi,
} from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ActivityPage } from '../routes/ActivityPage';
import { RecoverPage } from '../routes/RecoverPage';
import { PayLinksPage } from '../routes/PayLinksPage';
import { PayLinkPage } from '../routes/PayLinkPage';
import { SendLinksPage } from '../routes/SendLinksPage';
import { SendLinkPage } from '../routes/SendLinkPage';
import { RouteStatusPage } from '../routes/RouteStatusPage';
import { SolverProvider } from '../lib/solver/SolverProvider';
import { MockSolverClient } from '../lib/solver/mock';
import { MockWalletProvider } from '../lib/wallet/mock';
import { saveSendLink } from '../lib/paylink/send-store';

/** The fixtures are dated 14 Nov 2024; pin the clock so the default 90-day window includes them. */
const FIXTURE_NOW = new Date('2024-11-15T12:00:00Z');
beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(FIXTURE_NOW);
});
afterAll(() => {
  vi.useRealTimers();
});

describe('New Routes Layout & Responsive Viewports (FR-13, FR-17, FR-18)', () => {
  beforeEach(() => {
    window.innerWidth = 1280;
    window.innerHeight = 720;
  });

  const client = new MockSolverClient();

  function renderPage(ui: React.ReactElement) {
    return render(
      <MemoryRouter>
        <MockWalletProvider>
          <SolverProvider client={client}>{ui}</SolverProvider>
        </MockWalletProvider>
      </MemoryRouter>,
    );
  }

  describe('Desktop viewport (1280x720)', () => {
    beforeEach(() => {
      window.innerWidth = 1280;
      window.innerHeight = 720;
    });

    it('renders ActivityPage with responsive table and inspection bar', () => {
      renderPage(<ActivityPage />);
      expect(
        screen.getByRole('heading', { level: 1, name: /My Activity/i }),
      ).toBeInTheDocument();
      expect(screen.getByRole('table')).toBeInTheDocument();
    });

    it('renders RecoverPage with file upload and form', () => {
      renderPage(<RecoverPage />);
      expect(
        screen.getByRole('heading', { level: 1, name: /Recover a Swap/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByLabelText(/Or paste recovery file JSON:/i),
      ).toBeInTheDocument();
    });

    it('renders PayLinksPage and SendLinksPage', () => {
      const { unmount } = renderPage(<PayLinksPage />);
      expect(
        screen.getByRole('heading', { level: 1, name: /^Pay Links/i }),
      ).toBeInTheDocument();
      unmount();

      renderPage(<SendLinksPage />);
      expect(
        screen.getByRole('heading', { level: 1, name: /^Send Links/i }),
      ).toBeInTheDocument();
    });

    it('renders RouteStatusPage with global badges and dry-run test suite', () => {
      renderPage(<RouteStatusPage />);
      expect(
        screen.getByRole('heading', {
          level: 1,
          name: /Route Status & Network Health/i,
        }),
      ).toBeInTheDocument();
      expect(screen.getByTestId('test-all-routes-button')).toBeInTheDocument();
    });
  });

  describe('Mobile viewport (390x844)', () => {
    beforeEach(() => {
      window.innerWidth = 390;
      window.innerHeight = 844;
    });

    it('renders PayLinkPage with payment card and CTA', () => {
      render(
        <MemoryRouter initialEntries={['/p/pl-test-01']}>
          <MockWalletProvider>
            <SolverProvider client={client}>
              <Routes>
                <Route path="/p/:id" element={<PayLinkPage />} />
              </Routes>
            </SolverProvider>
          </MockWalletProvider>
        </MemoryRouter>,
      );

      expect(
        screen.getByRole('heading', { level: 1, name: /Pay 25\.00 PUSD/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /Pay now/i }),
      ).toBeInTheDocument();
    });

    it('renders SendLinkPage with claim card and CTA', async () => {
      saveSendLink({
        id: 'sl-sample-01',
        destinationChain: 'Base',
        destinationToken: 'USDC',
        recipientEvmAddress: '0x1111222233334444555566667777888899990000',
        amount: 50,
        windowSeconds: 86_400,
        expiresAt: Math.floor(FIXTURE_NOW.getTime() / 1000) + 86_400,
        status: 'open',
        createdAt: Math.floor(FIXTURE_NOW.getTime() / 1000),
      });
      render(
        <MemoryRouter initialEntries={['/s/sl-sample-01']}>
          <MockWalletProvider>
            <SolverProvider client={client}>
              <Routes>
                <Route path="/s/:id" element={<SendLinkPage />} />
              </Routes>
            </SolverProvider>
          </MockWalletProvider>
        </MemoryRouter>,
      );

      expect(
        await screen.findByRole('heading', {
          level: 1,
          name: /Receive 50\.00 USDC/i,
        }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /Send link ›/i }),
      ).toBeInTheDocument();
    });

    it('renders RouteStatusPage on mobile viewport with accessible touch targets', () => {
      renderPage(<RouteStatusPage />);
      expect(
        screen.getByRole('heading', {
          level: 1,
          name: /Route Status & Network Health/i,
        }),
      ).toBeInTheDocument();
      expect(screen.getByTestId('test-all-routes-button')).toBeInTheDocument();
    });
  });
});
