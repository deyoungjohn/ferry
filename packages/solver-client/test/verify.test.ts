import { describe, expect, it } from 'vitest';
import type { Hex, Hex32 } from '@ferry/core';
import { QuoteVerificationError, verifyQuote } from '../src/index.js';
import {
  BCH_TIP_HEIGHT,
  NOW_SECONDS,
  SOLVER_ACCOUNT_A,
  SOLVER_ACCOUNT_B,
  makeQuoteRequest,
  makeSignedQuote,
} from './fixtures.js';

const baseContext = {
  bchTipHeight: BCH_TIP_HEIGHT,
  evmTokenDecimals: 6,
  nowSeconds: NOW_SECONDS,
  defaultMaxRefAgeSeconds: 120,
  maxRefAgeBySource: { pyth: 60, cauldron: 180 },
};

describe('verifyQuote', () => {
  it('accepts valid forward (EVM_TO_BCH) and reverse (BCH_TO_EVM) quotes', async () => {
    const fwdQuote = await makeSignedQuote({ direction: 'EVM_TO_BCH' });
    const fwdVerified = await verifyQuote(
      fwdQuote,
      makeQuoteRequest('EVM_TO_BCH'),
      {
        ...baseContext,
        expectedSolverAddress: SOLVER_ACCOUNT_A.address.toLowerCase() as Hex,
      },
    );
    expect(fwdVerified.receiveAmount).toBe(995n);
    expect(fwdVerified.orderId).toBe(fwdQuote.orderId);

    const revQuote = await makeSignedQuote({ direction: 'BCH_TO_EVM' });
    const revVerified = await verifyQuote(
      revQuote,
      makeQuoteRequest('BCH_TO_EVM'),
      baseContext,
    );
    expect(revVerified.receiveAmount).toBe(9_950_000n);
  });

  it('rejects mismatched orderId, wrong signer, and mismatched signerAddress', async () => {
    const request = makeQuoteRequest('EVM_TO_BCH');

    const badId = await makeSignedQuote({
      overrideOrderId: `0x${'ff'.repeat(32)}` as Hex32,
    });
    await expect(
      verifyQuote(badId, request, baseContext),
    ).rejects.toMatchObject({
      name: 'QuoteVerificationError',
      field: 'orderId',
    });

    const wrongKey = await makeSignedQuote({ account: SOLVER_ACCOUNT_B });
    const tamperedSolverTerms = await makeSignedQuote({
      overrideTerms: {
        solverEvmAddress: SOLVER_ACCOUNT_A.address.toLowerCase() as Hex,
      },
      overrideSignature: wrongKey.signature,
    });
    await expect(
      verifyQuote(tamperedSolverTerms, request, baseContext),
    ).rejects.toMatchObject({
      name: 'QuoteVerificationError',
      field: 'signature',
    });

    const badSignerAddr = await makeSignedQuote({
      signerAddress: SOLVER_ACCOUNT_B.address.toLowerCase() as Hex,
    });
    await expect(
      verifyQuote(badSignerAddr, request, baseContext),
    ).rejects.toMatchObject({
      name: 'QuoteVerificationError',
      field: 'signerAddress',
    });

    const validQuote = await makeSignedQuote();
    await expect(
      verifyQuote(validQuote, request, {
        ...baseContext,
        expectedSolverAddress: SOLVER_ACCOUNT_B.address.toLowerCase() as Hex,
      }),
    ).rejects.toMatchObject({
      name: 'QuoteVerificationError',
      field: 'solverEvmAddress',
    });
  });

  it('rejects request mismatches, expired quotes, and timing invariant failures', async () => {
    const request = makeQuoteRequest('EVM_TO_BCH');

    const wrongChain = await makeSignedQuote({
      overrideTerms: { evmChainId: 8453 },
    });
    await expect(
      verifyQuote(wrongChain, request, baseContext),
    ).rejects.toMatchObject({ field: 'evmChainId' });

    const wrongAmount = await makeSignedQuote({
      overrideTerms: { evmAmount: 9_000_000n },
    });
    await expect(
      verifyQuote(wrongAmount, request, baseContext),
    ).rejects.toMatchObject({ field: 'evmAmount' });

    const expired = await makeSignedQuote({
      overrideTerms: { quoteExpiry: NOW_SECONDS - 1 },
    });
    await expect(
      verifyQuote(expired, request, baseContext),
    ).rejects.toMatchObject({ field: 'quoteExpiry' });

    const badDeadline = await makeSignedQuote({
      overrideTerms: {
        evmDeadline: NOW_SECONDS + 10,
        bchRefundHeight: BCH_TIP_HEIGHT + 50,
      },
    });
    await expect(
      verifyQuote(badDeadline, request, baseContext),
    ).rejects.toMatchObject({ field: 'deadlines' });
  });

  it('rejects missing pricing, stale per-source refs, and manipulated receive amounts', async () => {
    const request = makeQuoteRequest('EVM_TO_BCH');

    const missingPricing = await makeSignedQuote({
      overrideTerms: { pricing: undefined },
    });
    await expect(
      verifyQuote(missingPricing, request, baseContext),
    ).rejects.toBeInstanceOf(QuoteVerificationError);
    await expect(
      verifyQuote(missingPricing, request, baseContext),
    ).rejects.toMatchObject({ field: 'pricing' });

    // pyth max age is 60s in baseContext; 61s old should fail
    const staleRef = await makeSignedQuote({ refAsOf: NOW_SECONDS - 61 });
    await expect(
      verifyQuote(staleRef, request, baseContext),
    ).rejects.toMatchObject({ field: 'pricing.refs' });

    const futureRef = await makeSignedQuote({ refAsOf: NOW_SECONDS + 60 });
    await expect(
      verifyQuote(futureRef, request, baseContext),
    ).rejects.toMatchObject({ field: 'pricing.refs' });

    const liedAmount = await makeSignedQuote({
      overrideTerms: { bchTokenAmount: 999n },
    });
    await expect(
      verifyQuote(liedAmount, request, baseContext),
    ).rejects.toMatchObject({ field: 'bchTokenAmount' });
  });
});
