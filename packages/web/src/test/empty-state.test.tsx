import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { StatsRow } from '../components/StatsRow';
import { SolverProvider } from '../lib/solver/SolverProvider';
import { MockSolverClient } from '../lib/solver/mock';

describe('Stats honest empty state', () => {
  it('renders honest zero/empty metrics when no swaps have completed', async () => {
    // Default client has emptyStats: true
    const client = new MockSolverClient({ emptyStats: true });
    render(
      <SolverProvider client={client}>
        <StatsRow />
      </SolverProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('stats-empty-state')).toBeInTheDocument();
    });

    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.getByText('$0.00')).toBeInTheDocument();
    expect(
      screen.getByText('Honest Metrics · No Simulated Volume'),
    ).toBeInTheDocument();
  });
});
