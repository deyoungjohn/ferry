import { describe, expect, it } from 'vitest';
import {
  formatQuoteRefusalMessage,
  QuoteRefusalSchema,
} from '../src/api/index.js';

describe('below-minimum refusal', () => {
  it('names the minimum amount instead of saying the route is disabled', () => {
    const refusal = QuoteRefusalSchema.parse({
      reason: 'BELOW_MINIMUM',
      minAmount: '5.00',
      asset: 'USDC',
    });
    expect(formatQuoteRefusalMessage(refusal)).toBe(
      'The minimum on this route is $5.00',
    );
  });
});
