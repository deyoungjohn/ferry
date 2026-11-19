import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { UnfinishedSwaps } from '../components/UnfinishedSwaps';

const A = `0x${'aa'.repeat(32)}`;
const B = `0x${'bb'.repeat(32)}`;
const C = `0x${'cc'.repeat(32)}`;

const resume = vi.fn(async () => ({
  resumed: [
    {
      orderId: A,
      settled: false,
      session: { state: { step: 'waitCounterLock' } },
    },
    // never locked: not counted
    { orderId: C, settled: false, session: { state: { step: 'lock' } } },
  ],
  failed: [],
}));

const fetchFn = vi.fn(async () =>
  Response.json({
    orders: [
      { orderId: A, status: 'USER_LOCK_SEEN' },
      { orderId: B, status: 'SOLVER_LOCK_SEEN' },
      { orderId: `0x${'dd'.repeat(32)}`, status: 'DONE' },
    ],
  }),
);

describe('UnfinishedSwaps', () => {
  it('counts the unfinished swaps once, and the dialog links each to its order page', async () => {
    render(
      <MemoryRouter>
        <UnfinishedSwaps
          createDeps={() => ({}) as never}
          solverUrl="https://s.example"
          evmAddress="0x1111111111111111111111111111111111111111"
          resume={resume as never}
          fetchFn={fetchFn as unknown as typeof fetch}
        />
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(screen.getByTestId('unfinished-count')).toHaveTextContent('2'),
    );
    fireEvent.click(screen.getByTestId('unfinished-open'));
    const links = await screen.findAllByTestId('unfinished-link');
    expect(links).toHaveLength(2);
    expect(links[0]?.getAttribute('href')).toContain(A);
  });

  it('shows nothing when there is nothing unfinished', async () => {
    render(
      <MemoryRouter>
        <UnfinishedSwaps
          createDeps={() => ({}) as never}
          solverUrl="https://s.example"
          evmAddress={null}
          resume={(async () => ({ resumed: [], failed: [] })) as never}
        />
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(screen.queryByTestId('unfinished-open')).toBeNull(),
    );
  });
});
