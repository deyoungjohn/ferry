import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ResumeSwaps } from '../components/ResumeSwaps';

function swap(step: string, orderId = `0x${'ab'.repeat(32)}`) {
  const session = {
    state: { step },
    waitCounterLock: vi.fn(async () => undefined),
    claim: vi.fn(async () => {
      session.state = { step: 'done' };
      return 'txid';
    }),
    refund: vi.fn(async () => 'txid'),
  };
  return { orderId, session, state: session.state, settled: false };
}

describe('ResumeSwaps', () => {
  it('shows nothing when no swap is saved', async () => {
    const { container } = render(
      <ResumeSwaps
        createDeps={() => ({}) as never}
        resume={async () => ({ resumed: [], failed: [] })}
      />,
    );
    await waitFor(() => expect(container.firstChild).toBeNull());
  });

  it('lists an open swap and carries on: wait for the solver, then claim', async () => {
    const open = swap('waitCounterLock');
    render(
      <ResumeSwaps
        createDeps={() => ({}) as never}
        resume={async () => ({ resumed: [open as never], failed: [] })}
      />,
    );
    await screen.findByTestId('resume-swaps');
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(open.session.claim).toHaveBeenCalled());
    expect(open.session.waitCounterLock).toHaveBeenCalled();
  });

  it('only lists a swap that was never locked, with no button, and shows files it could not check', async () => {
    render(
      <ResumeSwaps
        createDeps={() => ({}) as never}
        resume={async () => ({
          resumed: [swap('lock') as never],
          failed: [
            { orderId: `0x${'cd'.repeat(32)}`, error: 'chain read failed' },
          ],
        })}
      />,
    );
    await screen.findByText(/Nothing is at risk/);
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull();
    expect(screen.getByText(/chain read failed/)).toBeTruthy();
  });
});
