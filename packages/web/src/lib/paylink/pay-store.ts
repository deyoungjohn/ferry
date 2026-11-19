import type { PayLinkData } from './link';

const KEY = 'ferry.pay-links.v1';

function readAll(): PayLinkData[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is PayLinkData =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as PayLinkData).id === 'string',
    );
  } catch {
    return [];
  }
}

/** Pay links made in this browser, newest first. */
export function listPayLinks(): PayLinkData[] {
  return readAll();
}

export function savePayLink(link: PayLinkData): void {
  try {
    const rest = readAll().filter((item) => item.id !== link.id);
    window.localStorage.setItem(
      KEY,
      JSON.stringify([link, ...rest].slice(0, 100)),
    );
  } catch {
    // Storage can be blocked; the link still works for this session.
  }
}
