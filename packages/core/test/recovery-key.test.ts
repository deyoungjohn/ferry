import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { sha256 } from 'viem';
import {
  deriveRecoveryRoot,
  swapCancelHashAt,
  swapCancelKeyAt,
  swapHashLockAt,
  swapSecretAt,
  swapTagAt,
} from '../src/recovery-key.js';

const SIGNATURE = `0x${'ab'.repeat(65)}` as const;

function nodeHmac(key: Buffer, data: Buffer): Buffer {
  return createHmac('sha256', key).update(data).digest();
}

describe('wallet-derived recovery keys', () => {
  it('derives the root with HKDF-SHA256, as Node computes it', () => {
    const prk = nodeHmac(
      Buffer.from('ferry-recovery-v1'),
      Buffer.from(SIGNATURE.slice(2), 'hex'),
    );
    const okm = nodeHmac(
      prk,
      Buffer.concat([Buffer.from('root'), Buffer.from([1])]),
    );
    expect(deriveRecoveryRoot(SIGNATURE)).toBe(`0x${okm.toString('hex')}`);
  });

  it('gives the same secrets for the same signature, and different ones per index', () => {
    const root = deriveRecoveryRoot(SIGNATURE);
    expect(swapSecretAt(root, 0)).toBe(
      swapSecretAt(deriveRecoveryRoot(SIGNATURE), 0),
    );
    expect(swapSecretAt(root, 0)).not.toBe(swapSecretAt(root, 1));
    const expected = nodeHmac(
      Buffer.from(root.slice(2), 'hex'),
      Buffer.from('ferry:swap-secret:v1:7'),
    );
    expect(swapSecretAt(root, 7)).toBe(`0x${expected.toString('hex')}`);
  });

  it('hashes the secret into the lock, and tags are 8 bytes', () => {
    const root = deriveRecoveryRoot(SIGNATURE);
    expect(swapHashLockAt(root, 3)).toBe(sha256(swapSecretAt(root, 3)));
    expect(swapTagAt(root, 3)).toMatch(/^0x[0-9a-f]{16}$/);
  });

  it('derives domain-separated cancel key and hash, matching node hmac', () => {
    const root = deriveRecoveryRoot(SIGNATURE);
    expect(swapCancelKeyAt(root, 0)).toBe(swapCancelKeyAt(root, 0));
    expect(swapCancelKeyAt(root, 0)).not.toBe(swapCancelKeyAt(root, 1));
    // Must be completely different from swapSecretAt
    expect(swapCancelKeyAt(root, 0)).not.toBe(swapSecretAt(root, 0));

    const expected = nodeHmac(
      Buffer.from(root.slice(2), 'hex'),
      Buffer.from('ferry:swap-cancel:v1:5'),
    );
    expect(swapCancelKeyAt(root, 5)).toBe(`0x${expected.toString('hex')}`);
    expect(swapCancelHashAt(root, 5)).toBe(sha256(swapCancelKeyAt(root, 5)));
  });

  it('refuses a short signature and a bad index', () => {
    expect(() => deriveRecoveryRoot('0x1234')).toThrow(RangeError);
    const root = deriveRecoveryRoot(SIGNATURE);
    expect(() => swapSecretAt(root, -1)).toThrow(RangeError);
    expect(() => swapCancelKeyAt(root, -1)).toThrow(RangeError);
  });
});
