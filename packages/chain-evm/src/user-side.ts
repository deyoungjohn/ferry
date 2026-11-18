// Browser-safe helpers for the user's own EVM wallet: what to sign, what to send,
// and how to read a lock for the progress timeline. No Node built-ins.
import {
  decodeEventLog,
  encodeFunctionData,
  getAddress,
  hashDomain,
  isAddress,
} from 'viem';
import type { Abi, AbiEvent, Address, Hex, PublicClient } from 'viem';
import { lockIntentTypedData } from '@ferry/core';
import type { Hex32, LockIntent, OrderTerms } from '@ferry/core';
import { ferryHtlcAbi } from '@ferry/htlc-evm/abi';
import type { TokenFacts } from '@ferry/chain-config/browser';
import { fetchLogsChunked } from './logs.js';

/** The signed intent and permit stay valid this long after the quote expires. */
export const INTENT_VALIDITY_AFTER_QUOTE_SECONDS = 3600;

/**
 * Upper bound for the gas of `lock` when it cannot be simulated yet (the approval
 * it depends on has not been mined). Fork rehearsals measured at most 208,214 gas
 * for a lock of real USDT, and 206,001 for an approve and a lock together.
 */
export const LOCK_GAS_UPPER_BOUND = 250_000n;

/**
 * Upper bound for an exact-amount approve that follows a reset to zero, which the
 * node cannot simulate before the reset is mined. A fork of Ethereum measured
 * 48,549 gas for that approve on real USDT.
 */
export const APPROVE_GAS_UPPER_BOUND = 80_000n;

export class UserSideError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserSideError';
  }
}

const erc20Abi = [
  {
    type: 'function',
    name: 'allowance',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'nonces',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'name',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
  },
  {
    type: 'function',
    name: 'version',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
  },
  {
    type: 'function',
    name: 'DOMAIN_SEPARATOR',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'bytes32' }],
  },
] as const satisfies Abi;

// ---------------------------------------------------------------------------
// 1. Typed data to sign
// ---------------------------------------------------------------------------

/** The `LockIntent` fields for an order; the single place they are derived. */
export function lockIntentFromTerms(terms: OrderTerms): LockIntent {
  return {
    token: getAddress(terms.evmToken),
    recipient: getAddress(terms.solverEvmAddress),
    amount: terms.evmAmount,
    hashLock: terms.hashLock,
    deadline: BigInt(terms.evmDeadline),
    intentDeadline: BigInt(
      terms.quoteExpiry + INTENT_VALIDITY_AFTER_QUOTE_SECONDS,
    ),
  };
}

/** What a wallet's `signTypedData` needs for `FerryHTLC.lockWithIntent`. */
export function buildLockIntentTypedData(terms: OrderTerms) {
  return lockIntentTypedData(
    { chainId: terms.evmChainId, verifyingContract: terms.evmHtlc },
    lockIntentFromTerms(terms),
  );
}

export interface PermitTypedDataInput {
  /** The token's facts from the chain configuration. */
  token: Pick<
    TokenFacts,
    'address' | 'name' | 'version' | 'domainSeparator' | 'permit'
  >;
  chainId: number;
  owner: string;
  spender: string;
  value: bigint;
  nonce: bigint;
  deadline: bigint;
}

const PERMIT_TYPES = {
  Permit: [
    { name: 'owner', type: 'address' },
    { name: 'spender', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
} as const;

const DOMAIN_TYPES = {
  EIP712Domain: [
    { name: 'name', type: 'string' },
    { name: 'version', type: 'string' },
    { name: 'chainId', type: 'uint256' },
    { name: 'verifyingContract', type: 'address' },
  ],
} as const;

function requireAddress(value: string, label: string): Address {
  if (!isAddress(value)) throw new UserSideError(`${label} is not an address`);
  return getAddress(value);
}

/**
 * EIP-2612 permit typed data. The domain name and version come from the
 * configured facts, never from a guess, and the resulting domain separator must
 * equal the one recorded in the facts. A token without permit returns `null`.
 */
export function buildPermitTypedData(input: PermitTypedDataInput) {
  const { token } = input;
  if (!token.permit) return null;
  if (token.address === null || token.name === null || token.version === null) {
    throw new UserSideError(
      'Token facts lack the address, name or version needed for a permit',
    );
  }
  if (token.domainSeparator === null) {
    throw new UserSideError(
      'Token facts lack a recorded domain separator; refusing to sign a permit',
    );
  }
  if (!Number.isSafeInteger(input.chainId) || input.chainId <= 0) {
    throw new UserSideError('Invalid chain id');
  }
  const verifyingContract = requireAddress(token.address, 'Token address');
  const domain = {
    name: token.name,
    version: token.version,
    chainId: input.chainId,
    verifyingContract,
  } as const;
  const derived = hashDomain({
    domain: { ...domain, chainId: BigInt(domain.chainId) },
    types: DOMAIN_TYPES,
  });
  if (derived.toLowerCase() !== token.domainSeparator.toLowerCase()) {
    throw new UserSideError(
      'The permit domain derived from the facts does not match the recorded domain separator',
    );
  }
  return {
    domain,
    types: PERMIT_TYPES,
    primaryType: 'Permit',
    message: {
      owner: requireAddress(input.owner, 'Owner'),
      spender: requireAddress(input.spender, 'Spender'),
      value: input.value,
      nonce: input.nonce,
      deadline: input.deadline,
    },
  } as const;
}

/** The permit for an order: the contract is the spender, the amount is exact. */
export function buildOrderPermitTypedData(
  terms: OrderTerms,
  token: PermitTypedDataInput['token'],
  nonce: bigint,
) {
  if (
    token.address !== null &&
    token.address.toLowerCase() !== terms.evmToken.toLowerCase()
  ) {
    throw new UserSideError('Token facts are for a different token');
  }
  return buildPermitTypedData({
    token,
    chainId: terms.evmChainId,
    owner: terms.userEvmAddress,
    spender: terms.evmHtlc,
    value: terms.evmAmount,
    nonce,
    deadline: lockIntentFromTerms(terms).intentDeadline,
  });
}

function permitDomainSeparator(
  name: string,
  version: string,
  chainId: number,
  verifyingContract: Address,
): Hex {
  return hashDomain({
    domain: { name, version, chainId: BigInt(chainId), verifyingContract },
    types: DOMAIN_TYPES,
  });
}

/**
 * The permit domain of a token, read from the chain and verified: the name comes
 * from `name()`, and the version is the one (the token's own `version()` when it
 * has one, else "1" or "2") whose derived domain separator equals the token's
 * `DOMAIN_SEPARATOR()`. If none reproduces it, no permit is built.
 */
export async function readPermitDomain(input: {
  client: PublicClient;
  token: string;
  chainId: number;
}): Promise<
  Required<
    Pick<TokenFacts, 'address' | 'name' | 'version' | 'domainSeparator'>
  > & { permit: true }
> {
  const address = requireAddress(input.token, 'Token address');
  const read = <T>(functionName: 'name' | 'version' | 'DOMAIN_SEPARATOR') =>
    input.client.readContract({
      address,
      abi: erc20Abi,
      functionName,
    }) as Promise<T>;
  const [name, onChainSeparator, declaredVersion] = await Promise.all([
    read<string>('name'),
    read<Hex>('DOMAIN_SEPARATOR'),
    read<string>('version').catch(() => null),
  ]);
  const candidates = [
    ...new Set([
      ...(declaredVersion === null ? [] : [declaredVersion]),
      '1',
      '2',
    ]),
  ];
  const version = candidates.find(
    (candidate) =>
      permitDomainSeparator(
        name,
        candidate,
        input.chainId,
        address,
      ).toLowerCase() === onChainSeparator.toLowerCase(),
  );
  if (version === undefined) {
    throw new UserSideError(
      'No permit domain version reproduces the token domain separator; refusing to build a permit',
    );
  }
  return {
    address,
    name,
    version,
    domainSeparator: onChainSeparator,
    permit: true,
  };
}

/** What the user's wallet needs for the first step of a forward swap. */
export async function buildUserLockPayload(input: {
  client: PublicClient;
  terms: OrderTerms;
  /** Whether the configured token supports EIP-2612. */
  permit: boolean;
}) {
  const { client, terms } = input;
  const lockIntentTypedData = buildLockIntentTypedData(terms);
  if (input.permit) {
    const [facts, nonce] = await Promise.all([
      readPermitDomain({
        client,
        token: terms.evmToken,
        chainId: terms.evmChainId,
      }),
      readPermitNonce(client, terms.evmToken, terms.userEvmAddress),
    ]);
    const permitTypedData = buildOrderPermitTypedData(terms, facts, nonce);
    if (permitTypedData === null) {
      throw new UserSideError('Expected a permit token');
    }
    return {
      mode: 'permit-intent' as const,
      lockIntentTypedData,
      permitTypedData,
    };
  }
  const token = requireAddress(terms.evmToken, 'Token address');
  const htlc = requireAddress(terms.evmHtlc, 'Contract address');
  const allowance = await client.readContract({
    address: token,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [requireAddress(terms.userEvmAddress, 'Owner'), htlc],
  });
  const lockIntent = lockIntentFromTerms(terms);
  return {
    mode: 'approve-lock' as const,
    approve: { token, spender: htlc, amount: terms.evmAmount },
    lockCall: {
      address: htlc,
      functionName: 'lock' as const,
      args: [
        token,
        requireAddress(terms.solverEvmAddress, 'Recipient'),
        terms.evmAmount,
        terms.hashLock,
        lockIntent.deadline,
      ] as const,
    },
    /** The complete list to send, including the reset a USDT-style token needs. */
    transactions: planApproveAndLock({ terms, allowance }),
  };
}

/** The owner's current permit nonce, read from the token. */
export async function readPermitNonce(
  client: PublicClient,
  token: string,
  owner: string,
): Promise<bigint> {
  return client.readContract({
    address: requireAddress(token, 'Token address'),
    abi: erc20Abi,
    functionName: 'nonces',
    args: [requireAddress(owner, 'Owner')],
  });
}

// ---------------------------------------------------------------------------
// 2. Transactions for tokens without permit, and claim / refund
// ---------------------------------------------------------------------------

export interface WalletTransaction {
  kind: 'reset-approval' | 'approve' | 'lock' | 'claim' | 'refund';
  to: Address;
  data: Hex;
  value: 0n;
  /** Gas estimate, with where it came from. */
  gas?: bigint | undefined;
  gasSource?: 'node' | 'bound' | undefined;
}

/**
 * The wallet transactions for a token without permit. An allowance that already
 * covers the amount needs no approval. A smaller, non-zero allowance is reset to
 * zero first (USDT refuses to change a non-zero allowance directly), then the
 * exact amount is approved, then the lock is sent.
 */
export function planApproveAndLock(input: {
  terms: OrderTerms;
  allowance: bigint;
}): WalletTransaction[] {
  const { terms, allowance } = input;
  const token = requireAddress(terms.evmToken, 'Token address');
  const htlc = requireAddress(terms.evmHtlc, 'Contract address');
  const plan: WalletTransaction[] = [];
  if (allowance < terms.evmAmount) {
    if (allowance > 0n) {
      plan.push({
        kind: 'reset-approval',
        to: token,
        data: encodeFunctionData({
          abi: erc20Abi,
          functionName: 'approve',
          args: [htlc, 0n],
        }),
        value: 0n,
      });
    }
    plan.push({
      kind: 'approve',
      to: token,
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: 'approve',
        args: [htlc, terms.evmAmount],
      }),
      value: 0n,
    });
  }
  plan.push({
    kind: 'lock',
    to: htlc,
    data: encodeFunctionData({
      abi: ferryHtlcAbi,
      functionName: 'lock',
      args: [
        token,
        requireAddress(terms.solverEvmAddress, 'Recipient'),
        terms.evmAmount,
        terms.hashLock,
        BigInt(terms.evmDeadline),
      ],
    }),
    value: 0n,
  });
  return plan;
}

/** Reads the allowance, plans the transactions and attaches gas estimates. */
export async function prepareApproveAndLock(input: {
  client: PublicClient;
  terms: OrderTerms;
}): Promise<WalletTransaction[]> {
  const { client, terms } = input;
  const owner = requireAddress(terms.userEvmAddress, 'Owner');
  const allowance = await client.readContract({
    address: requireAddress(terms.evmToken, 'Token address'),
    abi: erc20Abi,
    functionName: 'allowance',
    args: [owner, requireAddress(terms.evmHtlc, 'Contract address')],
  });
  const plan = planApproveAndLock({ terms, allowance });
  return Promise.all(
    plan.map(async (tx, index): Promise<WalletTransaction> => {
      // A transaction that depends on one before it cannot be simulated until that
      // one is mined: the lock needs its approval, and a USDT-style approve needs
      // the reset to zero (the node reverts it while the old allowance stands).
      const earlier = plan.slice(0, index).map((t) => t.kind);
      if (tx.kind === 'lock' && earlier.length > 0) {
        return { ...tx, gas: LOCK_GAS_UPPER_BOUND, gasSource: 'bound' };
      }
      if (tx.kind === 'approve' && earlier.includes('reset-approval')) {
        return { ...tx, gas: APPROVE_GAS_UPPER_BOUND, gasSource: 'bound' };
      }
      const gas = await client.estimateGas({
        account: owner,
        to: tx.to,
        data: tx.data,
      });
      return { ...tx, gas, gasSource: 'node' };
    }),
  );
}

/** Claim a lock with the secret, from the user's own wallet. */
export function buildClaimTransaction(input: {
  htlc: string;
  lockId: Hex32;
  secret: Hex32;
}): WalletTransaction {
  return {
    kind: 'claim',
    to: requireAddress(input.htlc, 'Contract address'),
    data: encodeFunctionData({
      abi: ferryHtlcAbi,
      functionName: 'claim',
      args: [input.lockId, input.secret],
    }),
    value: 0n,
  };
}

/** Refund a lock after its deadline, from the user's own wallet. */
export function buildRefundTransaction(input: {
  htlc: string;
  lockId: Hex32;
}): WalletTransaction {
  return {
    kind: 'refund',
    to: requireAddress(input.htlc, 'Contract address'),
    data: encodeFunctionData({
      abi: ferryHtlcAbi,
      functionName: 'refund',
      args: [input.lockId],
    }),
    value: 0n,
  };
}

// ---------------------------------------------------------------------------
// 3. Reading the chain for the status page
// ---------------------------------------------------------------------------

export function explorerTxUrl(explorerUrl: string, txHash: string): string {
  return `${explorerUrl.replace(/\/+$/, '')}/tx/${txHash}`;
}

export function explorerAddressUrl(
  explorerUrl: string,
  address: string,
): string {
  return `${explorerUrl.replace(/\/+$/, '')}/address/${address}`;
}

export interface LockEventRef {
  txHash: Hex32;
  blockNumber: bigint;
  url: string;
}

export interface UserLockStatus {
  /**
   * `expired`: still unclaimed and the deadline has passed, so the sender may
   * refund (a claim with the secret stays valid until one of them lands).
   */
  state: 'absent' | 'open' | 'claimed' | 'refunded' | 'expired';
  lockId: Hex32;
  deadline: number | null;
  /** Timestamp of the latest block, used to judge expiry. */
  chainTimestamp: number;
  /** The secret, once the lock has been claimed. */
  secret: Hex32 | null;
  locked: LockEventRef | null;
  claimed: LockEventRef | null;
  refunded: LockEventRef | null;
}

const eventNamed = (name: 'Locked' | 'Claimed' | 'Refunded'): AbiEvent =>
  ferryHtlcAbi.find(
    (item) => item.type === 'event' && item.name === name,
  )! as AbiEvent;

/**
 * State of one lock for the progress timeline. `fromBlock` is where the scan
 * for the lock's events starts (the contract's deploy block, or the block the
 * order was created at, whichever the caller knows).
 */
export async function getUserLockStatus(input: {
  client: PublicClient;
  htlc: string;
  lockId: Hex32;
  explorerUrl: string;
  fromBlock: bigint;
  maxRange?: bigint | undefined;
}): Promise<UserLockStatus> {
  const { client, lockId, explorerUrl } = input;
  const htlc = requireAddress(input.htlc, 'Contract address');
  const [raw, latest] = await Promise.all([
    client.readContract({
      address: htlc,
      abi: ferryHtlcAbi,
      functionName: 'locks',
      args: [lockId],
    }),
    client.getBlock({ blockTag: 'latest' }),
  ]);
  const [, , , amount, , deadline, stateNumber] = raw as readonly [
    Address,
    Address,
    Address,
    bigint,
    Hex32,
    bigint,
    number,
  ];
  const chainTimestamp = Number(latest.timestamp);
  const empty: UserLockStatus = {
    state: 'absent',
    lockId,
    deadline: null,
    chainTimestamp,
    secret: null,
    locked: null,
    claimed: null,
    refunded: null,
  };
  if (stateNumber === 0 || amount === 0n) return empty;

  const scan = async (name: 'Locked' | 'Claimed' | 'Refunded') => {
    const logs = await fetchLogsChunked(
      client,
      htlc,
      input.fromBlock,
      latest.number,
      {
        maxRange: input.maxRange,
        event: eventNamed(name),
        args: { id: lockId },
      },
    );
    return logs.find((log) => log.transactionHash && log.blockNumber !== null);
  };
  const ref = (log: Awaited<ReturnType<typeof scan>>): LockEventRef | null =>
    log?.transactionHash && log.blockNumber !== null
      ? {
          txHash: log.transactionHash,
          blockNumber: log.blockNumber,
          url: explorerTxUrl(explorerUrl, log.transactionHash),
        }
      : null;

  // State numbers: 1 locked, 2 claimed, 3 refunded.
  const claimedLog = stateNumber === 2 ? await scan('Claimed') : undefined;
  const refundedLog = stateNumber === 3 ? await scan('Refunded') : undefined;
  const lockedLog = await scan('Locked');
  let secret: Hex32 | null = null;
  if (claimedLog) {
    const decoded = decodeEventLog({
      abi: ferryHtlcAbi,
      data: claimedLog.data,
      topics: claimedLog.topics,
    });
    if (decoded.eventName === 'Claimed') secret = decoded.args.secret;
  }
  const deadlineSeconds = Number(deadline);
  const state: UserLockStatus['state'] =
    stateNumber === 2
      ? 'claimed'
      : stateNumber === 3
        ? 'refunded'
        : chainTimestamp >= deadlineSeconds
          ? 'expired'
          : 'open';
  return {
    state,
    lockId,
    deadline: deadlineSeconds,
    chainTimestamp,
    secret,
    locked: ref(lockedLog),
    claimed: ref(claimedLog),
    refunded: ref(refundedLog),
  };
}
