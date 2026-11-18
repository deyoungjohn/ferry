import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { RecentSwapsTable } from '../components/RecentSwapsTable';
import { SolverProvider } from '../lib/solver/SolverProvider';
import { MockSolverClient } from '../lib/solver/mock';

/** The fixtures are dated 14 Nov 2024; pin the clock so the default 90-day window includes them. */
const FIXTURE_NOW = new Date('2024-11-15T12:00:00Z');
beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(FIXTURE_NOW);
});
afterAll(() => {
  vi.useRealTimers();
});

describe('RecentSwapsTable pagination', () => {
  it('renders 10 items per page by default', async () => {
    const client = new MockSolverClient();
    render(
      <SolverProvider client={client}>
        <RecentSwapsTable />
      </SolverProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('pagination-page-indicator')).toHaveTextContent(
        'Page 1 of 3 (25 total)',
      );
    });

    const rows = screen.getAllByRole('row');
    // 1 header row + 10 data rows
    expect(rows).toHaveLength(11);
  });

  it('navigates to next page on Next button click and disables Previous on page 1', async () => {
    const client = new MockSolverClient();
    render(
      <SolverProvider client={client}>
        <RecentSwapsTable />
      </SolverProvider>,
    );

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Previous page' }),
      ).toBeDisabled();
    });

    const nextBtn = screen.getByRole('button', { name: 'Next page' });
    expect(nextBtn).toBeEnabled();

    fireEvent.click(nextBtn);

    await waitFor(() => {
      expect(screen.getByTestId('pagination-page-indicator')).toHaveTextContent(
        'Page 2 of 3 (25 total)',
      );
    });

    expect(screen.getByRole('button', { name: 'Previous page' })).toBeEnabled();
  });
});
