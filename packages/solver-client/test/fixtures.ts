import {
  orderId as computeOrderId,
  signOrderId,
  type Direction,
  type Hex,
  type Hex32,
  type OrderTerms,
  type PricingEvidence,
} from '@ferry/core';
import type { QuoteRequest, QuoteResponse } from '@ferry/core/api';
import { privateKeyToAccount } from 'viem/accounts';

export const SOLVER_PRIV_A =
  '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' as Hex32;
export const SOLVER_PRIV_B =
  '0xfedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210' as Hex32;

export const SOLVER_ACCOUNT_A = privateKeyToAccount(SOLVER_PRIV_A);
export const SOLVER_ACCOUNT_B = privateKeyToAccount(SOLVER_PRIV_B);

export const NOW_SECONDS = 1_794_764_200;
export const BCH_TIP_HEIGHT = 500_000;

export const USER_EVM = '0x2222222222222222222222222222222222222222' as Hex;
export const EVM_TOKEN = '0x3333333333333333333333333333333333333333' as Hex;
export const EVM_HTLC = '0x4444444444444444444444444444444444444444' as Hex;
export const BCH_CATEGORY = `0x${'aa'.repeat(32)}` as Hex32;
export const HASH_LOCK = `0x${'bb'.repeat(32)}` as Hex32;
export const USER_BCH_LOCKING =
  '0x76a91400112233445566778899aabbccddeeff0011223388ac' as Hex;
export const SOLVER_BCH_LOCKING =
  '0x76a91433221100ffeeddccbbaa9988776655443322110088ac' as Hex;

export function makeQuoteRequest(
  direction: Direction = 'EVM_TO_BCH',
): QuoteRequest {
  return {
    direction,
    token: 'PUSD',
    chainId: 84532,
    evmToken: EVM_TOKEN,
    amountIn: direction === 'EVM_TO_BCH' ? 10_000_000n : 1000n,
    userEvmAddress: USER_EVM,
    userBchLockingBytecode: USER_BCH_LOCKING,
    hashLock: HASH_LOCK,
    lane: 'fast',
  };
}

export function makePricing(
  spreadBps = 50,
  asOf = NOW_SECONDS,
): PricingEvidence {
  return {
    refs: [
      { asset: 'USDC', usdPrice: '1.00', source: 'pyth', asOf },
      { asset: 'PUSD', usdPrice: '1.00', source: 'cauldron', asOf },
    ],
    spreadBps,
    fixedFeeBase: 0n,
    rounding: 'floor',
  };
}

export async function makeSignedQuote(params?: {
  direction?: Direction;
  account?: typeof SOLVER_ACCOUNT_A;
  signerAddress?: Hex;
  spreadBps?: number;
  refAsOf?: number;
  overrideTerms?: Partial<OrderTerms>;
  overrideOrderId?: Hex32;
  overrideSignature?: Hex;
}): Promise<QuoteResponse> {
  const direction = params?.direction ?? 'EVM_TO_BCH';
  const account = params?.account ?? SOLVER_ACCOUNT_A;
  const pricing = makePricing(
    params?.spreadBps ?? 50,
    params?.refAsOf ?? NOW_SECONDS,
  );
  const spreadFactor = BigInt(10_000 - pricing.spreadBps);

  const evmAmount =
    direction === 'EVM_TO_BCH'
      ? 10_000_000n
      : (1000n * spreadFactor * 10n ** 6n) / (10_000n * 10n ** 2n);
  const bchTokenAmount =
    direction === 'EVM_TO_BCH'
      ? (10_000_000n * spreadFactor * 10n ** 2n) / (10_000n * 10n ** 6n)
      : 1000n;

  const baseTerms: OrderTerms = {
    version: 1,
    direction,
    bchToken: 'PUSD',
    bchTokenCategory: BCH_CATEGORY,
    bchTokenAmount,
    evmAmount,
    evmToken: EVM_TOKEN,
    evmChainId: 84532,
    evmHtlc: EVM_HTLC,
    userEvmAddress: USER_EVM,
    userBchLockingBytecode: USER_BCH_LOCKING,
    solverEvmAddress: account.address.toLowerCase() as Hex,
    solverBchLockingBytecode: SOLVER_BCH_LOCKING,
    hashLock: HASH_LOCK,
    evmDeadline:
      direction === 'EVM_TO_BCH' ? NOW_SECONDS + 28_800 : NOW_SECONDS + 7_200,
    bchRefundHeight:
      direction === 'EVM_TO_BCH' ? BCH_TIP_HEIGHT + 12 : BCH_TIP_HEIGHT + 144,
    bchCarrySats: 3000n,
    bchMaxFee: 1000n,
    quoteId: 'q-test-1',
    quoteExpiry: NOW_SECONDS + 300,
    pricing,
    ...params?.overrideTerms,
  };

  const id = params?.overrideOrderId ?? computeOrderId(baseTerms);
  const signature =
    params?.overrideSignature ?? (await signOrderId(id, account));

  return {
    orderId: id,
    terms: baseTerms,
    signature,
    signerAddress: (params?.signerAddress ??
      account.address.toLowerCase()) as Hex,
  };
}

export function serializeQuoteForJson(quote: QuoteResponse): string {
  return JSON.stringify(quote, (_key, value: unknown) =>
    typeof value === 'bigint' ? value.toString() : value,
  );
}
