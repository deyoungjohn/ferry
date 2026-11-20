import {
  generateKeyExchangeCredentials,
  encodeKeyExchangeURI,
  decodeKeyExchangeURI,
} from '@wizardconnect/core';
import { describe, expect, it } from 'vitest';

describe('WizardConnect Relay & Pairing Configuration', () => {
  it('encodes and parses custom relay hostname and proves Paytaca single-relay lock-in behavior', () => {
    const creds = generateKeyExchangeCredentials();
    const { uri } = encodeKeyExchangeURI(creds.publicKey, creds.secret, {
      hostname: 'relay.example.org',
      port: 443,
      protocol: 'wss',
    });

    expect(uri).toContain('wiz://relay.example.org');

    const decoded = decodeKeyExchangeURI(uri);

    expect(decoded.publicKey).toBe(creds.publicKey);
    expect(decoded.secret).toBe(creds.secret);
    expect(decoded.hostname).toBe('relay.example.org');
    expect(decoded.port).toBe(443);
    expect(decoded.protocol).toBe('wss');

    // In @wizardconnect/core wallet-relay.ts, when decoded.relayUrl exists,
    // Paytaca connects ONLY to that single relayUrl, bypassing default fallbacks:
    const targetRelays = decoded.hostname
      ? [`${decoded.protocol}://${decoded.hostname}:${decoded.port}`]
      : ['wss://relay.riften.net:443', 'wss://relay.cauldron.quest:443'];

    expect(targetRelays).toEqual(['wss://relay.example.org:443']);
    expect(targetRelays).not.toContain('wss://relay.riften.net:443');
    expect(targetRelays).not.toContain('wss://relay.cauldron.quest:443');
  });

  it('supports ws protocol and non-standard ports for local development', () => {
    const creds = generateKeyExchangeCredentials();
    const { uri } = encodeKeyExchangeURI(creds.publicKey, creds.secret, {
      hostname: '127.0.0.1',
      port: 8088,
      protocol: 'ws',
    });

    expect(uri).toContain('wiz://127.0.0.1:8088');

    const decoded = decodeKeyExchangeURI(uri);

    expect(decoded.hostname).toBe('127.0.0.1');
    expect(decoded.port).toBe(8088);
    expect(decoded.protocol).toBe('ws');
    expect(decoded.secret).toBe(creds.secret);
  });

  it('parses comma-separated relay URLs from environment', () => {
    const raw = 'wss://relay.example.org:443, wss://relay.cauldron.quest:443 ';
    const parsed = raw
      .split(',')
      .map((u) => u.trim())
      .filter((u) => u.length > 0);

    expect(parsed).toEqual([
      'wss://relay.example.org:443',
      'wss://relay.cauldron.quest:443',
    ]);
  });
});
