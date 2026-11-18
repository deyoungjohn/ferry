import {
  DEFAULT_TIMING_CONFIG,
  invariantF,
  invariantR,
  orderId as computeOrderId,
  quoteOut,
  type Hex,
  type Hex32,
  type OrderTerms,
  type PricingEvidence,
  type TimingConfig,
} from '@ferry/core';
import type { QuoteRequest, QuoteResponse } from '@ferry/core/api';
import { recoverMessageAddress } from 'viem';
import { QuoteVerificationError } from './errors.js';

export interface QuoteCheckContext {
  readonly bchTipHeight: number;
  readonly evmTokenDecimals: number;
  readonly bchTokenDecimals?: number;
  readonly nowSeconds?: number;
  readonly defaultMaxRefAgeSeconds?: number;
  readonly maxRefAgeBySource?: Readonly<Record<string, number>>;
  readonly maxClockSkewSeconds?: number;
  readonly expectedSolverAddress?: Hex;
  readonly timingConfig?: TimingConfig;
}

export interface VerifiedQuote {
  readonly orderId: Hex32;
  readonly terms: OrderTerms & { pricing: PricingEvidence };
  readonly signature: Hex;
  readonly signerAddress: Hex;
  readonly receiveAmount: bigint;
}

const DEFAULT_MAX_REF_AGE_SECONDS = 300;
/**
 * A Chainlink stablecoin feed is only updated when the price moves or its heartbeat (24 hours on
 * Base USDC/USD) runs out, so a reading hours old is normal. The solver applies the same rule.
 */
const CHAINLINK_MAX_REF_AGE_SECONDS = 24 * 3600 + 300;
const DEFAULT_MAX_CLOCK_SKEW_SECONDS = 30;

function sameHex(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function assertField(
  condition: boolean,
  field: string,
  reason: string,
): asserts condition {
  if (!condition) {
    throw new QuoteVerificationError(field, reason);
  }
}

export async function verifyQuote(
  quote: QuoteResponse,
  request: QuoteRequest,
  context: QuoteCheckContext,
): Promise<VerifiedQuote> {
  const nowSeconds = context.nowSeconds ?? Math.floor(Date.now() / 1000);
  const bchDecimals = context.bchTokenDecimals ?? 2;
  const defaultMaxRefAge =
    context.defaultMaxRefAgeSeconds ?? DEFAULT_MAX_REF_AGE_SECONDS;
  const maxClockSkew =
    context.maxClockSkewSeconds ?? DEFAULT_MAX_CLOCK_SKEW_SECONDS;
  const timingConfig = context.timingConfig ?? DEFAULT_TIMING_CONFIG;

  const computedId = computeOrderId(quote.terms);
  assertField(
    sameHex(computedId, quote.orderId),
    'orderId',
    'orderId does not match canonical CBOR hash of terms',
  );

  let recoveredAddress: Hex;
  try {
    recoveredAddress = (
      await recoverMessageAddress({
        message: { raw: computedId },
        signature: quote.signature,
      })
    ).toLowerCase() as Hex;
  } catch {
    throw new QuoteVerificationError(
      'signature',
      'failed to recover signer from EIP-191 signature',
    );
  }

  assertField(
    sameHex(recoveredAddress, quote.terms.solverEvmAddress),
    'signature',
    'recovered signer does not match terms.solverEvmAddress',
  );
  assertField(
    sameHex(recoveredAddress, quote.signerAddress),
    'signerAddress',
    'recovered signer does not match quote.signerAddress',
  );
  if (context.expectedSolverAddress !== undefined) {
    assertField(
      sameHex(recoveredAddress, context.expectedSolverAddress),
      'solverEvmAddress',
      'recovered signer does not match expected solver address',
    );
  }

  const terms = quote.terms;
  assertField(
    terms.direction === request.direction,
    'direction',
    'direction does not match request',
  );
  assertField(
    terms.bchToken === request.token,
    'bchToken',
    'BCH token does not match request',
  );
  assertField(
    terms.evmChainId === request.chainId,
    'evmChainId',
    'EVM chainId does not match request',
  );
  assertField(
    sameHex(terms.evmToken, request.evmToken),
    'evmToken',
    'EVM token address does not match request',
  );
  assertField(
    sameHex(terms.userEvmAddress, request.userEvmAddress),
    'userEvmAddress',
    'user EVM address does not match request',
  );
  assertField(
    sameHex(terms.userBchLockingBytecode, request.userBchLockingBytecode),
    'userBchLockingBytecode',
    'user BCH locking bytecode does not match request',
  );
  assertField(
    sameHex(terms.hashLock, request.hashLock),
    'hashLock',
    'hashLock does not match request',
  );

  if (terms.direction === 'EVM_TO_BCH') {
    assertField(
      terms.evmAmount === request.amountIn,
      'evmAmount',
      'evmAmount does not match requested amountIn',
    );
  } else {
    assertField(
      terms.bchTokenAmount === request.amountIn,
      'bchTokenAmount',
      'bchTokenAmount does not match requested amountIn',
    );
  }

  assertField(
    terms.quoteExpiry > nowSeconds,
    'quoteExpiry',
    'quote is already expired',
  );

  const timingDecision =
    terms.direction === 'EVM_TO_BCH'
      ? invariantF(
          {
            evmDeadlineSeconds: terms.evmDeadline,
            bchRefundHeight: terms.bchRefundHeight,
          },
          { unixSeconds: nowSeconds, bchTipHeight: context.bchTipHeight },
          timingConfig,
        )
      : invariantR(
          {
            evmDeadlineSeconds: terms.evmDeadline,
            bchRefundHeight: terms.bchRefundHeight,
          },
          { unixSeconds: nowSeconds, bchTipHeight: context.bchTipHeight },
          timingConfig,
        );
  assertField(
    timingDecision.allowed,
    'deadlines',
    `timing invariant failed (${timingDecision.reason})`,
  );

  assertField(
    terms.pricing !== undefined,
    'pricing',
    'pricing evidence is missing from quoted terms',
  );
  const pricing = terms.pricing;

  for (const ref of pricing.refs) {
    const maxAge =
      context.maxRefAgeBySource?.[ref.source] ??
      (ref.source.startsWith('chainlink:')
        ? Math.max(defaultMaxRefAge, CHAINLINK_MAX_REF_AGE_SECONDS)
        : defaultMaxRefAge);
    assertField(
      ref.asOf <= nowSeconds + maxClockSkew,
      'pricing.refs',
      `reference price from ${ref.source} is too far in the future`,
    );
    assertField(
      nowSeconds - ref.asOf <= maxAge,
      'pricing.refs',
      `reference price from ${ref.source} is stale`,
    );
  }

  const fromDecimals =
    terms.direction === 'EVM_TO_BCH' ? context.evmTokenDecimals : bchDecimals;
  const toDecimals =
    terms.direction === 'EVM_TO_BCH' ? bchDecimals : context.evmTokenDecimals;
  const expectedOut = quoteOut(
    request.amountIn,
    fromDecimals,
    toDecimals,
    pricing,
  );
  const actualOut =
    terms.direction === 'EVM_TO_BCH' ? terms.bchTokenAmount : terms.evmAmount;
  const outField =
    terms.direction === 'EVM_TO_BCH' ? 'bchTokenAmount' : 'evmAmount';
  assertField(
    actualOut === expectedOut,
    outField,
    `quoted output ${actualOut.toString()} does not match pricing evidence ${expectedOut.toString()}`,
  );

  return {
    orderId: computedId,
    terms: { ...terms, pricing },
    signature: quote.signature,
    signerAddress: recoveredAddress,
    receiveAmount: actualOut,
  };
}
