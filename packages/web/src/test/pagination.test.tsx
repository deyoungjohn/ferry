import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { RecentSwapsTable } from '../components/RecentSwapsTable';
import { SolverProvider } from '../lib/solver/SolverProvider';
import { MockSolverClient } from '../lib/solver/mock';

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
      expect(screen.getByTestId('pagination-prev')).toBeDisabled();
    });

    const nextBtn = screen.getByTestId('pagination-next');
    expect(nextBtn).toBeEnabled();

    fireEvent.click(nextBtn);

    await waitFor(() => {
      expect(screen.getByTestId('pagination-page-indicator')).toHaveTextContent(
        'Page 2 of 3 (25 total)',
      );
    });

    expect(screen.getByTestId('pagination-prev')).toBeEnabled();
  });
});
