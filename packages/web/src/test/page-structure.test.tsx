import { render, screen, within } from '@testing-library/react';
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
    const nav = within(main);
    for (const label of ['Features', 'How it works', 'Stats']) {
      expect(nav.getByRole('link', { name: label })).toBeInTheDocument();
    }
    for (const label of [
      'Swap',
      'My activity',
      'Recover',
      'User guide',
      'GitHub',
    ]) {
      expect(nav.queryByRole('link', { name: label })).toBeNull();
    }
  });

  it('puts the docs and GitHub in the footer', async () => {
    renderAt('/features');
    const footer = await screen.findByRole(
      'contentinfo',
      {},
      { timeout: 30_000 },
    );
    expect(
      within(footer).getByRole('link', { name: 'Docs' }),
    ).toBeInTheDocument();
    expect(
      within(footer).getAllByRole('link', { name: 'GitHub' })[0],
    ).toBeInTheDocument();
  });
});

describe('page structure', { timeout: 45_000 }, () => {
  it.each([
    ['/', /Move stablecoins in and out of Bitcoin Cash/],
    ['/features', /Swaps, payment links and send links/],
    ['/stats', /Stats/],
    ['/how-it-works', /How a Ferry swap works/],
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

  it('shows the pay link creation form without a wallet, and no table of links', async () => {
    renderAt('/app/pay-link');
    expect(
      await screen.findByRole(
        'heading',
        { level: 1, name: /Pay Links/ },
        { timeout: 30_000 },
      ),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('wallet-gate')).toBeNull();
    expect(screen.queryByTestId('links-table')).toBeNull();
  });

  it.each(['/app/my-activity'])('asks for a wallet on %s', async (path) => {
    renderAt(path);
    expect(
      await screen.findByTestId('wallet-gate', {}, { timeout: 30_000 }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Connect wallet' }),
    ).toBeInTheDocument();
  });

  it('swap shows the card without a wallet, or the not-configured notice', async () => {
    renderAt('/app/swap');
    expect(
      await screen.findByText(
        /Configuration Incomplete|Recent Swaps/,
        {},
        { timeout: 30_000 },
      ),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('wallet-gate')).toBeNull();
  });

  it('redirects the earlier top-level app paths', async () => {
    renderAt('/pay-link');
    expect(
      await screen.findByRole(
        'heading',
        { level: 1, name: /Pay Links/ },
        { timeout: 30_000 },
      ),
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

  it('stats page lists the deployed contract with an explorer link', async () => {
    renderAt('/stats');
    const links = await screen.findAllByRole(
      'link',
      {
        name: /Read the source on the explorer/,
      },
      { timeout: 30_000 },
    );
    expect(links.length).toBeGreaterThanOrEqual(1);
    for (const link of links) {
      expect(link.getAttribute('href')).toMatch(
        /\/address\/0x[0-9a-fA-F]{40}#code$/,
      );
    }
  });
});
