import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { MockWalletProvider } from '../lib/wallet/mock';
import { useWallets } from '../lib/wallet/context';
import type { ReactNode } from 'react';

describe('Stuck wallet approval cancel and asleep-phone prompt', () => {
  it('displays asleep phone message after delay and aborts with defined outcome on cancel (BCH)', async () => {
    vi.useFakeTimers();

    const wrapper = ({ children }: { children: ReactNode }) => (
      <MockWalletProvider defaultBchConnected asleepDelayMs={5000}>
        {children}
      </MockWalletProvider>
    );

    const { result } = renderHook(() => useWallets(), { wrapper });

    expect(result.current.bch.status).toBe('connected');
    expect(result.current.bch.pendingRequest).toBeNull();
    expect(result.current.bch.promptHelp).toBeNull();

    // Start signing request
    let signPromise: Promise<unknown>;
    act(() => {
      signPromise = result.current.bch.signTransaction({
        transaction: '0100000001...',
        sourceOutputs: [],
        userPrompt: 'Sign the BCH covenant lock',
      });
    });

    // Request is now pending
    expect(result.current.bch.pendingRequest).toBe(
      'Sign the BCH covenant lock',
    );
    expect(result.current.bch.promptHelp).toBeNull();

    // Advance timers past asleepDelayMs (5000ms)
    act(() => {
      vi.advanceTimersByTime(5001);
    });

    // Expect asleep-phone prompt
    expect(result.current.bch.promptHelp).toBe(
      'Is your phone asleep? Nothing was sent to the network.',
    );

    // Cancel the pending request
    let rejectionError: Error | null = null;
    signPromise!.catch((err) => {
      rejectionError = err as Error;
    });

    act(() => {
      result.current.bch.cancelPendingRequest();
    });

    // Allow promise rejection microtasks to run
    await act(async () => {
      await Promise.resolve();
    });

    // Defined outcome: "Nothing was sent to the network"
    expect(rejectionError).not.toBeNull();
    expect(rejectionError!.message).toContain(
      'Request cancelled. Nothing was sent to the network.',
    );

    // Pending states are cleared
    expect(result.current.bch.pendingRequest).toBeNull();
    expect(result.current.bch.promptHelp).toBeNull();

    vi.useRealTimers();
  });

  it('displays asleep phone message and aborts with defined outcome on cancel (EVM)', async () => {
    vi.useFakeTimers();

    const wrapper = ({ children }: { children: ReactNode }) => (
      <MockWalletProvider defaultEvmConnected asleepDelayMs={5000}>
        {children}
      </MockWalletProvider>
    );

    const { result } = renderHook(() => useWallets(), { wrapper });

    expect(result.current.evm.status).toBe('connected');

    let signPromise: Promise<unknown>;
    act(() => {
      signPromise = result.current.evm.signTypedData({
        domain: {},
        types: {},
        primaryType: 'Permit',
        message: {},
      });
    });

    expect(result.current.evm.pendingRequest).toBe('Sign the USDC permit');

    act(() => {
      vi.advanceTimersByTime(5001);
    });

    expect(result.current.evm.promptHelp).toBe(
      'Is your phone asleep? Nothing was sent to the network.',
    );

    let rejectionError: Error | null = null;
    signPromise!.catch((err) => {
      rejectionError = err as Error;
    });

    act(() => {
      result.current.evm.cancelPendingRequest?.();
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(rejectionError).not.toBeNull();
    expect(rejectionError!.message).toContain(
      'Request cancelled. Nothing was sent to the network.',
    );
    expect(result.current.evm.pendingRequest).toBeNull();

    vi.useRealTimers();
  });
});
