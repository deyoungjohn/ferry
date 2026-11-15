import { describe, expect, it } from 'vitest';
import { revealPolicy } from '../src/index.js';

describe('revealPolicy decision table', () => {
  it('allows BCH safe lane only at >= 1 confirmation', () => {
    expect(
      revealPolicy({
        chain: 'bch',
        lane: 'safe',
        fastOptIn: false,
        amountUsdMicros: 100_000_000n,
        evidence: {
          exists: true,
          confirmations: 0,
          dsproof: 'clear',
          dsproofElapsedMs: 6000,
        },
      }),
    ).toEqual({ allowed: false, reason: 'waiting-finality' });

    expect(
      revealPolicy({
        chain: 'bch',
        lane: 'safe',
        fastOptIn: false,
        amountUsdMicros: 100_000_000n,
        evidence: { exists: true, confirmations: 1 },
      }),
    ).toEqual({ allowed: true, reason: 'ready' });
  });

  it('enforces BCH fast lane consent, $25 cap, and 5000 ms dsproof window', () => {
    expect(
      revealPolicy({
        chain: 'bch',
        lane: 'fast',
        fastOptIn: false,
        amountUsdMicros: 10_000_000n,
        evidence: {
          exists: true,
          confirmations: 0,
          dsproof: 'clear',
          dsproofElapsedMs: 5000,
        },
      }),
    ).toEqual({ allowed: false, reason: 'fast-consent' });

    expect(
      revealPolicy({
        chain: 'bch',
        lane: 'fast',
        fastOptIn: true,
        amountUsdMicros: 25_000_001n,
        evidence: {
          exists: true,
          confirmations: 0,
          dsproof: 'clear',
          dsproofElapsedMs: 5000,
        },
      }),
    ).toEqual({ allowed: false, reason: 'fast-cap' });

    expect(
      revealPolicy({
        chain: 'bch',
        lane: 'fast',
        fastOptIn: true,
        amountUsdMicros: 25_000_000n,
        evidence: {
          exists: true,
          confirmations: 0,
          dsproof: 'detected',
          dsproofElapsedMs: 5000,
        },
      }),
    ).toEqual({ allowed: false, reason: 'dsproof' });

    expect(
      revealPolicy({
        chain: 'bch',
        lane: 'fast',
        fastOptIn: true,
        amountUsdMicros: 25_000_000n,
        evidence: {
          exists: true,
          confirmations: 0,
          dsproof: 'clear',
          dsproofElapsedMs: 4999,
        },
      }),
    ).toEqual({ allowed: false, reason: 'waiting-finality' });

    expect(
      revealPolicy({
        chain: 'bch',
        lane: 'fast',
        fastOptIn: true,
        amountUsdMicros: 25_000_000n,
        evidence: {
          exists: true,
          confirmations: 0,
          dsproof: 'clear',
          dsproofElapsedMs: 5000,
        },
      }),
    ).toEqual({ allowed: true, reason: 'ready' });
  });

  it('rejects missing locks and checks EVM chain finality rules', () => {
    expect(
      revealPolicy({
        chain: 'base',
        lane: 'safe',
        fastOptIn: false,
        amountUsdMicros: 10_000_000n,
        evidence: { exists: false, confirmations: 100, safe: true },
      }),
    ).toEqual({ allowed: false, reason: 'missing-lock' });

    expect(
      revealPolicy({
        chain: 'base',
        lane: 'fast',
        fastOptIn: true,
        amountUsdMicros: 10_000_000n,
        evidence: { exists: true, confirmations: 10 },
      }),
    ).toEqual({ allowed: true, reason: 'ready' });

    expect(
      revealPolicy({
        chain: 'base',
        lane: 'safe',
        fastOptIn: false,
        amountUsdMicros: 100_000_000n,
        evidence: {
          exists: true,
          confirmations: 10,
          safe: false,
          finalized: false,
        },
      }),
    ).toEqual({ allowed: false, reason: 'waiting-finality' });

    expect(
      revealPolicy({
        chain: 'ethereum',
        lane: 'safe',
        fastOptIn: false,
        amountUsdMicros: 100_000_000n,
        evidence: { exists: true, confirmations: 3, finalized: true },
      }),
    ).toEqual({ allowed: true, reason: 'ready' });

    expect(
      revealPolicy({
        chain: 'arbitrum',
        lane: 'fast',
        fastOptIn: true,
        amountUsdMicros: 10_000_000n,
        evidence: { exists: true, confirmations: 1, ageSeconds: 10 },
      }),
    ).toEqual({ allowed: true, reason: 'ready' });

    expect(
      revealPolicy({
        chain: 'arc',
        lane: 'safe',
        fastOptIn: false,
        amountUsdMicros: 100_000_000n,
        evidence: { exists: true, confirmations: 1, finalized: true },
      }),
    ).toEqual({ allowed: true, reason: 'ready' });

    expect(
      revealPolicy({
        chain: 'bnb',
        lane: 'safe',
        fastOptIn: false,
        amountUsdMicros: 100_000_000n,
        evidence: { exists: true, confirmations: 1, finalized: true },
      }),
    ).toEqual({ allowed: true, reason: 'ready' });

    expect(() =>
      revealPolicy({
        chain: 'bch',
        lane: 'safe',
        fastOptIn: false,
        amountUsdMicros: -1n,
        evidence: { exists: true, confirmations: 1 },
      }),
    ).toThrow(RangeError);
    expect(() =>
      revealPolicy({
        chain: 'bch',
        lane: 'safe',
        fastOptIn: false,
        amountUsdMicros: 100n,
        evidence: { exists: true, confirmations: -1 },
      }),
    ).toThrow(RangeError);
    expect(() =>
      revealPolicy({
        chain: 'bch',
        lane: 'safe',
        fastOptIn: false,
        amountUsdMicros: 100n,
        evidence: { exists: true, confirmations: 1, ageSeconds: -1 },
      }),
    ).toThrow(RangeError);
    expect(() =>
      revealPolicy(
        {
          chain: 'bch',
          lane: 'safe',
          fastOptIn: false,
          amountUsdMicros: 100n,
          evidence: { exists: true, confirmations: 1 },
        },
        {
          zeroConfMaxUsdMicros: 25_000_000n,
          dsproofWindowMs: 0,
          baseConfirmations: 10,
          ethereumConfirmations: 3,
          arbitrumAgeSeconds: 10,
        },
      ),
    ).toThrow(RangeError);
  });
});
