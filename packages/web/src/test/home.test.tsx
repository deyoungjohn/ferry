import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { HomePage } from '../routes/HomePage';
import { SolverProvider } from '../lib/solver/SolverProvider';
import { MockSolverClient } from '../lib/solver/mock';

describe('HomePage components', () => {
  it('renders hero, swap card, stats, features, recent swaps, peg cards, how it works, and faq', async () => {
    const client = new MockSolverClient();
    render(
      <SolverProvider client={client}>
        <HomePage />
      </SolverProvider>,
    );

    // Hero
    expect(
      screen.getByRole('heading', {
        level: 1,
        name: /Move stablecoins onto Bitcoin Cash/i,
      }),
    ).toBeInTheDocument();

    // Swap card & Solver label
    expect(screen.getByTestId('solver-label')).toBeInTheDocument();
    expect(
      screen.getByText('Mock interface, no funds move'),
    ).toBeInTheDocument();
    expect(screen.getByText('You send')).toBeInTheDocument();
    expect(screen.getByText('You receive')).toBeInTheDocument();

    // Feature cards
    expect(screen.getByText('No bridge, no custodian')).toBeInTheDocument();
    expect(screen.getByText('Refunds are automatic')).toBeInTheDocument();

    // Recent swaps
    expect(
      screen.getByRole('heading', { level: 2, name: /Recent Swaps/i }),
    ).toBeInTheDocument();

    // Peg cards
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { level: 2, name: /BCH Stablecoin Pegs/i }),
      ).toBeInTheDocument();
    });

    // How it works
    expect(
      screen.getByRole('heading', { level: 2, name: /How Ferry Swaps Work/i }),
    ).toBeInTheDocument();

    // The FAQ lives on the landing and features pages, not on the swap page.
    expect(
      screen.queryByRole('heading', { name: /Frequently asked questions/i }),
    ).not.toBeInTheDocument();
  });
});
