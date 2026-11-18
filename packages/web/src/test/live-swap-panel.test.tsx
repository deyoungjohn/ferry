import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { QuoteInput } from '@ferry/user-flow';

const calls: string[] = [];
const session = {
  state: {
    step: 'lock',
    status: 'ready',
    waiting: null,
    error: null,
    txids: {},
  },
  refund: vi.fn(),
};

const services = {
  createDependencies: () => ({}) as never,
  preview: vi.fn(async () => {
    calls.push('preview');
    return {} as never;
  }),
  prepare: vi.fn(async () => {
    calls.push('prepare');
    return {
      session: session as never,
      recovery: { filename: 'recovery.json', json: '{"secret":"0x00"}' },
    };
  }),
  execute: vi.fn(async () => {
    calls.push('execute');
    return { ...session.state, step: 'done', status: 'ready' } as never;
  }),
};

import { LiveSwapPanel } from '../components/LiveSwapPanel';

const input = {
  direction: 'BCH_TO_EVM',
  token: 'PUSD',
  chainId: 8453,
  evmToken: `0x${'11'.repeat(20)}`,
  amountIn: 100n,
  evmTokenDecimals: 6,
  bchTokenDecimals: 2,
} as QuoteInput;

function renderPanel() {
  return render(
    <LiveSwapPanel
      open
      onClose={() => undefined}
      input={input}
      wallets={{} as never}
      solverUrl="https://solver.test"
      services={services}
      describe={{ pay: '1.00 PUSD', receive: '0.99 USDC' }}
    />,
  );
}

describe('live swap panel', () => {
  beforeEach(() => {
    calls.length = 0;
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
  });

  it('shows a price first and locks nothing until the recovery file is downloaded', async () => {
    renderPanel();
    await screen.findByTestId('live-preview-note');
    expect(calls).toEqual(['preview']);

    fireEvent.click(screen.getByTestId('live-continue'));
    await screen.findByTestId('live-keep-file-note');
    expect(calls).toEqual(['preview', 'prepare']);

    const lock = screen.getByTestId('live-lock') as HTMLButtonElement;
    expect(lock.disabled).toBe(true);
    fireEvent.click(lock);
    expect(calls).not.toContain('execute');

    fireEvent.click(screen.getByTestId('live-download'));
    await waitFor(() => expect(lock.disabled).toBe(false));
    fireEvent.click(lock);
    await screen.findByTestId('live-done');
    expect(calls).toEqual(['preview', 'prepare', 'execute']);
  });

  it('shows what the wallet is waiting for, and lets the user cancel it', async () => {
    const cancel = vi.fn();
    render(
      <LiveSwapPanel
        open
        onClose={() => undefined}
        input={input}
        wallets={
          {
            bch: {
              pendingRequest: 'Sign the Bitcoin Cash lock',
              promptHelp:
                'Is your phone asleep? Nothing was sent to the network.',
              cancelPendingRequest: cancel,
            },
            evm: {},
          } as never
        }
        solverUrl="https://solver.test"
        services={{
          ...services,
          execute: vi.fn(() => new Promise<never>(() => undefined)),
        }}
        describe={{ pay: '1.00 PUSD', receive: '0.99 USDC' }}
      />,
    );
    await screen.findByTestId('live-preview-note');
    fireEvent.click(screen.getByTestId('live-continue'));
    await screen.findByTestId('live-keep-file-note');
    fireEvent.click(screen.getByTestId('live-download'));
    fireEvent.click(screen.getByTestId('live-lock'));
    const box = await screen.findByTestId('live-wallet-request');
    expect(box).toHaveTextContent('Sign the Bitcoin Cash lock');
    expect(box).toHaveTextContent('phone asleep');
    fireEvent.click(screen.getByTestId('live-wallet-cancel'));
    expect(cancel).toHaveBeenCalled();
  });

  it('says what done means: the claim was sent, funds show once it confirms', async () => {
    render(
      <LiveSwapPanel
        open
        onClose={() => undefined}
        input={{ ...input, direction: 'EVM_TO_BCH' } as QuoteInput}
        wallets={{} as never}
        solverUrl="https://solver.test"
        services={services}
        describe={{ pay: '1.00 USDC', receive: '0.99 PUSD' }}
      />,
    );
    await screen.findByTestId('live-preview-note');
    fireEvent.click(screen.getByTestId('live-continue'));
    await screen.findByTestId('live-keep-file-note');
    fireEvent.click(screen.getByTestId('live-download'));
    fireEvent.click(screen.getByTestId('live-lock'));
    const done = await screen.findByTestId('live-done');
    expect(done).toHaveTextContent(/once the transaction confirms/);
  });
});
