import { WIZARD_RELAY_URLS } from '../config';

/** WizardConnect's built-in public relays, primary first. */
export const PUBLIC_RELAY_URLS: readonly string[] = [
  'wss://relay.riften.net:443',
  'wss://relay.cauldron.quest:443',
];

const PAIRED_KEY = 'ferry-wizard-relays';
export const RELAY_PROBE_TIMEOUT_MS = 2500;

type SocketCtor = new (url: string) => {
  onopen: (() => void) | null;
  onerror: (() => void) | null;
  close: () => void;
};

/** True when a WebSocket to `url` opens within the timeout. */
export function probeRelay(
  url: string,
  timeoutMs = RELAY_PROBE_TIMEOUT_MS,
  Socket: SocketCtor | undefined = globalThis.WebSocket as unknown as
    SocketCtor | undefined,
): Promise<boolean> {
  if (!Socket) return Promise.resolve(false);
  return new Promise((resolve) => {
    let done = false;
    let socket: InstanceType<SocketCtor> | null = null;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      try {
        socket?.close();
      } catch {
        // already closed
      }
      resolve(ok);
    };
    const timer = window.setTimeout(() => finish(false), timeoutMs);
    try {
      socket = new Socket(url);
      socket.onopen = () => finish(true);
      socket.onerror = () => finish(false);
    } catch {
      finish(false);
    }
  });
}

/**
 * The relays for a new pairing. The pairing link (QR) names only the first relay, and a wallet
 * that scans it listens on that relay alone, so the first entry must be reachable now. Ferry's
 * own relay goes first when it answers; otherwise the public relays are used, as before.
 */
export async function chooseRelayUrls(
  preferred: readonly string[] = WIZARD_RELAY_URLS,
  probe: (url: string) => Promise<boolean> = (url) => probeRelay(url),
): Promise<string[]> {
  const own = preferred.filter((url) => !PUBLIC_RELAY_URLS.includes(url));
  for (const url of own) {
    if (await probe(url)) {
      return [url, ...PUBLIC_RELAY_URLS];
    }
  }
  return [...PUBLIC_RELAY_URLS];
}

/** Relays the saved session was paired on; a restored session must use the same ones. */
export function readPairedRelays(): string[] | null {
  try {
    const raw = window.localStorage.getItem(PAIRED_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      Array.isArray(parsed) &&
      parsed.length > 0 &&
      parsed.every((url) => typeof url === 'string' && /^wss?:\/\//.test(url))
    ) {
      return parsed as string[];
    }
  } catch {
    // unreadable storage: fall through
  }
  return null;
}

export function savePairedRelays(urls: readonly string[]): void {
  try {
    window.localStorage.setItem(PAIRED_KEY, JSON.stringify(urls));
  } catch {
    // storage unavailable: a restore then uses the public relays
  }
}

export function clearPairedRelays(): void {
  try {
    window.localStorage.removeItem(PAIRED_KEY);
  } catch {
    // ignore
  }
}

/** Relays for the session in storage (pairings made before this change used the public relays). */
export function relaysForStoredSession(): string[] {
  return readPairedRelays() ?? [...PUBLIC_RELAY_URLS];
}

export function hasStoredWizardSession(): boolean {
  try {
    return window.localStorage.getItem('wizardconnect-session') !== null;
  } catch {
    return false;
  }
}
