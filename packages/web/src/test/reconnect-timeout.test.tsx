import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useBchReconnectTimeout } from '../lib/wallet/reconnect-timeout';

describe('restore timeout', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('drops a restored session that never resolves', () => {
    const disconnect = vi.fn();
    renderHook(() =>
      useBchReconnectTimeout('connecting', disconnect, 8000, true),
    );
    act(() => vi.advanceTimersByTime(8100));
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it('does not drop a pairing while its QR is shown, even through a reconnect', () => {
    const disconnect = vi.fn();
    const { rerender } = renderHook(
      ({ state, enabled }) =>
        useBchReconnectTimeout(state, disconnect, 8000, enabled),
      { initialProps: { state: 'connecting', enabled: false } },
    );
    act(() => vi.advanceTimersByTime(3000));
    rerender({ state: 'disconnected', enabled: false });
    rerender({ state: 'connecting', enabled: false });
    act(() => vi.advanceTimersByTime(20_000));
    expect(disconnect).not.toHaveBeenCalled();
  });
});
