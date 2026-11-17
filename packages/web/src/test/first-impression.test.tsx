import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { NotFoundPage } from '../routes/NotFoundPage';
import { StatsRow } from '../components/StatsRow';
import { RecentSwapsTable } from '../components/RecentSwapsTable';
import { ActivityPage } from '../routes/ActivityPage';
import { RecoverPage } from '../routes/RecoverPage';
import { SwapCard } from '../components/SwapCard';
import { OfflineBanner } from '../components/OfflineBanner';
import { ToastProvider, useToast } from '../lib/toast/ToastContext';
import { SolverProvider } from '../lib/solver/SolverProvider';
import { MockSolverClient } from '../lib/solver/mock';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webRoot = path.resolve(__dirname, '../..');

function ProblematicChild(): ReactElement {
  throw new Error('Simulated crash in test component');
}

function TestToastConsumer() {
  const { showToast } = useToast();
  return (
    <div>
      <button
        type="button"
        onClick={() => showToast('Address copied to clipboard', 'success')}
      >
        Trigger Copy Toast
      </button>
      <button
        type="button"
        onClick={() => showToast('Recovery file downloaded', 'success')}
      >
        Trigger Download Toast
      </button>
    </div>
  );
}

describe('First-Impression Polish (Task B3-10)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('1. Missing States', () => {
    it('catches runtime errors in ErrorBoundary and displays diagnostics copy button', () => {
      // Suppress expected console.error from ErrorBoundary during test
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      render(
        <MemoryRouter>
          <ErrorBoundary>
            <ProblematicChild />
          </ErrorBoundary>
        </MemoryRouter>,
      );

      expect(screen.getByTestId('error-boundary-card')).toBeInTheDocument();
      expect(
        screen.getByRole('heading', { name: /Something went wrong/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/Simulated crash in test component/i),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /Reload Page/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('link', { name: /Back to Swap/i }),
      ).toHaveAttribute('href', '/');
      expect(screen.getByTestId('copy-diagnostics-button')).toBeInTheDocument();

      consoleSpy.mockRestore();
    });

    it('renders 404 NotFoundPage with link back to home', () => {
      render(
        <MemoryRouter initialEntries={['/unknown-path']}>
          <NotFoundPage />
        </MemoryRouter>,
      );

      expect(
        screen.getByRole('heading', { name: /Page Not Found/i }),
      ).toBeInTheDocument();
      const backLink = screen.getByRole('link', { name: /Back to Swap/i });
      expect(backLink).toBeInTheDocument();
      expect(backLink).toHaveAttribute('href', '/');
    });

    it('renders StatsRow skeleton loader while stats are loading', () => {
      const mockClient = new MockSolverClient();
      // Keep stats promise pending forever to test skeleton
      vi.spyOn(mockClient, 'getStats').mockReturnValue(new Promise(() => {}));

      render(
        <SolverProvider client={mockClient}>
          <StatsRow />
        </SolverProvider>,
      );

      const skeleton = screen.getByTestId('stats-skeleton');
      expect(skeleton).toBeInTheDocument();
      expect(skeleton).toHaveAttribute('role', 'status');
      expect(skeleton).toHaveAttribute(
        'aria-label',
        'Loading network statistics',
      );
    });

    it('renders RecentSwapsTable skeleton loader while recent swaps are loading', () => {
      const mockClient = new MockSolverClient();
      vi.spyOn(mockClient, 'getRecentSwaps').mockReturnValue(
        new Promise(() => {}),
      );

      render(
        <SolverProvider client={mockClient}>
          <RecentSwapsTable />
        </SolverProvider>,
      );

      const skeletons = screen.getAllByTestId('recent-swaps-skeleton');
      expect(skeletons.length).toBeGreaterThanOrEqual(1);
    });

    it('triggers toasts for copy and download actions', async () => {
      render(
        <ToastProvider>
          <TestToastConsumer />
        </ToastProvider>,
      );

      // Trigger copy toast
      fireEvent.click(
        screen.getByRole('button', { name: /Trigger Copy Toast/i }),
      );
      expect(
        await screen.findByText('Address copied to clipboard'),
      ).toBeInTheDocument();

      // Trigger download toast
      fireEvent.click(
        screen.getByRole('button', { name: /Trigger Download Toast/i }),
      );
      expect(
        await screen.findByText('Recovery file downloaded'),
      ).toBeInTheDocument();
    });

    it('renders offline banner when connection drops', () => {
      // Simulate navigator.onLine = false
      vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);

      render(<OfflineBanner />);

      const banner = screen.getByTestId('offline-banner');
      expect(banner).toBeInTheDocument();
      expect(banner).toHaveTextContent(/You are offline/i);
      expect(banner).toHaveAttribute('role', 'status');
    });
  });

  describe('2. Visual Pass & Micro-interactions', () => {
    it('applies micro-interaction and respects reduced-motion on swap direction toggle', () => {
      render(
        <MemoryRouter>
          <SolverProvider client={new MockSolverClient()}>
            <SwapCard />
          </SolverProvider>
        </MemoryRouter>,
      );

      const toggleButton = screen.getByRole('button', {
        name: /Toggle swap direction/i,
      });
      expect(toggleButton).toBeInTheDocument();

      // Button has motion-reduce class
      expect(toggleButton.className).toContain('motion-reduce:transform-none');

      // The icon sits inside the button; motion's own reduced-motion switch
      // removes the rotation, so there is no per-icon class to check.
      expect(toggleButton.querySelector('svg')).not.toBeNull();
    });

    it('enforces dark theme only in CSS tokens', () => {
      const tokensPath = path.resolve(webRoot, 'src/styles/tokens.css');
      const tokensContent = fs.readFileSync(tokensPath, 'utf8');

      // color-scheme: dark declared
      expect(tokensContent).toContain('color-scheme: dark;');

      // prefers-color-scheme light media query maintains dark palette
      expect(tokensContent).toContain('@media (prefers-color-scheme: light)');
      expect(tokensContent).toContain('--bg: #070708;');
    });

    it('references favicon and local OG image without third-party external assets', () => {
      const indexPath = path.resolve(webRoot, 'index.html');
      const indexContent = fs.readFileSync(indexPath, 'utf8');

      expect(indexContent).toContain('rel="icon"');
      expect(indexContent).toContain('property="og:image"');
      expect(indexContent).toContain('name="twitter:image"');

      // Zero external fonts or external scripts
      expect(indexContent).not.toContain('fonts.googleapis.com');
      expect(indexContent).not.toContain('cdnjs.cloudflare.com');
    });
  });

  describe('3. Copy Consistency & Forbidden Words', () => {
    it('never contains the phrases "trustless" or "audited" in web source files or copy', () => {
      const srcDir = path.resolve(webRoot, 'src');

      function scanDir(dir: string): string[] {
        const results: string[] = [];
        const files = fs.readdirSync(dir);
        for (const file of files) {
          const fullPath = path.join(dir, file);
          const stat = fs.statSync(fullPath);
          if (stat.isDirectory()) {
            results.push(...scanDir(fullPath));
          } else if (
            file.endsWith('.ts') ||
            file.endsWith('.tsx') ||
            file.endsWith('.html')
          ) {
            results.push(fullPath);
          }
        }
        return results;
      }

      const allFiles = scanDir(srcDir);
      allFiles.push(path.resolve(webRoot, 'index.html'));

      for (const filePath of allFiles) {
        // Skip this test file itself
        if (filePath.includes('first-impression.test.tsx')) continue;

        const content = fs.readFileSync(filePath, 'utf8');
        expect(content.toLowerCase()).not.toContain('trustless');
        expect(content.toLowerCase()).not.toContain('audited');
      }
    });
  });

  describe('4. Empty and First-run States', () => {
    it('displays honest empty state on home recent swaps table when 0 swaps exist', async () => {
      const mockClient = new MockSolverClient();
      vi.spyOn(mockClient, 'getRecentSwaps').mockResolvedValue({
        items: [],
        totalCount: 0,
        page: 1,
        pageSize: 10,
        totalPages: 1,
      });

      render(
        <SolverProvider client={mockClient}>
          <RecentSwapsTable />
        </SolverProvider>,
      );

      await waitFor(() => {
        expect(screen.getByTestId('recent-swaps-empty')).toBeInTheDocument();
      });
      expect(screen.getByText(/No swaps settled yet/i)).toBeInTheDocument();
    });

    it('displays honest activity empty state explaining Bitcoin Cash chain reconstruction', async () => {
      render(
        <MemoryRouter>
          <ActivityPage />
        </MemoryRouter>,
      );

      // Search for an unused address to see empty state
      const input = screen.getByLabelText(/Bitcoin Cash Address/i);
      const inspectBtn = screen.getByRole('button', {
        name: /Inspect Address/i,
      });

      // Enter a valid chipnet address that has 0 mock activity
      fireEvent.change(input, {
        target: {
          value:
            'bchtest:rv3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zy5ghlh3cy',
        },
      });
      fireEvent.click(inspectBtn);

      await waitFor(() => {
        const emptyState = screen.getByTestId('activity-empty-state');
        expect(emptyState).toBeInTheDocument();
        expect(emptyState).toHaveTextContent(
          /reconstructed directly from on-chain CashTokens covenants/i,
        );
      });
    });

    it('renders the "What is a recovery file?" informational panel on RecoverPage', () => {
      render(
        <MemoryRouter>
          <RecoverPage />
        </MemoryRouter>,
      );

      const panel = screen.getByTestId('what-is-recovery-panel');
      expect(panel).toBeInTheDocument();
      expect(
        screen.getByRole('heading', { name: /What is a recovery file\?/i }),
      ).toBeInTheDocument();
      expect(panel).toHaveTextContent(/non-custodial/i);
      expect(panel).toHaveTextContent(/@ferry\/recover-cli/i);
    });
  });
});
