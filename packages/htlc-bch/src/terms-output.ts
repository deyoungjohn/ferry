import { binToHex, encodeDataPush, hexToBin } from '@bitauth/libauth';
import { deriveHtlcAddresses, resolveLockingBytecode } from './contract.js';
import { displayToInternalCategory } from './byte-order.js';
import type {
  BchHtlcParameters,
  CashAddressNetwork,
  HtlcAddressDerivationResult,
  OrderTerms,
} from './types.js';

export const TERMS_OUTPUT_MAGIC = new Uint8Array([0x46, 0x52, 0x59, 0x31]); // 'FRY1'
export const TERMS_OUTPUT_VERSION = 0x01;
export const TERMS_OUTPUT_MAX_BYTES = 220;

export const KNOWN_TOKEN_CATEGORIES: Record<
  CashAddressNetwork,
  Record<'PUSD' | 'MUSD', string>
> = {
  mainnet: {
    PUSD: '2469acc5afa4b10cb5b5c04afb89c3a3ffd61c5da9c01e26d00951cae2a02544',
    MUSD: 'b38a33f750f84c5c169a6f23cb873e6e79605021585d4f3408789689ed87f366',
  },
  chipnet: {
    PUSD: 'ec335fd3ffa45f80cef7217cf98e8adf562df5a3e33f354f69df2951703586ac',
    MUSD: 'c99627aec3e041f281068704c2609699d234586d5097301eff995f3bd00ac04d',
  },
};

export interface TermsOutputData {
  tag?: string | Uint8Array | undefined;
  token: 'PUSD' | 'MUSD' | number;
  tokenAmount: bigint | number;
  refundHeight: number;
  maxFee: number;
  recipientLockingBytecode: string | Uint8Array;
  refundLockingBytecode: string | Uint8Array;
}

export type EncodeTermsInput =
  | TermsOutputData
  | {
      params: OrderTerms;
      tag?: string | Uint8Array | undefined;
    };

export interface ParsedTermsOutput {
  version: number;
  tag: `0x${string}`;
  token: 'PUSD' | 'MUSD';
  tokenAmount: bigint;
  refundHeight: number;
  maxFee: number;
  recipientLockingBytecode: Uint8Array;
  refundLockingBytecode: Uint8Array;
  recipientLockingBytecodeHex: `0x${string}`;
  refundLockingBytecodeHex: `0x${string}`;
}

function resolveTagBytes(tag?: string | Uint8Array): Uint8Array {
  if (!tag) return new Uint8Array(8);
  const bytes =
    typeof tag === 'string'
      ? hexToBin(tag.startsWith('0x') ? tag.slice(2) : tag)
      : tag;
  if (bytes.length !== 8) {
    throw new RangeError(
      `Invalid recovery tag length: expected 8 bytes, got ${bytes.length}`,
    );
  }
  return bytes;
}

function resolveTokenByte(token: 'PUSD' | 'MUSD' | number): number {
  if (token === 0x01 || token === 'PUSD') return 0x01;
  if (token === 0x02 || token === 'MUSD') return 0x02;
  throw new RangeError(`Unknown token: ${token}`);
}

/**
 * Encodes the unpushed data payload for the terms output (FRY1 + v1 + fields).
 * Maximum allowed size is 220 bytes.
 */
export function encodeTermsPayload(input: EncodeTermsInput): Uint8Array {
  let data: TermsOutputData;
  if ('params' in input) {
    const isForward = input.params.direction === 'EVM_TO_BCH';
    data = {
      tag: input.tag,
      token: input.params.bchToken,
      tokenAmount: input.params.bchTokenAmount,
      refundHeight: input.params.bchRefundHeight,
      maxFee: Number(input.params.bchMaxFee),
      recipientLockingBytecode: isForward
        ? input.params.userBchLockingBytecode
        : input.params.solverBchLockingBytecode,
      refundLockingBytecode: isForward
        ? input.params.solverBchLockingBytecode
        : input.params.userBchLockingBytecode,
    };
  } else {
    data = input;
  }

  const tagBytes = resolveTagBytes(data.tag);
  const tokenByte = resolveTokenByte(data.token);
  const recipientBytes = resolveLockingBytecode(data.recipientLockingBytecode);
  const refundBytes = resolveLockingBytecode(data.refundLockingBytecode);

  if (recipientBytes.length > 255) {
    throw new RangeError(
      `Recipient locking bytecode too long (${recipientBytes.length} bytes > 255)`,
    );
  }
  if (refundBytes.length > 255) {
    throw new RangeError(
      `Refund locking bytecode too long (${refundBytes.length} bytes > 255)`,
    );
  }

  const payloadLength =
    4 + // magic FRY1
    1 + // version 0x01
    8 + // tag (8 bytes)
    1 + // token (1 byte)
    8 + // tokenAmount (8 bytes LE)
    4 + // refundHeight (4 bytes LE)
    4 + // maxFee (4 bytes LE)
    1 + // recipient len
    recipientBytes.length +
    1 + // refund len
    refundBytes.length;

  if (payloadLength > TERMS_OUTPUT_MAX_BYTES) {
    throw new RangeError(
      `Terms output payload exceeds ${TERMS_OUTPUT_MAX_BYTES} bytes (${payloadLength} bytes)`,
    );
  }

  const payload = new Uint8Array(payloadLength);
  const view = new DataView(
    payload.buffer,
    payload.byteOffset,
    payload.byteLength,
  );

  payload.set(TERMS_OUTPUT_MAGIC, 0);
  payload[4] = TERMS_OUTPUT_VERSION;
  payload.set(tagBytes, 5);
  payload[13] = tokenByte;

  view.setBigUint64(14, BigInt(data.tokenAmount), true);
  view.setUint32(22, data.refundHeight, true);
  view.setUint32(26, data.maxFee, true);

  let offset = 30;
  payload[offset] = recipientBytes.length;
  offset += 1;
  payload.set(recipientBytes, offset);
  offset += recipientBytes.length;

  payload[offset] = refundBytes.length;
  offset += 1;
  payload.set(refundBytes, offset);

  return payload;
}

/**
 * Encodes the full OP_RETURN locking bytecode carrying the terms payload.
 * Begins with OP_RETURN (0x6a) followed by standard data push of the payload.
 */
export function encodeTermsOutput(input: EncodeTermsInput): Uint8Array {
  const payload = encodeTermsPayload(input);
  const pushBytes = encodeDataPush(payload);
  const lockingBytecode = new Uint8Array(1 + pushBytes.length);
  lockingBytecode[0] = 0x6a; // OP_RETURN
  lockingBytecode.set(pushBytes, 1);
  return lockingBytecode;
}

/**
 * Parses terms from either full OP_RETURN locking bytecode or unpushed terms payload.
 */
export function parseTermsOutput(
  lockingBytecodeOrPayload: Uint8Array | string,
): ParsedTermsOutput {
  const rawBytes =
    typeof lockingBytecodeOrPayload === 'string'
      ? hexToBin(
          lockingBytecodeOrPayload.startsWith('0x')
            ? lockingBytecodeOrPayload.slice(2)
            : lockingBytecodeOrPayload,
        )
      : lockingBytecodeOrPayload;

  let payload: Uint8Array;
  if (rawBytes.length > 0 && rawBytes[0] === 0x6a) {
    // OP_RETURN locking bytecode: extract push data
    if (rawBytes.length < 2) {
      throw new Error('Truncated OP_RETURN script');
    }
    const op = rawBytes[1]!;
    let offset = 2;
    let pushLen: number;
    if (op <= 75) {
      pushLen = op;
    } else if (op === 0x4c) {
      if (rawBytes.length < 3) throw new Error('Truncated PUSHDATA1 script');
      pushLen = rawBytes[2]!;
      offset = 3;
    } else if (op === 0x4d) {
      if (rawBytes.length < 4) throw new Error('Truncated PUSHDATA2 script');
      pushLen = rawBytes[2]! | (rawBytes[3]! << 8);
      offset = 4;
    } else {
      throw new Error(
        `Unsupported push opcode in OP_RETURN: 0x${op.toString(16)}`,
      );
    }

    if (rawBytes.length < offset + pushLen) {
      throw new Error('Truncated OP_RETURN push data');
    }
    payload = rawBytes.slice(offset, offset + pushLen);
  } else {
    payload = rawBytes;
  }

  if (payload.length > TERMS_OUTPUT_MAX_BYTES) {
    throw new RangeError(
      `Terms output payload exceeds ${TERMS_OUTPUT_MAX_BYTES} bytes (${payload.length} bytes)`,
    );
  }

  const minPayloadLength = 32; // 30 fixed + 1 min recipient len + 1 min refund len
  if (payload.length < minPayloadLength) {
    throw new Error(
      `Terms output data truncated: expected at least ${minPayloadLength} bytes, got ${payload.length}`,
    );
  }

  for (let i = 0; i < 4; i++) {
    if (payload[i] !== TERMS_OUTPUT_MAGIC[i]) {
      throw new Error('Invalid magic bytes: expected FRY1');
    }
  }

  const version = payload[4]!;
  if (version !== TERMS_OUTPUT_VERSION) {
    throw new Error(
      `Unsupported terms output version: expected 0x01, got 0x${version.toString(16)}`,
    );
  }

  const tagBytes = payload.slice(5, 13);
  const tag = `0x${binToHex(tagBytes)}` as `0x${string}`;

  const tokenByte = payload[13]!;
  let token: 'PUSD' | 'MUSD';
  if (tokenByte === 0x01) {
    token = 'PUSD';
  } else if (tokenByte === 0x02) {
    token = 'MUSD';
  } else {
    throw new Error(
      `Unknown token byte in terms output: 0x${tokenByte.toString(16)}`,
    );
  }

  const view = new DataView(
    payload.buffer,
    payload.byteOffset,
    payload.byteLength,
  );

  const tokenAmount = view.getBigUint64(14, true);
  const refundHeight = view.getUint32(22, true);
  const maxFee = view.getUint32(26, true);

  let offset = 30;
  const recipientLen = payload[offset]!;
  offset += 1;
  if (payload.length < offset + recipientLen) {
    throw new Error('Truncated recipient locking bytecode in terms output');
  }
  const recipientLockingBytecode = payload.slice(offset, offset + recipientLen);
  offset += recipientLen;

  if (payload.length < offset + 1) {
    throw new Error('Truncated refund locking bytecode length in terms output');
  }
  const refundLen = payload[offset]!;
  offset += 1;
  if (payload.length < offset + refundLen) {
    throw new Error('Truncated refund locking bytecode in terms output');
  }
  const refundLockingBytecode = payload.slice(offset, offset + refundLen);
  offset += refundLen;

  if (offset !== payload.length) {
    throw new Error(
      `Unexpected trailing bytes in terms output: ${payload.length - offset} extra bytes`,
    );
  }

  return {
    version,
    tag,
    token,
    tokenAmount,
    refundHeight,
    maxFee,
    recipientLockingBytecode,
    refundLockingBytecode,
    recipientLockingBytecodeHex: `0x${binToHex(recipientLockingBytecode)}`,
    refundLockingBytecodeHex: `0x${binToHex(refundLockingBytecode)}`,
  };
}

export interface RebuildCovenantOptions {
  network?: CashAddressNetwork | undefined;
  tokenCategory?: string | Uint8Array | undefined;
}

/**
 * Rebuilds the HTLC covenant address and derivation result from parsed terms and the hash lock.
 */
export function rebuildCovenantFromTerms(
  parsed: ParsedTermsOutput,
  hashLock: string | Uint8Array,
  options?: RebuildCovenantOptions,
): HtlcAddressDerivationResult {
  const network = options?.network ?? 'chipnet';
  const hashLockBytes =
    typeof hashLock === 'string'
      ? hexToBin(hashLock.startsWith('0x') ? hashLock.slice(2) : hashLock)
      : hashLock;

  if (hashLockBytes.length !== 32) {
    throw new RangeError(
      `Invalid hashLock length: expected 32 bytes, got ${hashLockBytes.length}`,
    );
  }

  let tokenCategoryBytes: Uint8Array;
  if (options?.tokenCategory) {
    tokenCategoryBytes =
      typeof options.tokenCategory === 'string'
        ? displayToInternalCategory(options.tokenCategory)
        : options.tokenCategory;
  } else {
    const categoryHex = KNOWN_TOKEN_CATEGORIES[network]?.[parsed.token];
    if (!categoryHex) {
      throw new Error(
        `No default token category known for token ${parsed.token} on network ${network}`,
      );
    }
    tokenCategoryBytes = displayToInternalCategory(categoryHex);
  }

  const params: BchHtlcParameters = {
    hashLock: hashLockBytes,
    recipientLockingBytecode: parsed.recipientLockingBytecode,
    refundLockingBytecode: parsed.refundLockingBytecode,
    tokenCategory: tokenCategoryBytes,
    tokenAmount: parsed.tokenAmount,
    refundHeight: parsed.refundHeight,
    maxFee: BigInt(parsed.maxFee),
  };

  return deriveHtlcAddresses(params, network);
}
