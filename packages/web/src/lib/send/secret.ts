import { binToHex, hexToBin, sha256 as libauthSha256 } from '@bitauth/libauth';
import type { Hex32 } from '@ferry/core';

/**
 * Generate a cryptographically secure 32-byte secret in the browser.
 */
export function generateSecret(): Hex32 {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}` as Hex32;
}

/**
 * SHA-256 hash of the 32-byte secret preimage to produce the hash lock.
 */
export function hashSecret(secret: string): Hex32 {
  const clean = secret.replace(/^0x/i, '');
  const bin = hexToBin(clean);
  return `0x${binToHex(libauthSha256.hash(bin))}` as Hex32;
}

/**
 * Extracts and normalizes the secret from a URL fragment or hash string.
 * Browsers never send the fragment (#...) to servers.
 */
export function extractSecretFromHash(hashOrUrl: string): Hex32 | null {
  const hashIndex = hashOrUrl.indexOf('#');
  const fragment = hashIndex >= 0 ? hashOrUrl.slice(hashIndex + 1) : hashOrUrl;
  const clean = fragment.trim().replace(/^0x/i, '');
  if (/^[0-9a-fA-F]{64}$/.test(clean)) {
    return `0x${clean.toLowerCase()}` as Hex32;
  }
  return null;
}
