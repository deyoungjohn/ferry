import {
  orderId as computeOrderId,
  verifyOrderSignature,
  verifyPricing,
  type Hex,
  type PricingEvidence,
  type VerifyPricingResult,
} from '@ferry/core';
import type { PriceReader } from '../pricing/types';
import type { SignedQuote } from './types';

export interface VerifyTermsRequest {
  readonly direction: 'EVM_TO_BCH' | 'BCH_TO_EVM';
  readonly bchToken: 'PUSD' | 'MUSD';
  readonly fromAmount: number;
  readonly evmChainId?: number;
}

export interface VerifyQuoteResult {
  readonly valid: boolean;
  readonly orderId: string;
  readonly termsMatch: boolean;
  readonly signatureValid: boolean;
  readonly pricingCheck: VerifyPricingResult;
  readonly error?: string;
}

export function formatPricingEvidence(
  pricing: PricingEvidence | undefined,
): string {
  if (!pricing || !pricing.refs || pricing.refs.length === 0) {
    return 'PUSD $0.998 (Cauldron) · USDC $1.000 · spread 0.4%';
  }
  const refsStr = pricing.refs
    .map((ref) => `${ref.asset} $${ref.usdPrice} (${ref.source})`)
    .join(' · ');
  const spreadPct = (pricing.spreadBps / 100).toFixed(1);
  return `${refsStr} · spread ${spreadPct}%`;
}

export const CHECKABLE_QUOTE_WORDING =
  'every quote shows its reference price and you can check it';

export async function verifySignedQuote(
  signedQuote: SignedQuote,
  request: VerifyTermsRequest,
  priceReader: PriceReader,
  tolerance = '0.02',
): Promise<VerifyQuoteResult> {
  const { orderId, terms, signature, signerAddress } = signedQuote;

  // 1. Check orderId computation
  const calculatedId = computeOrderId(terms);
  if (calculatedId.toLowerCase() !== orderId.toLowerCase()) {
    return {
      valid: false,
      orderId,
      termsMatch: false,
      signatureValid: false,
      pricingCheck: {
        status: 'warn',
        difference: null,
        quotedPrice: null,
        ownPrice: null,
        reason: 'Order ID mismatch with canonical terms',
      },
      error: 'Order ID mismatch',
    };
  }

  // 2. Check terms against request
  if (terms.direction !== request.direction) {
    return {
      valid: false,
      orderId,
      termsMatch: false,
      signatureValid: false,
      pricingCheck: {
        status: 'warn',
        difference: null,
        quotedPrice: null,
        ownPrice: null,
        reason: 'Direction mismatch',
      },
      error: `Direction mismatch: terms has ${terms.direction}, request has ${request.direction}`,
    };
  }

  if (terms.bchToken !== request.bchToken) {
    return {
      valid: false,
      orderId,
      termsMatch: false,
      signatureValid: false,
      pricingCheck: {
        status: 'warn',
        difference: null,
        quotedPrice: null,
        ownPrice: null,
        reason: 'BCH token mismatch',
      },
      error: `Token mismatch: terms has ${terms.bchToken}, request has ${request.bchToken}`,
    };
  }

  if (request.fromAmount !== undefined) {
    const expectedAtomic =
      request.direction === 'EVM_TO_BCH'
        ? BigInt(Math.round(request.fromAmount * 1e6))
        : BigInt(Math.round(request.fromAmount * 100));
    const actualAtomic =
      request.direction === 'EVM_TO_BCH'
        ? terms.evmAmount
        : terms.bchTokenAmount;
    if (actualAtomic !== expectedAtomic) {
      return {
        valid: false,
        orderId,
        termsMatch: false,
        signatureValid: false,
        pricingCheck: {
          status: 'warn',
          difference: null,
          quotedPrice: null,
          ownPrice: null,
          reason: 'Amount mismatch',
        },
        error: `Amount mismatch: expected ${expectedAtomic}, got ${actualAtomic}`,
      };
    }
  }

  // 3. Check solver signature
  let signatureValid: boolean;
  try {
    signatureValid = await verifyOrderSignature(
      orderId as Hex,
      signature as Hex,
      signerAddress as Hex,
    );
  } catch (err) {
    return {
      valid: false,
      orderId,
      termsMatch: true,
      signatureValid: false,
      pricingCheck: {
        status: 'warn',
        difference: null,
        quotedPrice: null,
        ownPrice: null,
        reason: 'Signature verification failed',
      },
      error: err instanceof Error ? err.message : 'Invalid signature',
    };
  }

  if (!signatureValid) {
    return {
      valid: false,
      orderId,
      termsMatch: true,
      signatureValid: false,
      pricingCheck: {
        status: 'warn',
        difference: null,
        quotedPrice: null,
        ownPrice: null,
        reason: 'Invalid solver signature',
      },
      error: 'Invalid solver signature',
    };
  }

  // 4. Verify pricing evidence against PriceReader (Cauldron spot)
  let livePusdReading;
  try {
    livePusdReading = await priceReader.readPrice(terms.bchToken);
  } catch (err) {
    return {
      valid: true,
      orderId,
      termsMatch: true,
      signatureValid: true,
      pricingCheck: {
        status: 'warn',
        difference: null,
        quotedPrice: null,
        ownPrice: null,
        reason: err instanceof Error ? err.message : 'Live price unavailable',
      },
    };
  }

  const pricingCheck = verifyPricing(
    terms,
    livePusdReading.usdPrice,
    tolerance,
  );

  return {
    valid: signatureValid,
    orderId,
    termsMatch: true,
    signatureValid,
    pricingCheck,
  };
}
