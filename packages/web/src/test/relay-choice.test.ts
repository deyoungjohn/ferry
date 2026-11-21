import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PUBLIC_RELAY_URLS,
  chooseRelayUrls,
  probeRelay,
  readPairedRelays,
  relaysForStoredSession,
  savePairedRelays,
} from '../lib/wallet/relay-choice';

const OWN = 'wss://relay.ferry.example';

describe('chooseRelayUrls', () => {
  it('puts Ferry’s relay first when it answers, keeping the public relays behind it', async () => {
    const urls = await chooseRelayUrls([OWN], async () => true);
    expect(urls).toEqual([OWN, ...PUBLIC_RELAY_URLS]);
  });

  it('falls back to the public relays when Ferry’s relay does not answer', async () => {
    const urls = await chooseRelayUrls([OWN], async () => false);
    expect(urls).toEqual([...PUBLIC_RELAY_URLS]);
  });

  it('uses the public relays when no own relay is configured', async () => {
    const probe = vi.fn(async () => true);
    expect(await chooseRelayUrls([], probe)).toEqual([...PUBLIC_RELAY_URLS]);
    expect(probe).not.toHaveBeenCalled();
  });
});

describe('probeRelay', () => {
  it('resolves true on open and false on error or timeout', async () => {
    class Opens {
      onopen: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor() {
        setTimeout(() => this.onopen?.(), 0);
      }
      close() {}
    }
    class Fails {
      onopen: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor() {
        setTimeout(() => this.onerror?.(), 0);
      }
      close() {}
    }
    class Silent {
      onopen: (() => void) | null = null;
      onerror: (() => void) | null = null;
      close() {}
    }
    expect(await probeRelay(OWN, 1000, Opens)).toBe(true);
    expect(await probeRelay(OWN, 1000, Fails)).toBe(false);
    expect(await probeRelay(OWN, 20, Silent)).toBe(false);
  });
});

describe('paired relays', () => {
  afterEach(() => window.localStorage.clear());

  it('restores a session on the relays it was paired on', () => {
    savePairedRelays([OWN, ...PUBLIC_RELAY_URLS]);
    expect(readPairedRelays()).toEqual([OWN, ...PUBLIC_RELAY_URLS]);
    expect(relaysForStoredSession()[0]).toBe(OWN);
  });

  it('treats a session saved before this change as paired on the public relays', () => {
    expect(relaysForStoredSession()).toEqual([...PUBLIC_RELAY_URLS]);
    window.localStorage.setItem('ferry-wizard-relays', '"junk"');
    expect(relaysForStoredSession()).toEqual([...PUBLIC_RELAY_URLS]);
  });
});
