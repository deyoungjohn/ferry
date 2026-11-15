import { bytesToHex } from 'viem';
import type { Hex } from './terms.js';

const CASHADDR_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const CASHADDR_PREFIXES = new Set(['bitcoincash', 'bchtest', 'bchreg']);

export type CashAddrPrefix = 'bitcoincash' | 'bchtest' | 'bchreg';
export type CashAddrType =
  'p2pkh' | 'p2sh' | 'p2pkhWithTokens' | 'p2shWithTokens';

export interface DecodedCashAddress {
  prefix: CashAddrPrefix;
  type: CashAddrType;
  tokenAware: boolean;
  hash: Uint8Array;
  lockingBytecode: Hex;
}

function polymod(values: number[]): bigint {
  let c = 1n;
  const generators = [
    0x98f2bc8e61n,
    0x79b76d99e2n,
    0xf33e5fb3c4n,
    0xae2eabe2a8n,
    0x1e4f43e470n,
  ] as const;

  for (const d of values) {
    const c0 = c >> 35n;
    c = ((c & 0x07ffffffffn) << 5n) ^ BigInt(d);
    if ((c0 & 1n) !== 0n) c ^= generators[0];
    if ((c0 & 2n) !== 0n) c ^= generators[1];
    if ((c0 & 4n) !== 0n) c ^= generators[2];
    if ((c0 & 8n) !== 0n) c ^= generators[3];
    if ((c0 & 16n) !== 0n) c ^= generators[4];
  }
  return c ^ 1n;
}

function prefixToData(prefix: string): number[] {
  const result: number[] = [];
  for (let i = 0; i < prefix.length; i++) {
    result.push(prefix.charCodeAt(i) & 0x1f);
  }
  result.push(0);
  return result;
}

function convert5to8(data: number[]): Uint8Array {
  let acc = 0;
  let bits = 0;
  const out: number[] = [];
  for (const value of data) {
    acc = (acc << 5) | value;
    bits += 5;
    while (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 0xff);
    }
  }
  if (bits >= 5 || ((acc << (8 - bits)) & 0xff) !== 0) {
    throw new Error('Invalid CashAddr padding');
  }
  return new Uint8Array(out);
}

const SIZE_BITS_TO_BYTES: Record<number, number> = {
  0: 20,
  1: 24,
  2: 28,
  3: 32,
  4: 40,
  5: 48,
  6: 56,
  7: 64,
};

function deriveLockingBytecode(type: CashAddrType, hash: Uint8Array): Hex {
  if (type === 'p2pkh' || type === 'p2pkhWithTokens') {
    if (hash.length !== 20) {
      throw new Error(
        `Invalid P2PKH hash length: expected 20, got ${hash.length}`,
      );
    }
    const script = new Uint8Array(25);
    script[0] = 0x76;
    script[1] = 0xa9;
    script[2] = 0x14;
    script.set(hash, 3);
    script[23] = 0x88;
    script[24] = 0xac;
    return bytesToHex(script).toLowerCase() as Hex;
  }

  if (hash.length === 20) {
    const script = new Uint8Array(23);
    script[0] = 0xa9;
    script[1] = 0x14;
    script.set(hash, 2);
    script[22] = 0x87;
    return bytesToHex(script).toLowerCase() as Hex;
  }

  if (hash.length === 32) {
    const script = new Uint8Array(35);
    script[0] = 0xaa;
    script[1] = 0x20;
    script.set(hash, 2);
    script[34] = 0x87;
    return bytesToHex(script).toLowerCase() as Hex;
  }

  throw new Error(
    `Unsupported P2SH hash length: expected 20 or 32, got ${hash.length}`,
  );
}

/**
 * Decode and checksum-verify a Bitcoin Cash CashAddr string.
 * Requires an explicit prefix (bitcoincash:, bchtest:, or bchreg:).
 */
export function decodeCashAddress(address: string): DecodedCashAddress {
  if (typeof address !== 'string' || address.length === 0) {
    throw new Error('CashAddr must be a non-empty string');
  }
  const hasUpper = /[A-Z]/.test(address);
  const hasLower = /[a-z]/.test(address);
  if (hasUpper && hasLower) {
    throw new Error('CashAddr must not mix uppercase and lowercase');
  }

  const normalized = address.toLowerCase();
  const colonIdx = normalized.indexOf(':');
  if (colonIdx <= 0) {
    throw new Error(
      'CashAddr must include a network prefix (e.g. bitcoincash:)',
    );
  }

  const prefix = normalized.slice(0, colonIdx);
  if (!CASHADDR_PREFIXES.has(prefix)) {
    throw new Error(`Unsupported CashAddr prefix: ${prefix}`);
  }

  const payload = normalized.slice(colonIdx + 1);
  if (payload.length < 9) {
    throw new Error('CashAddr payload is too short');
  }

  const words: number[] = [];
  for (let i = 0; i < payload.length; i++) {
    const idx = CASHADDR_CHARSET.indexOf(payload[i]!);
    if (idx === -1) {
      throw new Error(`Invalid CashAddr character: ${payload[i]}`);
    }
    words.push(idx);
  }

  if (polymod([...prefixToData(prefix), ...words]) !== 0n) {
    throw new Error('Invalid CashAddr checksum');
  }

  const data = convert5to8(words.slice(0, -8));
  if (data.length < 1) {
    throw new Error('CashAddr missing version byte');
  }

  const versionByte = data[0]!;
  const typeBits = (versionByte >> 3) & 0x0f;
  const sizeBits = versionByte & 0x07;
  const expectedLength = SIZE_BITS_TO_BYTES[sizeBits];
  const hash = data.slice(1);
  if (expectedLength === undefined || hash.length !== expectedLength) {
    throw new Error('CashAddr hash length does not match version byte');
  }

  let type: CashAddrType;
  let tokenAware = false;
  switch (typeBits) {
    case 0:
      type = 'p2pkh';
      break;
    case 1:
      type = 'p2sh';
      break;
    case 2:
      type = 'p2pkhWithTokens';
      tokenAware = true;
      break;
    case 3:
      type = 'p2shWithTokens';
      tokenAware = true;
      break;
    default:
      throw new Error(`Unsupported CashAddr type bits: ${typeBits}`);
  }

  const lockingBytecode = deriveLockingBytecode(type, hash);
  return {
    prefix: prefix as CashAddrPrefix,
    type,
    tokenAware,
    hash,
    lockingBytecode,
  };
}

export function cashAddressToLockingBytecode(address: string): Hex {
  return decodeCashAddress(address).lockingBytecode;
}
