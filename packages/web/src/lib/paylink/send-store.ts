import { SEND_LINK_NOTE_MAX_LENGTH } from '@ferry/core/api';
import type { SendLinkData } from './link';

const KEY = 'ferry.send-links.v1';

function readAll(): SendLinkData[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is SendLinkData =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as SendLinkData).id === 'string',
    );
  } catch {
    return [];
  }
}

/** Send links made in this browser, newest first. Used until the solver holds them. */
export function listSendLinks(): SendLinkData[] {
  return readAll();
}

export function loadSendLink(id: string): SendLinkData | null {
  return readAll().find((link) => link.id === id) ?? null;
}

export function saveSendLink(link: SendLinkData): void {
  try {
    const rest = readAll().filter((item) => item.id !== link.id);
    window.localStorage.setItem(
      KEY,
      JSON.stringify([link, ...rest].slice(0, 50)),
    );
  } catch {
    // Storage can be blocked; the link still works for this session.
  }
}

/** A note as the solver will accept it: trimmed, plain text, at most the allowed length. */
export function cleanNote(input: string): string | undefined {
  const trimmed = input.trim();
  return trimmed === ''
    ? undefined
    : trimmed.slice(0, SEND_LINK_NOTE_MAX_LENGTH);
}
