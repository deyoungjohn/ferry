import { bytesToHex, concat, hexToBytes, sha256, stringToBytes } from 'viem';
import type { Hex32 } from './terms.js';

/**
 * Wallet-derived recovery keys: a swap's secret comes from the person's wallet instead of a file.
 *
 * The page asks the wallet to sign one fixed message, once. The signature is the input key
 * material for a root key; swap n's secret is HMAC(root, n). On any device, signing the same
 * message again gives the same root, so every secret (and so every hash lock and EVM lock id) can
 * be recomputed and the swaps found on chain, scanning n = 0, 1, 2, … until a run of misses.
 *
 * This depends on the wallet producing the same signature for the same message (RFC 6979
 * deterministic ECDSA, which ordinary EVM and Bitcoin Cash key wallets do). A wallet that does
 * not (some smart-contract wallets) is detected by signing twice; such a person keeps the old
 * per-swap file instead.
 */

/** EIP-712 message an EVM wallet signs to make its recovery key. No chain id: the same everywhere. */
export const EVM_RECOVERY_KEY_TYPED_DATA = {
  domain: { name: 'Ferry', version: '1' },
  types: {
    RecoveryKey: [
      { name: 'purpose', type: 'string' },
      { name: 'version', type: 'uint8' },
    ],
  },
  primaryType: 'RecoveryKey',
  message: {
    purpose:
      'Ferry recovery key. Signing this lets Ferry find and finish your swaps on any device. It does not move funds.',
    version: 1,
  },
} as const;

/** Plain-text message a Bitcoin Cash wallet signs (Bitcoin signed-message format) for its key. */
export const BCH_RECOVERY_KEY_MESSAGE =
  'Ferry recovery key v1. Signing this lets Ferry find and finish your swaps on any device. It does not move funds.';

/** How many unused indexes in a row end a scan for swaps. */
export const RECOVERY_SCAN_GAP = 20;

const BLOCK = 64;

function hmacSha256(key: Uint8Array, message: Uint8Array): Uint8Array {
  let k = key;
  if (k.length > BLOCK) k = hexToBytes(sha256(k));
  const padded = new Uint8Array(BLOCK);
  padded.set(k);
  const inner = new Uint8Array(BLOCK);
  const outer = new Uint8Array(BLOCK);
  for (let i = 0; i < BLOCK; i += 1) {
    inner[i] = padded[i]! ^ 0x36;
    outer[i] = padded[i]! ^ 0x5c;
  }
  const innerHash = hexToBytes(sha256(concat([inner, message])));
  return hexToBytes(sha256(concat([outer, innerHash])));
}

/**
 * The root key from a wallet's recovery signature (65-byte EVM signature, or the decoded bytes of
 * a Bitcoin signed message). HKDF-SHA256 extract and one expand block.
 */
export function deriveRecoveryRoot(
  signature: Uint8Array | `0x${string}`,
): Hex32 {
  const ikm = typeof signature === 'string' ? hexToBytes(signature) : signature;
  if (ikm.length < 64) {
    throw new RangeError('A recovery signature must be at least 64 bytes');
  }
  const prk = hmacSha256(stringToBytes('ferry-recovery-v1'), ikm);
  const okm = hmacSha256(
    prk,
    concat([stringToBytes('root'), new Uint8Array([1])]),
  );
  return bytesToHex(okm) as Hex32;
}

/** Swap n's 32-byte secret under a root key. */
export function swapSecretAt(root: Hex32, index: number): Hex32 {
  if (!Number.isSafeInteger(index) || index < 0) {
    throw new RangeError('The swap index must be a non-negative integer');
  }
  return bytesToHex(
    hmacSha256(
      hexToBytes(root),
      stringToBytes(`ferry:swap-secret:v1:${index}`),
    ),
  ) as Hex32;
}

/** Swap n's hash lock (sha256 of its secret), the value the contracts are locked with. */
export function swapHashLockAt(root: Hex32, index: number): Hex32 {
  return sha256(swapSecretAt(root, index)) as Hex32;
}

/**
 * A short tag that marks a Bitcoin Cash lock as this person's swap n, for the terms output in the
 * lock transaction. Reveals nothing about the root or the secret.
 */
export function swapTagAt(root: Hex32, index: number): `0x${string}` {
  return bytesToHex(
    hmacSha256(
      hexToBytes(root),
      stringToBytes(`ferry:swap-tag:v1:${index}`),
    ).slice(0, 8),
  );
}

/**
 * Swap n's 32-byte cancel key under a root key. Used only to cancel an unclaimed send link.
 * Domain-separated from swap secrets and tags so revealing it opens nothing else.
 */
export function swapCancelKeyAt(root: Hex32, index: number): Hex32 {
  if (!Number.isSafeInteger(index) || index < 0) {
    throw new RangeError('The swap index must be a non-negative integer');
  }
  return bytesToHex(
    hmacSha256(
      hexToBytes(root),
      stringToBytes(`ferry:swap-cancel:v1:${index}`),
    ),
  ) as Hex32;
}

/**
 * Swap n's cancel hash (sha256 of its cancel key), sent with the send quote at creation
 * and stored beside the order.
 */
export function swapCancelHashAt(root: Hex32, index: number): Hex32 {
  return sha256(swapCancelKeyAt(root, index)) as Hex32;
}
