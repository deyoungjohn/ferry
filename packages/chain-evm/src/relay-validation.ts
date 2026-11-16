import { isAddress } from 'viem';
import type { Address } from 'viem';
import { isValidSecret, orderId } from '@ferry/core';
import type {
  EvmChainId,
  Hex32,
  LockState,
  OrderTerms,
  SignedLock,
} from '@ferry/core';
import type { RelayLockPayload } from './adapter.js';

export type RelayValidationCode =
  | 'MALFORMED_PAYLOAD'
  | 'CHAIN_MISMATCH'
  | 'CONTRACT_MISMATCH'
  | 'ORDER_ID_MISMATCH'
  | 'AMOUNT_MISMATCH'
  | 'TOKEN_MISMATCH'
  | 'RECIPIENT_MISMATCH'
  | 'OWNER_MISMATCH'
  | 'HASH_LOCK_MISMATCH'
  | 'DEADLINE_MISMATCH'
  | 'INTENT_EXPIRED'
  | 'LOCK_NOT_OPEN'
  | 'INVALID_SECRET'
  | 'DEADLINE_EXPIRED'
  | 'GAS_PRICE_EXCEEDED';

export class RelayValidationError extends Error {
  constructor(
    readonly code: RelayValidationCode,
    message: string,
  ) {
    super(message);
    this.name = 'RelayValidationError';
  }
}

export interface SignedRelayIntent extends SignedLock {
  evmChainId?: number | undefined;
  verifyingContract?: Address | undefined;
}

export interface ValidateRelayLockOptions {
  expectedChain?: EvmChainId | undefined;
  expectedChainId?: number | undefined;
  expectedHtlc?: Address | undefined;
  nowSeconds?: number | undefined;
}

export type SignedTermsInput = OrderTerms | { terms: OrderTerms };

function unwrapTerms(input: SignedTermsInput): OrderTerms {
  return 'terms' in input ? input.terms : input;
}

export function validateRelayLock(
  signedIntent: SignedRelayIntent,
  signedTerms: SignedTermsInput,
  options?: ValidateRelayLockOptions,
): void {
  const terms = unwrapTerms(signedTerms);

  if (options?.expectedChain && signedIntent.chain !== options.expectedChain) {
    throw new RelayValidationError(
      'CHAIN_MISMATCH',
      `Intent chain ${signedIntent.chain} does not match expected ${options.expectedChain}`,
    );
  }

  const intentChainId = signedIntent.evmChainId ?? options?.expectedChainId;
  if (intentChainId !== undefined && intentChainId !== terms.evmChainId) {
    throw new RelayValidationError(
      'CHAIN_MISMATCH',
      `Intent evmChainId ${intentChainId} does not match terms ${terms.evmChainId}`,
    );
  }

  const intentContract =
    signedIntent.verifyingContract ?? options?.expectedHtlc;
  if (
    intentContract !== undefined &&
    intentContract.toLowerCase() !== terms.evmHtlc.toLowerCase()
  ) {
    throw new RelayValidationError(
      'CONTRACT_MISMATCH',
      `Intent contract ${intentContract} does not match terms ${terms.evmHtlc}`,
    );
  }

  const expectedOrderId = orderId(terms);
  if (signedIntent.orderId.toLowerCase() !== expectedOrderId.toLowerCase()) {
    throw new RelayValidationError(
      'ORDER_ID_MISMATCH',
      `Intent orderId ${signedIntent.orderId} does not match terms ${expectedOrderId}`,
    );
  }

  const payload = signedIntent.payload as Partial<RelayLockPayload> | undefined;
  if (
    !payload ||
    typeof payload.owner !== 'string' ||
    !isAddress(payload.owner) ||
    typeof payload.token !== 'string' ||
    !isAddress(payload.token) ||
    typeof payload.recipient !== 'string' ||
    !isAddress(payload.recipient) ||
    typeof payload.amount !== 'bigint' ||
    typeof payload.hashLock !== 'string' ||
    typeof payload.deadline !== 'bigint' ||
    typeof payload.intentDeadline !== 'bigint'
  ) {
    throw new RelayValidationError(
      'MALFORMED_PAYLOAD',
      'Relay lock intent payload is missing required fields',
    );
  }

  const expectedOwner =
    terms.direction === 'EVM_TO_BCH'
      ? terms.userEvmAddress
      : terms.solverEvmAddress;
  if (payload.owner.toLowerCase() !== expectedOwner.toLowerCase()) {
    throw new RelayValidationError(
      'OWNER_MISMATCH',
      `Intent owner ${payload.owner} does not match terms ${expectedOwner}`,
    );
  }

  const expectedRecipient =
    terms.direction === 'EVM_TO_BCH'
      ? terms.solverEvmAddress
      : terms.userEvmAddress;
  if (payload.recipient.toLowerCase() !== expectedRecipient.toLowerCase()) {
    throw new RelayValidationError(
      'RECIPIENT_MISMATCH',
      `Intent recipient ${payload.recipient} does not match terms ${expectedRecipient}`,
    );
  }

  if (payload.token.toLowerCase() !== terms.evmToken.toLowerCase()) {
    throw new RelayValidationError(
      'TOKEN_MISMATCH',
      `Intent token ${payload.token} does not match terms ${terms.evmToken}`,
    );
  }

  if (payload.amount !== terms.evmAmount) {
    throw new RelayValidationError(
      'AMOUNT_MISMATCH',
      `Intent amount ${payload.amount} does not match terms ${terms.evmAmount}`,
    );
  }

  if (payload.hashLock.toLowerCase() !== terms.hashLock.toLowerCase()) {
    throw new RelayValidationError(
      'HASH_LOCK_MISMATCH',
      `Intent hashLock ${payload.hashLock} does not match terms ${terms.hashLock}`,
    );
  }

  if (payload.deadline !== BigInt(terms.evmDeadline)) {
    throw new RelayValidationError(
      'DEADLINE_MISMATCH',
      `Intent deadline ${payload.deadline} does not match terms ${terms.evmDeadline}`,
    );
  }

  if (payload.intentDeadline < BigInt(terms.quoteExpiry)) {
    throw new RelayValidationError(
      'DEADLINE_MISMATCH',
      `Intent intentDeadline ${payload.intentDeadline} is earlier than quoteExpiry ${terms.quoteExpiry}`,
    );
  }

  if (
    options?.nowSeconds !== undefined &&
    payload.intentDeadline < BigInt(options.nowSeconds)
  ) {
    throw new RelayValidationError(
      'INTENT_EXPIRED',
      `Intent expired at ${payload.intentDeadline} (now: ${options.nowSeconds})`,
    );
  }
}

export interface ValidateRelayClaimInput {
  lock: LockState;
  secret: Hex32;
  nowSeconds: number;
  gasPriceWei: bigint;
  maxGasPriceWei: bigint;
}

export function validateRelayClaim(input: ValidateRelayClaimInput): void {
  const { lock, secret, nowSeconds, gasPriceWei, maxGasPriceWei } = input;

  if (lock.status !== 'locked') {
    throw new RelayValidationError(
      'LOCK_NOT_OPEN',
      `Cannot relay claim for lock in state: ${lock.status}`,
    );
  }

  if (!isValidSecret(secret, lock.hashLock)) {
    throw new RelayValidationError(
      'INVALID_SECRET',
      'Secret does not match lock hashLock',
    );
  }

  if (nowSeconds > lock.deadline) {
    throw new RelayValidationError(
      'DEADLINE_EXPIRED',
      `Lock deadline ${lock.deadline} has passed (now: ${nowSeconds})`,
    );
  }

  if (gasPriceWei < 0n || maxGasPriceWei < 0n || gasPriceWei > maxGasPriceWei) {
    throw new RelayValidationError(
      'GAS_PRICE_EXCEEDED',
      `Gas price ${gasPriceWei} exceeds cap ${maxGasPriceWei}`,
    );
  }
}
