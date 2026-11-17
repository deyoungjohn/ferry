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

describe('page structure', { timeout: 20_000 }, () => {
  it.each([
    ['/', /Move dollars onto Bitcoin Cash/],
    ['/features', /What Ferry does/],
    ['/proof', /Proof/],
    ['/how-it-works', /How it works/],
    ['/user-guide', /User Guide/],
  ])('shows %s without a wallet', async (path, heading) => {
    renderAt(path);
    expect(
      await screen.findByRole(
        'heading',
        { level: 1, name: heading },
        { timeout: 10_000 },
      ),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('wallet-gate')).toBeNull();
  });

  it.each(['/pay-link', '/my-activity'])(
    'asks for a wallet on %s',
    async (path) => {
      renderAt(path);
      expect(
        await screen.findByTestId('wallet-gate', {}, { timeout: 10_000 }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Connect wallet' }),
      ).toBeInTheDocument();
    },
  );

  it('swap shows either the wallet gate or the not-configured notice', async () => {
    renderAt('/swap');
    expect(
      await screen.findByText(
        /Configuration Incomplete|Connect a wallet to use Swap/,
        {},
        { timeout: 10_000 },
      ),
    ).toBeInTheDocument();
  });

  it('sends old paths to the new ones', async () => {
    renderAt('/help');
    expect(
      await screen.findByRole(
        'heading',
        { level: 1, name: /User Guide/ },
        { timeout: 10_000 },
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
      { timeout: 10_000 },
    );
    expect(link.getAttribute('href')).toMatch(
      /\/address\/0x[0-9a-fA-F]{40}#code$/,
    );
  });
});
