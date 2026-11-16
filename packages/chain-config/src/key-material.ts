import {
  createECDH,
  createHash,
  randomBytes as osRandomBytes,
} from 'node:crypto';
import { getAddress, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

export type RandomSource = (length: number) => Uint8Array;

export interface BchKeyAddresses {
  tokenAware: string;
  plain: string;
}

export interface GeneratedKeyMaterial {
  deployerEvmPrivateKey: Hex;
  solverEvmPrivateKey: Hex;
  solverBchWif: string;
  addresses: {
    deployerEvm: Address;
    solverEvm: Address;
    solverBch: BchKeyAddresses;
  };
}

export interface DecodedWif {
  privateKey: Uint8Array;
  mainnet: boolean;
  compressed: boolean;
}

export type AccountCodeKind = 'empty' | 'delegated' | 'code';

const BASE58_ALPHABET =
  '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const BASE58_INDEX = new Map(
  [...BASE58_ALPHABET].map((character, index) => [character, index]),
);
const CASHADDR_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const BCH_MAINNET_PREFIX = 'bitcoincash';

export const KNOWN_DEV_EVM_KEYS: readonly Hex[] = [
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
  '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6',
  '0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a',
  '0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba',
  '0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e',
  '0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356',
  '0xdbda1821b80551c9d65939329250298aa3472ba22feea921c0cf5d620ea67b97',
  '0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6',
  '0x0000000000000000000000000000000000000000000000000000000000000000',
];

const KNOWN_DEV_EVM_KEY_SET = new Set(
  KNOWN_DEV_EVM_KEYS.map((key) => normalizePrivateKey(key)),
);

function defaultRandomSource(length: number): Uint8Array {
  return Uint8Array.from(osRandomBytes(length));
}

function normalizePrivateKey(value: string): string {
  return value.trim().toLowerCase().replace(/^0x/, '');
}

function privateKeyHex(bytes: Uint8Array): Hex {
  return `0x${Buffer.from(bytes).toString('hex')}` as Hex;
}

function sha256(data: Uint8Array): Uint8Array {
  return createHash('sha256').update(data).digest();
}

function sha256d(data: Uint8Array): Uint8Array {
  return sha256(sha256(data));
}

function base58Encode(payload: Uint8Array): string {
  let zeros = 0;
  while (zeros < payload.length && payload[zeros] === 0) zeros += 1;
  let value = 0n;
  for (const byte of payload) value = (value << 8n) | BigInt(byte);
  let encoded = '';
  while (value > 0n) {
    encoded = BASE58_ALPHABET[Number(value % 58n)]! + encoded;
    value /= 58n;
  }
  return '1'.repeat(zeros) + encoded;
}

function base58Decode(value: string): Uint8Array {
  let zeros = 0;
  while (zeros < value.length && value[zeros] === '1') zeros += 1;
  let decoded = 0n;
  for (const character of value) {
    const index = BASE58_INDEX.get(character);
    if (index === undefined) throw new Error('Invalid base58 character');
    decoded = decoded * 58n + BigInt(index);
  }
  const bytes: number[] = [];
  while (decoded > 0n) {
    bytes.push(Number(decoded % 256n));
    decoded /= 256n;
  }
  return Uint8Array.from([...new Uint8Array(zeros), ...bytes.reverse()]);
}

function derivePublicKey(privateKey: Uint8Array): Uint8Array {
  const ecdh = createECDH('secp256k1');
  ecdh.setPrivateKey(Buffer.from(privateKey));
  return Uint8Array.from(ecdh.getPublicKey(undefined, 'compressed'));
}

function hash160(value: Uint8Array): Uint8Array {
  return Uint8Array.from(
    createHash('ripemd160').update(sha256(value)).digest(),
  );
}

function polymod(values: readonly number[]): bigint {
  let checksum = 1n;
  const generators = [
    0x98f2bc8e61n,
    0x79b76d99e2n,
    0xf33e5fb3c4n,
    0xae2eabe2a8n,
    0x1e4f43e470n,
  ] as const;
  for (const value of values) {
    const top = checksum >> 35n;
    checksum = ((checksum & 0x07ffffffffn) << 5n) ^ BigInt(value);
    if ((top & 1n) !== 0n) checksum ^= generators[0];
    if ((top & 2n) !== 0n) checksum ^= generators[1];
    if ((top & 4n) !== 0n) checksum ^= generators[2];
    if ((top & 8n) !== 0n) checksum ^= generators[3];
    if ((top & 16n) !== 0n) checksum ^= generators[4];
  }
  return checksum ^ 1n;
}

function prefixData(prefix: string): number[] {
  const data: number[] = [];
  for (const character of prefix) data.push(character.charCodeAt(0) & 0x1f);
  data.push(0);
  return data;
}

function convert8to5(data: readonly number[]): number[] {
  let accumulator = 0;
  let bits = 0;
  const result: number[] = [];
  for (const value of data) {
    accumulator = (accumulator << 8) | value;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      result.push((accumulator >> bits) & 0x1f);
    }
  }
  if (bits > 0) result.push((accumulator << (5 - bits)) & 0x1f);
  return result;
}

function cashAddress(
  prefix: string,
  typeBits: number,
  hash: Uint8Array,
): string {
  if (hash.length !== 20) throw new Error('CashAddress hash must be 20 bytes');
  const version = (typeBits << 3) | 0;
  const payload = convert8to5([version, ...hash]);
  const checksum = polymod([
    ...prefixData(prefix),
    ...payload,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
  ]);
  const words = [...payload];
  for (let index = 7; index >= 0; index -= 1) {
    words.push(Number((checksum >> BigInt(index * 5)) & 0x1fn));
  }
  return `${prefix}:${words.map((word) => CASHADDR_CHARSET[word]!).join('')}`;
}

function randomEvmKey(random: RandomSource): Hex {
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const bytes = random(32);
    if (bytes.length !== 32) {
      throw new Error('Random source must return exactly 32 bytes');
    }
    const key = privateKeyHex(bytes);
    try {
      privateKeyToAccount(key);
      if (knownTestKeyReason(key) !== null) continue;
      return key;
    } catch {
      // A random 32-byte value can be outside the secp256k1 order; retry.
    }
  }
  throw new Error('Random source did not produce a valid EVM key');
}

function randomBchKey(random: RandomSource): {
  privateKey: Uint8Array;
  wif: string;
} {
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const bytes = random(32);
    if (bytes.length !== 32) {
      throw new Error('Random source must return exactly 32 bytes');
    }
    try {
      const wif = encodeMainnetWif(bytes);
      decodeWif(wif);
      if (knownTestKeyReason(privateKeyHex(bytes)) !== null) continue;
      return { privateKey: bytes, wif };
    } catch {
      // Retry a value that is not a valid secp256k1 key.
    }
  }
  throw new Error('Random source did not produce a valid BCH key');
}

export function encodeMainnetWif(privateKey: Uint8Array): string {
  if (privateKey.length !== 32) throw new Error('BCH key must be 32 bytes');
  const body = Uint8Array.from([0x80, ...privateKey, 0x01]);
  const checksum = sha256d(body).slice(0, 4);
  return base58Encode(Uint8Array.from([...body, ...checksum]));
}

export function decodeWif(value: string): DecodedWif | null {
  try {
    const raw = base58Decode(value.trim());
    if (raw.length !== 38 || raw[0] !== 0x80) return null;
    const body = raw.slice(0, 34);
    const checksum = raw.slice(34);
    const expected = sha256d(body).slice(0, 4);
    if (checksum.some((byte, index) => byte !== expected[index])) return null;
    if (raw[33] !== 0x01) return null;
    const privateKey = Uint8Array.from(raw.slice(1, 33));
    derivePublicKey(privateKey);
    return { privateKey, mainnet: true, compressed: true };
  } catch {
    return null;
  }
}

export function isBchMainnetWif(value: string): boolean {
  return decodeWif(value) !== null;
}

export function deriveBchAddressesFromPrivateKey(
  privateKey: Uint8Array,
): BchKeyAddresses {
  const publicKey = derivePublicKey(privateKey);
  const hash = hash160(publicKey);
  return {
    tokenAware: cashAddress(BCH_MAINNET_PREFIX, 2, hash),
    plain: cashAddress(BCH_MAINNET_PREFIX, 0, hash),
  };
}

export function deriveBchAddressesFromWif(wif: string): BchKeyAddresses {
  const decoded = decodeWif(wif);
  if (decoded === null) throw new Error('Invalid mainnet BCH WIF');
  return deriveBchAddressesFromPrivateKey(decoded.privateKey);
}

export function isEvmPrivateKey(value: string): value is Hex {
  const normalized = value.trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(normalized)) return false;
  try {
    privateKeyToAccount(normalized as Hex);
    return true;
  } catch {
    return false;
  }
}

export function deriveEvmAddress(privateKey: string): Address {
  if (!isEvmPrivateKey(privateKey)) throw new Error('Invalid EVM private key');
  return getAddress(privateKeyToAccount(privateKey.trim() as Hex).address);
}

export function knownTestKeyReason(privateKey: string): string | null {
  const normalized = normalizePrivateKey(privateKey);
  if (normalized.length !== 64) return null;
  if (KNOWN_DEV_EVM_KEY_SET.has(normalized)) {
    return 'well-known development key';
  }
  const bytes = Buffer.from(normalized, 'hex');
  if (bytes.length === 32 && new Set(bytes).size === 1) {
    return 'simple repeating-byte key';
  }
  return null;
}

export function classifyAccountCode(code: string): AccountCodeKind {
  const normalized = code.trim().toLowerCase();
  if (normalized === '' || normalized === '0x') return 'empty';
  if (normalized.startsWith('0xef0100')) return 'delegated';
  return 'code';
}

export function generateKeyMaterial(
  random: RandomSource = defaultRandomSource,
): GeneratedKeyMaterial {
  const deployerEvmPrivateKey = randomEvmKey(random);
  let solverEvmPrivateKey = randomEvmKey(random);
  for (let attempt = 0; attempt < 16; attempt += 1) {
    if (solverEvmPrivateKey !== deployerEvmPrivateKey) break;
    solverEvmPrivateKey = randomEvmKey(random);
  }
  if (solverEvmPrivateKey === deployerEvmPrivateKey) {
    throw new Error('Random source produced duplicate EVM keys');
  }

  let solverBch = randomBchKey(random);
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const bchHex = privateKeyHex(solverBch.privateKey);
    if (bchHex !== deployerEvmPrivateKey && bchHex !== solverEvmPrivateKey) {
      break;
    }
    solverBch = randomBchKey(random);
  }
  const bchHex = privateKeyHex(solverBch.privateKey);
  if (bchHex === deployerEvmPrivateKey || bchHex === solverEvmPrivateKey) {
    throw new Error('Random source produced duplicate keys');
  }

  return {
    deployerEvmPrivateKey,
    solverEvmPrivateKey,
    solverBchWif: solverBch.wif,
    addresses: {
      deployerEvm: deriveEvmAddress(deployerEvmPrivateKey),
      solverEvm: deriveEvmAddress(solverEvmPrivateKey),
      solverBch: deriveBchAddressesFromWif(solverBch.wif),
    },
  };
}

export function privateKeyFromWif(wif: string): Uint8Array | null {
  return decodeWif(wif)?.privateKey ?? null;
}
