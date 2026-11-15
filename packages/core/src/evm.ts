import {
  encodeAbiParameters,
  hashDomain,
  isAddress,
  keccak256,
  stringToHex,
  type Address,
} from 'viem';
import { assertHex32 } from './signing.js';
import type { Hex32 } from './terms.js';

export const LOCK_INTENT_TYPES = {
  LockIntent: [
    { name: 'token', type: 'address' },
    { name: 'recipient', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'hashLock', type: 'bytes32' },
    { name: 'deadline', type: 'uint64' },
    { name: 'intentDeadline', type: 'uint256' },
  ],
} as const;

export const LOCK_INTENT_TYPEHASH = keccak256(
  stringToHex(
    'LockIntent(address token,address recipient,uint256 amount,bytes32 hashLock,uint64 deadline,uint256 intentDeadline)',
  ),
);

export interface LockIntent {
  token: string;
  recipient: string;
  amount: bigint;
  hashLock: Hex32;
  deadline: bigint;
  intentDeadline: bigint;
}

export interface LockIntentDomain {
  chainId: number;
  verifyingContract: string;
}

function toAddress(value: string): Address {
  if (!isAddress(value)) throw new TypeError('Malformed EVM address');
  return value;
}

function buildDomain(input: LockIntentDomain) {
  if (!Number.isSafeInteger(input.chainId) || input.chainId <= 0) {
    throw new RangeError('Invalid chainId');
  }
  return {
    name: 'FerryHTLC',
    version: '1',
    chainId: input.chainId,
    verifyingContract: toAddress(input.verifyingContract),
  } as const;
}

/**
 * Canonical EVM lockId = keccak256(abi.encode(sender, hashLock)).
 */
export function evmLockId(sender: string, hashLock: Hex32): Hex32 {
  assertHex32(hashLock);
  return keccak256(
    encodeAbiParameters(
      [{ type: 'address' }, { type: 'bytes32' }],
      [toAddress(sender), hashLock],
    ),
  );
}

export function lockIntentTypedData(
  input: LockIntentDomain,
  message: LockIntent,
) {
  assertHex32(message.hashLock);
  if (
    message.amount <= 0n ||
    message.amount >= 1n << 256n ||
    message.deadline < 0n ||
    message.deadline >= 1n << 64n ||
    message.intentDeadline < 0n ||
    message.intentDeadline >= 1n << 256n
  ) {
    throw new RangeError('Invalid LockIntent uint bounds');
  }
  return {
    domain: buildDomain(input),
    types: LOCK_INTENT_TYPES,
    primaryType: 'LockIntent',
    message: {
      ...message,
      token: toAddress(message.token),
      recipient: toAddress(message.recipient),
    },
  } as const;
}

export function lockIntentDomainSeparator(input: LockIntentDomain): Hex32 {
  return hashDomain({
    domain: { ...buildDomain(input), chainId: BigInt(input.chainId) },
    types: {
      EIP712Domain: [
        { name: 'name', type: 'string' },
        { name: 'version', type: 'string' },
        { name: 'chainId', type: 'uint256' },
        { name: 'verifyingContract', type: 'address' },
      ],
    },
  });
}
