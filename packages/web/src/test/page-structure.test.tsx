import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router';
import { App } from '../App';
import { SolverProvider } from '../lib/solver/SolverProvider';
import { MockSolverClient } from '../lib/solver/mock';

const client = new MockSolverClient();

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <SolverProvider client={client}>
        <App />
      </SolverProvider>
    </MemoryRouter>,
  );
}

describe('navigation', () => {
  it('shows only the public tabs before a wallet is connected', async () => {
    renderAt('/features');
    const main = await screen.findByRole(
      'navigation',
      { name: 'Main' },
      { timeout: 30_000 },
    );
    for (const label of ['Features', 'How it works', 'Proof']) {
      expect(
        main.querySelector(`a[href]`) &&
          screen.getAllByRole('link', { name: label }).length,
      ).toBeGreaterThan(0);
    }
    expect(screen.queryByRole('link', { name: 'My activity' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Recover' })).toBeNull();
  });
});

describe('page structure', { timeout: 45_000 }, () => {
  it.each([
    ['/', /Move dollars onto Bitcoin Cash/],
    ['/features', /What Ferry does/],
    ['/proof', /Proof/],
    ['/how-it-works', /How it works/],
    ['/user-guide', /User Guide/],
    ['/app/user-guide', /User Guide/],
    ['/app/recover', /Recover a Swap/],
  ])('shows %s without a wallet', async (path, heading) => {
    renderAt(path);
    expect(
      await screen.findByRole(
        'heading',
        { level: 1, name: heading },
        { timeout: 30_000 },
      ),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('wallet-gate')).toBeNull();
  });

  it.each(['/app/pay-link', '/app/my-activity'])(
    'asks for a wallet on %s',
    async (path) => {
      renderAt(path);
      expect(
        await screen.findByTestId('wallet-gate', {}, { timeout: 30_000 }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Connect wallet' }),
      ).toBeInTheDocument();
    },
  );

  it('swap shows either the wallet gate or the not-configured notice', async () => {
    renderAt('/app/swap');
    expect(
      await screen.findByText(
        /Configuration Incomplete|Connect a wallet to use Swap/,
        {},
        { timeout: 30_000 },
      ),
    ).toBeInTheDocument();
  });

  it('redirects the earlier top-level app paths', async () => {
    renderAt('/pay-link');
    expect(
      await screen.findByTestId('wallet-gate', {}, { timeout: 30_000 }),
    ).toBeInTheDocument();
  });

  it('sends old paths to the new ones', async () => {
    renderAt('/help');
    expect(
      await screen.findByRole(
        'heading',
        { level: 1, name: /User Guide/ },
        { timeout: 30_000 },
      ),
    ).toBeInTheDocument();
  });

  it('proof page lists the deployed contract with an explorer link', async () => {
    renderAt('/proof');
    const link = await screen.findByRole(
      'link',
      {
        name: /Read the source on the explorer/,
      },
      { timeout: 30_000 },
    );
    expect(link.getAttribute('href')).toMatch(
      /\/address\/0x[0-9a-fA-F]{40}#code$/,
    );
  });
});
