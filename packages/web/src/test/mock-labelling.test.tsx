import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { SwapCard } from '../components/SwapCard';
import { RecentSwapsTable } from '../components/RecentSwapsTable';
import { SolverProvider } from '../lib/solver/SolverProvider';
import { MockSolverClient } from '../lib/solver/mock';

describe('Mock labelling and explorer link safety', () => {
  it('renders "Mock interface, no funds move" clearly on screen', async () => {
    const client = new MockSolverClient();
    render(
      <SolverProvider client={client}>
        <SwapCard />
      </SolverProvider>,
    );

    const label = screen.getByTestId('mock-label');
    expect(label).toHaveTextContent('Mock interface, no funds move');
    expect(client.isLive()).toBe(false);
  });

  it('does not link mock transaction hashes to any external explorer', async () => {
    const client = new MockSolverClient();
    render(
      <SolverProvider client={client}>
        <RecentSwapsTable />
      </SolverProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('Recent Swaps')).toBeInTheDocument();
      expect(
        screen.queryByText('Loading recent swaps…'),
      ).not.toBeInTheDocument();
    });

    const links = screen.queryAllByRole('link');
    for (const link of links) {
      const href = link.getAttribute('href') ?? '';
      expect(href).not.toContain('mock');
      expect(href).not.toContain('basescan');
      expect(href).not.toContain('etherscan');
      expect(href).not.toContain('bscscan');
      expect(href).not.toContain('arbiscan');
    }

    // Hashes are displayed as plaintext spans
    const matchingElements = screen.getAllByText('0xmocka1b2…');
    expect(matchingElements.length).toBeGreaterThan(0);
    expect(matchingElements[0]).toBeInTheDocument();
  });
});
