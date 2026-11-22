/**
 * The last answer the server gave for a link or an order, kept in this browser: a page paints from
 * it at once and then lets the live answer correct it (the server's database is the record; this
 * only saves the wait).
 */
export function readSnapshot<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(`ferry.snapshot.${key}`);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function writeSnapshot<T>(key: string, value: T): void {
  try {
    window.localStorage.setItem(`ferry.snapshot.${key}`, JSON.stringify(value));
  } catch {
    // storage blocked: the page still works, only without the quick first paint
  }
}

export function clearSnapshot(key: string): void {
  try {
    window.localStorage.removeItem(`ferry.snapshot.${key}`);
  } catch {
    // storage unavailable
  }
}
