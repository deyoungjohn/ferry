import {
  MAX_SEND_LINK_WINDOW_SECONDS,
  MIN_SEND_LINK_WINDOW_SECONDS,
} from '@ferry/core';

export type ClaimWindowChoice = '24h' | '3d' | '7d' | 'custom';

export const CLAIM_WINDOW_PRESETS: ReadonlyArray<{
  readonly value: Exclude<ClaimWindowChoice, 'custom'>;
  readonly label: string;
  readonly seconds: number;
}> = [
  { value: '24h', label: '24 hours', seconds: 86_400 },
  { value: '3d', label: '3 days', seconds: 3 * 86_400 },
  { value: '7d', label: '7 days', seconds: 7 * 86_400 },
];

/** A custom end: how many days from today, and the local hour and minute. */
export interface CustomExpiry {
  readonly dayOffset: number;
  readonly hour: number;
  readonly minute: number;
}

const DAY_MS = 86_400_000;

function startOfDay(ms: number): Date {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date;
}

/** Today and the seven days after it, labelled in the viewer's own language and time zone. */
export function dayOptions(
  nowMs: number,
  locale?: string,
): Array<{ label: string; value: string }> {
  const formatter = new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
  return Array.from({ length: 8 }, (_, offset) => {
    const day = startOfDay(nowMs);
    day.setDate(day.getDate() + offset);
    const label =
      offset === 0
        ? 'Today'
        : offset === 1
          ? 'Tomorrow'
          : formatter.format(day);
    return { label, value: String(offset) };
  });
}

/** The moment a custom end means, in the viewer's local time. */
export function customExpiryMs(custom: CustomExpiry, nowMs: number): number {
  const day = startOfDay(nowMs);
  day.setDate(day.getDate() + custom.dayOffset);
  day.setHours(custom.hour, custom.minute, 0, 0);
  return day.getTime();
}

/** A sensible first custom end: tomorrow, at the next whole hour. */
export function defaultCustomExpiry(nowMs: number): CustomExpiry {
  const next = new Date(nowMs + 3_600_000);
  const offset = Math.round(
    (startOfDay(next.getTime()).getTime() - startOfDay(nowMs).getTime()) /
      DAY_MS,
  );
  return { dayOffset: offset + 1, hour: next.getHours(), minute: 0 };
}

export type ClaimWindowResult =
  | {
      readonly ok: true;
      readonly windowSeconds: number;
      readonly expiresAtMs: number;
    }
  | { readonly ok: false; readonly message: string };

/** The window to send to the solver for a choice, or the plain reason it cannot be used. */
export function claimWindow(
  choice: ClaimWindowChoice,
  custom: CustomExpiry,
  nowMs: number,
): ClaimWindowResult {
  if (choice !== 'custom') {
    const preset = CLAIM_WINDOW_PRESETS.find((item) => item.value === choice)!;
    return {
      ok: true,
      windowSeconds: preset.seconds,
      expiresAtMs: nowMs + preset.seconds * 1000,
    };
  }
  const expiresAtMs = customExpiryMs(custom, nowMs);
  const windowSeconds = Math.floor((expiresAtMs - nowMs) / 1000);
  if (windowSeconds < MIN_SEND_LINK_WINDOW_SECONDS) {
    return {
      ok: false,
      message: 'Pick a time at least one hour from now.',
    };
  }
  if (windowSeconds > MAX_SEND_LINK_WINDOW_SECONDS) {
    return {
      ok: false,
      message: 'Pick a time no more than 7 days from now.',
    };
  }
  return { ok: true, windowSeconds, expiresAtMs };
}

/** "Thu 20 Nov, 14:30 (in 1 day 5 h)". */
export function describeExpiry(
  expiresAtMs: number,
  nowMs: number,
  locale?: string,
): string {
  const when = new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(expiresAtMs));
  const minutes = Math.max(0, Math.round((expiresAtMs - nowMs) / 60_000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const rest = minutes % 60;
  const parts = [
    days > 0 ? `${days} day${days === 1 ? '' : 's'}` : null,
    hours > 0 ? `${hours} h` : null,
    days === 0 && rest > 0 ? `${rest} min` : null,
  ].filter(Boolean);
  return `${when} (in ${parts.join(' ') || 'under a minute'})`;
}
