import { encode, Token, Type } from 'cborg';
import { bytesToHex, hexToBytes, isAddress, sha256 } from 'viem';
import { z } from 'zod';

export type Hex = `0x${string}`;
export type Hex32 = Hex;
export type Direction = 'EVM_TO_BCH' | 'BCH_TO_EVM';

const wellFormedUnicode = (value: string): boolean =>
  !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(
    value,
  );

const text = z
  .string()
  .min(1)
  .max(256)
  .refine(wellFormedUnicode, 'Invalid Unicode');

const hex = z
  .string()
  .regex(/^0x(?:[0-9a-fA-F]{2})+$/)
  .max(20002)
  .transform((value) => value.toLowerCase() as Hex);

const hex32 = hex.refine(
  (value) => value.length === 66,
  'Expected exactly 32 bytes',
);

const evmAddress = z
  .string()
  .refine((value) => isAddress(value), 'Malformed EVM address')
  .transform((value) => value.toLowerCase() as Hex);

const positiveUint = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

const uint256 = z
  .bigint()
  .positive()
  .max((1n << 256n) - 1n);

const MAX_UNIX_SECONDS = 99_999_999_999;

/**
 * Strict Unix timestamp in seconds (integer seconds since Jan 1, 1970 UTC).
 * Rejects values >= 1e11 to prevent millisecond misuse.
 */
export const unixTimestampSeconds = z
  .number()
  .int()
  .positive()
  .max(
    MAX_UNIX_SECONDS,
    'Expected Unix timestamp in seconds, got milliseconds (>= 1e11)',
  )
  .describe('Unix timestamp in seconds');

const decimalString = z
  .string()
  .regex(/^\d+(?:\.\d+)?$/, 'Expected non-negative decimal string')
  .refine((value) => Number(value) > 0, 'Expected positive decimal price');

export const PricingRefSchema = z.strictObject({
  asset: text,
  usdPrice: decimalString,
  source: text,
  asOf: unixTimestampSeconds,
});

export type PricingRef = z.infer<typeof PricingRefSchema>;

export const PricingEvidenceSchema = z.strictObject({
  refs: z.array(PricingRefSchema).min(1).max(16),
  spreadBps: z.number().int().min(0).max(9999),
  fixedFeeBase: z
    .bigint()
    .nonnegative()
    .max((1n << 256n) - 1n),
  rounding: z.literal('floor'),
});

export type PricingEvidence = z.infer<typeof PricingEvidenceSchema>;

/** Strict canonical OrderTerms schema matching blueprint §3.1. */
export const OrderTermsSchema = z
  .strictObject({
    version: z.literal(1),
    direction: z.enum(['EVM_TO_BCH', 'BCH_TO_EVM']),
    bchToken: z.enum(['PUSD', 'MUSD']),
    bchTokenCategory: hex32,
    bchTokenAmount: uint256,
    evmAmount: uint256,
    evmToken: evmAddress,
    evmChainId: positiveUint,
    evmHtlc: evmAddress,
    userEvmAddress: evmAddress,
    userBchLockingBytecode: hex,
    solverEvmAddress: evmAddress,
    solverBchLockingBytecode: hex,
    hashLock: hex32,
    evmDeadline: unixTimestampSeconds,
    bchRefundHeight: positiveUint.max(499_999_999),
    bchCarrySats: uint256.max((1n << 64n) - 1n),
    bchMaxFee: z.bigint().nonnegative(),
    quoteId: text,
    quoteExpiry: unixTimestampSeconds,
    pricing: PricingEvidenceSchema,
  })
  .superRefine((terms, ctx) => {
    if (terms.bchMaxFee > terms.bchCarrySats) {
      ctx.addIssue({
        code: 'custom',
        message: 'bchMaxFee exceeds bchCarrySats',
        path: ['bchMaxFee'],
      });
    }
  });

export type OrderTerms = z.infer<typeof OrderTermsSchema>;

export function parseOrderTerms(input: unknown): OrderTerms {
  return OrderTermsSchema.parse(input);
}

function encodeBigIntTag2(value: bigint): Token[] | null {
  if (value < 0n) {
    throw new RangeError('Negative bigint is not supported in canonicalCBOR');
  }
  if (value < 1n << 64n) {
    return null;
  }
  let rawHex = value.toString(16);
  if (rawHex.length % 2 !== 0) rawHex = `0${rawHex}`;
  return [
    new Token(Type.tag, 2),
    new Token(Type.bytes, hexToBytes(`0x${rawHex}`)),
  ];
}

/**
 * Deterministic RFC 8949 canonical CBOR encoding via cborg.
 * Byte fields (hashLock, bchTokenCategory, BCH locking bytecodes) are encoded
 * as CBOR byte strings; bigints >= 2^64 use RFC 8949 tag-2 bignums; map keys
 * are sorted canonically independent of insertion order.
 */
export function canonicalCBOR(input: unknown): Uint8Array {
  const { pricing, ...rest } = parseOrderTerms(input);
  const payload = {
    ...rest,
    hashLock: hexToBytes(rest.hashLock),
    bchTokenCategory: hexToBytes(rest.bchTokenCategory),
    userBchLockingBytecode: hexToBytes(rest.userBchLockingBytecode),
    solverBchLockingBytecode: hexToBytes(rest.solverBchLockingBytecode),
    pricing,
  };
  return encode(payload, { typeEncoders: { bigint: encodeBigIntTag2 } });
}

export function orderId(input: unknown): Hex32 {
  return sha256(bytesToHex(canonicalCBOR(input)));
}

const uint256Json = z
  .union([
    z.bigint(),
    z.string().regex(/^\d+$/),
    z.number().int().nonnegative(),
  ])
  .transform((value) => BigInt(value))
  .refine((value) => value > 0n && value <= (1n << 256n) - 1n, {
    message: 'Expected positive uint256',
  });

const nonNegUint256Json = z
  .union([
    z.bigint(),
    z.string().regex(/^\d+$/),
    z.number().int().nonnegative(),
  ])
  .transform((value) => BigInt(value))
  .refine((value) => value >= 0n && value <= (1n << 256n) - 1n, {
    message: 'Expected non-negative uint256',
  });

const uint64Json = z
  .union([
    z.bigint(),
    z.string().regex(/^\d+$/),
    z.number().int().nonnegative(),
  ])
  .transform((value) => BigInt(value))
  .refine((value) => value > 0n && value <= (1n << 64n) - 1n, {
    message: 'Expected positive uint64',
  });

export const PricingEvidenceJsonSchema = z.strictObject({
  refs: z.array(PricingRefSchema).min(1).max(16),
  spreadBps: z.number().int().min(0).max(9999),
  fixedFeeBase: nonNegUint256Json,
  rounding: z.literal('floor'),
});

export const OrderTermsJsonSchema = z
  .strictObject({
    version: z.literal(1),
    direction: z.enum(['EVM_TO_BCH', 'BCH_TO_EVM']),
    bchToken: z.enum(['PUSD', 'MUSD']),
    bchTokenCategory: hex32,
    bchTokenAmount: uint256Json,
    evmAmount: uint256Json,
    evmToken: evmAddress,
    evmChainId: positiveUint,
    evmHtlc: evmAddress,
    userEvmAddress: evmAddress,
    userBchLockingBytecode: hex,
    solverEvmAddress: evmAddress,
    solverBchLockingBytecode: hex,
    hashLock: hex32,
    evmDeadline: unixTimestampSeconds,
    bchRefundHeight: positiveUint.max(499_999_999),
    bchCarrySats: uint64Json,
    bchMaxFee: nonNegUint256Json,
    quoteId: text,
    quoteExpiry: unixTimestampSeconds,
    pricing: PricingEvidenceJsonSchema,
  })
  .superRefine((terms, ctx) => {
    if (terms.bchMaxFee > terms.bchCarrySats) {
      ctx.addIssue({
        code: 'custom',
        message: 'bchMaxFee exceeds bchCarrySats',
        path: ['bchMaxFee'],
      });
    }
  });

export interface PricingEvidenceJson {
  readonly refs: readonly PricingRef[];
  readonly spreadBps: number;
  readonly fixedFeeBase: string;
  readonly rounding: 'floor';
}

export interface OrderTermsJson {
  readonly version: 1;
  readonly direction: Direction;
  readonly bchToken: 'PUSD' | 'MUSD';
  readonly bchTokenCategory: Hex32;
  readonly bchTokenAmount: string;
  readonly evmAmount: string;
  readonly evmToken: Hex;
  readonly evmChainId: number;
  readonly evmHtlc: Hex;
  readonly userEvmAddress: Hex;
  readonly userBchLockingBytecode: Hex;
  readonly solverEvmAddress: Hex;
  readonly solverBchLockingBytecode: Hex;
  readonly hashLock: Hex32;
  readonly evmDeadline: number;
  readonly bchRefundHeight: number;
  readonly bchCarrySats: string;
  readonly bchMaxFee: string;
  readonly quoteId: string;
  readonly quoteExpiry: number;
  readonly pricing: PricingEvidenceJson;
}

/**
 * Convert validated OrderTerms to a JSON-safe object (BigInt as decimal
 * strings, bytes as 0x-prefixed hex).
 */
export function orderTermsToJson(input: OrderTerms): OrderTermsJson {
  const { pricing, ...rest } = parseOrderTerms(input);
  return {
    ...rest,
    bchTokenAmount: rest.bchTokenAmount.toString(),
    evmAmount: rest.evmAmount.toString(),
    bchCarrySats: rest.bchCarrySats.toString(),
    bchMaxFee: rest.bchMaxFee.toString(),
    pricing: {
      ...pricing,
      fixedFeeBase: pricing.fixedFeeBase.toString(),
    },
  };
}

/**
 * Hydrate and validate a JSON-safe OrderTerms object back into OrderTerms.
 */
export function orderTermsFromJson(input: unknown): OrderTerms {
  return OrderTermsJsonSchema.parse(input);
}
