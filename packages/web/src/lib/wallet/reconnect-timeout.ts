import { useEffect, useRef, useState } from 'react';

export const BCH_RECONNECT_TIMEOUT_MS = 8_000;

/**
 * Guards restored sessions against indefinite hanging when an external counterparty
 * is offline or unresponsive.
 *
 * NOTE: User-initiated pairings MUST NOT be dropped by this timeout.
 * When enabled is false (user initiated a fresh connect/pairing), the timeout is inactive
 * and the QR remains open until scanned or explicitly closed.
 */
export function useBchReconnectTimeout(
  state: string,
  disconnect: () => Promise<unknown> | void,
  timeoutMs = BCH_RECONNECT_TIMEOUT_MS,
  enabled = true,
): boolean {
  const [timedOut, setTimedOut] = useState(false);
  const disconnectRef = useRef(disconnect);

  useEffect(() => {
    disconnectRef.current = disconnect;
  }, [disconnect]);

  useEffect(() => {
    if (!enabled || (state !== 'connecting' && state !== 'reconnecting')) {
      setTimedOut(false);
      return;
    }

    setTimedOut(false);
    const timer = window.setTimeout(() => {
      setTimedOut(true);
      void Promise.resolve(disconnectRef.current()).catch(() => undefined);
    }, timeoutMs);

    return () => window.clearTimeout(timer);
  }, [enabled, state, timeoutMs]);

  return timedOut;
}
