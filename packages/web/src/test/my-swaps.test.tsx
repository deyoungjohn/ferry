import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { MySwaps } from '../components/MySwaps';

describe('MySwaps', () => {
  it('lists the swaps the solver returns for the EVM address, and nothing when there are none', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        orders: [
          {
            orderId: '0x' + 'ab'.repeat(32),
            direction: 'EVM_TO_BCH',
            status: 'DONE',
            createdAt: 1_795_000_000,
            evmAmount: '1000000',
            bchToken: 'PUSD',
            bchTokenAmount: '99',
          },
        ],
      }),
    });
    const { unmount } = render(
      <MemoryRouter>
        <MySwaps
          solverUrl="https://s.example"
          evmAddress="0x1111111111111111111111111111111111111111"
          fetchFn={fetchFn as unknown as typeof fetch}
        />
      </MemoryRouter>,
    );
    expect(await screen.findByTestId('my-swaps')).toHaveTextContent('Done');
    expect(fetchFn).toHaveBeenCalledWith(
      'https://s.example/v1/orders?address=0x1111111111111111111111111111111111111111',
    );
    unmount();
    const empty = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ orders: [] }) });
    render(
      <MemoryRouter>
        <MySwaps
          solverUrl="https://s.example"
          evmAddress="0x1111111111111111111111111111111111111111"
          fetchFn={empty as unknown as typeof fetch}
        />
      </MemoryRouter>,
    );
    await vi.waitFor(() => expect(empty).toHaveBeenCalled());
    expect(screen.queryByTestId('my-swaps')).toBeNull();
  });
});
