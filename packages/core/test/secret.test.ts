import { describe, expect, it } from 'vitest';
import { sha256 } from 'viem';
import { assertValidSecret, isValidSecret } from '../src/index.js';

describe('secret validation', () => {
  const validSecret = `0x${'01'.repeat(32)}` as const;
  const validHashLock = sha256(validSecret);

  it('accepts a valid 32-byte secret matching hashLock (with or without 0x)', () => {
    expect(isValidSecret(validSecret, validHashLock)).toBe(true);
    expect(isValidSecret(validSecret.slice(2), validHashLock.slice(2))).toBe(
      true,
    );
    expect(() => assertValidSecret(validSecret, validHashLock)).not.toThrow();
  });

  it('rejects null, undefined, empty, zero-length, wrong-length, and non-hex secrets', () => {
    expect(isValidSecret(null, validHashLock)).toBe(false);
    expect(isValidSecret(undefined, validHashLock)).toBe(false);
    expect(isValidSecret('', validHashLock)).toBe(false);
    expect(isValidSecret('0x', validHashLock)).toBe(false);
    expect(isValidSecret(`0x${'01'.repeat(31)}`, validHashLock)).toBe(false);
    expect(isValidSecret(`0x${'01'.repeat(33)}`, validHashLock)).toBe(false);
    expect(isValidSecret(`0x${'zz'.repeat(32)}`, validHashLock)).toBe(false);
    expect(isValidSecret(validSecret, '0x1234')).toBe(false);
    expect(isValidSecret(validSecret, null)).toBe(false);
  });

  it('rejects a 32-byte zero secret unless hashLock is sha256(zeros)', () => {
    const zeros = `0x${'00'.repeat(32)}`;
    expect(isValidSecret(zeros, validHashLock)).toBe(false);
    expect(() => assertValidSecret(zeros, validHashLock)).toThrow();
  });

  it('rejects a mismatched 32-byte secret', () => {
    const other = `0x${'02'.repeat(32)}`;
    expect(isValidSecret(other, validHashLock)).toBe(false);
    expect(() => assertValidSecret(other, validHashLock, 'claim')).toThrow(
      /Invalid claim/,
    );
  });
});
