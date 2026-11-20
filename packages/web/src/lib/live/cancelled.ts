/**
 * Swaps the person cancelled before anything was locked. They leave the unfinished list; their
 * saved data stays, so a lock a wallet sends late can still be refunded from the recovery page.
 */
const KEY = 'ferry.cancelled.';

export function isCancelled(orderId: string): boolean {
  try {
    return window.localStorage.getItem(KEY + orderId.toLowerCase()) !== null;
  } catch {
    return false;
  }
}

export function markCancelled(orderId: string): void {
  try {
    window.localStorage.setItem(
      KEY + orderId.toLowerCase(),
      String(Math.floor(Date.now() / 1000)),
    );
  } catch {
    // Without storage the swap simply stays listed.
  }
}
