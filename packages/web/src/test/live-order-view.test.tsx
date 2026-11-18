import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UserSwapSession } from '@ferry/user-flow';
import { LiveOrderView } from '../components/LiveOrderView';
import { createLocalRecoveryStore } from '../lib/live/recovery-store';

const ORDER = `0x${'ab'.repeat(32)}` as const;

function fakeSession(step: string) {
  const listeners = new Set<(s: unknown) => void>();
  const session = {
    state: {
      step,
      status: 'ready',
      waiting:
        step === 'waitCounterLock' ? "Waiting for the solver's lock" : null,
      error: null,
      direction: 'EVM_TO_BCH',
      orderId: ORDER,
      txids: { userLock: null, claim: null, refund: null },
    },
    subscribe: (fn: (s: unknown) => void) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    refresh: vi.fn(async () => session.state),
    lock: vi.fn(async () => {
      session.state = { ...session.state, step: 'waitCounterLock' };
      return '0xlocktx';
    }),
    waitCounterLock: vi.fn(async () => {
      session.state = { ...session.state, step: 'claim' };
    }),
    claim: vi.fn(async () => {
      session.state = { ...session.state, step: 'done' };
      return 'claimtx';
    }),
    refund: vi.fn(async () => {
      session.state = { ...session.state, step: 'refunded' };
      return 'refundtx';
    }),
  };
  return session;
}

function renderPage(start: boolean) {
  return render(
    <MemoryRouter
      initialEntries={[
        {
          pathname: `/app/swap/${ORDER}`,
          state: start ? { start: true } : null,
        },
      ]}
    >
      <LiveOrderView orderId={ORDER} dependencies={{} as never} />
    </MemoryRouter>,
  );
}

describe('the order page', () => {
  beforeEach(async () => {
    window.localStorage.clear();
    await createLocalRecoveryStore().save(ORDER, '{"saved":true}');
  });
  afterEach(() => vi.restoreAllMocks());

  it('a swap just started locks, waits and claims by itself, showing the steps', async () => {
    const session = fakeSession('lock');
    vi.spyOn(UserSwapSession, 'resume').mockResolvedValue(session as never);
    renderPage(true);
    await waitFor(() => expect(session.claim).toHaveBeenCalled());
    expect(session.lock).toHaveBeenCalledTimes(1);
    expect(session.waitCounterLock).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('order-done')).toBeInTheDocument();
    expect(screen.getByTestId('order-step-claim')).toHaveAttribute(
      'data-state',
      'done',
    );
  });

  it('a swap only opened does not lock until the person says so', async () => {
    const session = fakeSession('lock');
    vi.spyOn(UserSwapSession, 'resume').mockResolvedValue(session as never);
    renderPage(false);
    const button = await screen.findByTestId('order-lock-now');
    expect(session.lock).not.toHaveBeenCalled();
    fireEvent.click(button);
    await waitFor(() => expect(session.lock).toHaveBeenCalledTimes(1));
  });

  it('a swap already locked carries on by itself after a reload: waits for the solver, then claims', async () => {
    const session = fakeSession('waitCounterLock');
    vi.spyOn(UserSwapSession, 'resume').mockResolvedValue(session as never);
    renderPage(false);
    await waitFor(() => expect(session.claim).toHaveBeenCalled());
    expect(session.lock).not.toHaveBeenCalled();
  });

  it('offers the refund when it is ready', async () => {
    const session = fakeSession('refund');
    vi.spyOn(UserSwapSession, 'resume').mockResolvedValue(session as never);
    renderPage(false);
    fireEvent.click(await screen.findByTestId('order-refund'));
    await waitFor(() => expect(session.refund).toHaveBeenCalled());
    expect(await screen.findByTestId('order-refunded')).toBeInTheDocument();
  });

  it('says plainly when this browser does not hold the swap', async () => {
    window.localStorage.clear();
    renderPage(false);
    expect(await screen.findByTestId('order-not-here')).toBeInTheDocument();
  });

  it('shows the reason when something stops, and keeps the refund path', async () => {
    const session = fakeSession('waitCounterLock');
    session.waitCounterLock = vi.fn(async () => {
      throw new Error(
        "The solver's lock did not appear in time. Your refund is available after the deadline.",
      );
    });
    vi.spyOn(UserSwapSession, 'resume').mockResolvedValue(session as never);
    renderPage(false);
    expect(await screen.findByTestId('order-error')).toHaveTextContent(
      /refund is available/,
    );
  });
});
