import {
  makeSignedQuote,
  serializeQuoteForJson,
  USER_BCH_LOCKING,
} from './fixtures.js';

export const BCH_LOCKING_VALID = USER_BCH_LOCKING;

export async function makeSignedQuoteWithJson(): Promise<{
  orderId: string;
  terms: Record<string, unknown>;
  signature: string;
  signerAddress: string;
}> {
  const quote = await makeSignedQuote();
  return JSON.parse(serializeQuoteForJson(quote)) as {
    orderId: string;
    terms: Record<string, unknown>;
    signature: string;
    signerAddress: string;
  };
}
