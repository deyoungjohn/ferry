import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useBchReconnectTimeout } from '../lib/wallet/reconnect-timeout';
import {
  saveRememberedBchWallet,
  readRememberedBchWallet,
  clearRememberedBchWallet,
} from '../lib/wallet/remembered';

describe('BCH pairing & reconnect session rules', () => {
  it('drops a restored session after the 8s limit, but NOT a pairing the user started', () => {
    vi.useFakeTimers();
    const disconnect = vi.fn();

    // Restored session: enabled = true
    const restored = renderHook(() =>
      useBchReconnectTimeout('connecting', disconnect, 8_000, true),
    );

    // User-initiated pairing: enabled = false (timeout must not apply)
    const userStarted = renderHook(() =>
      useBchReconnectTimeout('connecting', disconnect, 8_000, false),
    );

    expect(restored.result.current).toBe(false);
    expect(userStarted.result.current).toBe(false);
    expect(disconnect).not.toHaveBeenCalled();

    // Advance 9 seconds
    act(() => {
      vi.advanceTimersByTime(9_000);
    });

    // Restored session timed out and invoked disconnect
    expect(restored.result.current).toBe(true);
    expect(disconnect).toHaveBeenCalledTimes(1);

    // User started pairing did NOT time out and stays open
    expect(userStarted.result.current).toBe(false);

    vi.useRealTimers();
  });

  it('correctly persists, reads, and clears remembered wallet details', () => {
    clearRememberedBchWallet();
    expect(readRememberedBchWallet()).toBeNull();

    const sample = {
      address: 'bchtest:zqg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zy6fphnwyk',
      lockingBytecode:
        '0x76a914000000000000000000000000000000000000000088ac' as const,
      tokenAware: true,
    };

    saveRememberedBchWallet('Paytaca', sample);

    const saved = readRememberedBchWallet();
    expect(saved).not.toBeNull();
    expect(saved?.name).toBe('Paytaca');
    expect(saved?.address.address).toBe(sample.address);
    expect(saved?.address.lockingBytecode).toBe(sample.lockingBytecode);

    clearRememberedBchWallet();
    expect(readRememberedBchWallet()).toBeNull();
  });
});
