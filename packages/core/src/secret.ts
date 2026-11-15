import { sha256 } from 'viem';
import type { Hex32 } from './terms.js';

/**
 * Validates that a secret is a well-formed 32-byte hex string (with or without 0x)
 * and that sha256(secret) strictly matches hashLock.
 */
export function isValidSecret(
  secret: string | null | undefined,
  hashLock: string | null | undefined,
): boolean {
  if (!secret || typeof secret !== 'string') return false;
  if (!hashLock || typeof hashLock !== 'string') return false;

  const cleanSecret = secret.toLowerCase().startsWith('0x')
    ? secret.slice(2)
    : secret;
  if (cleanSecret.length !== 64 || !/^[0-9a-fA-F]{64}$/.test(cleanSecret)) {
    return false;
  }

  const cleanHash = hashLock.toLowerCase().startsWith('0x')
    ? hashLock.slice(2)
    : hashLock;
  if (cleanHash.length !== 64 || !/^[0-9a-fA-F]{64}$/.test(cleanHash)) {
    return false;
  }

  try {
    const computed = sha256(`0x${cleanSecret}` as Hex32);
    return computed.slice(2).toLowerCase() === cleanHash.toLowerCase();
  } catch {
    return false;
  }
}

/**
 * Asserts that secret is 32 bytes and sha256(secret) === hashLock.
 */
export function assertValidSecret(
  secret: string | null | undefined,
  hashLock: string | null | undefined,
  context = 'secret',
): asserts secret is Hex32 {
  if (!isValidSecret(secret, hashLock)) {
    throw new Error(
      `Invalid ${context}: secret is missing, malformed, or sha256(secret) does not match hashLock`,
    );
  }
}
