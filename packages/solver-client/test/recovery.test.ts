import { describe, expect, it } from 'vitest';
import { parseRecoveryFileJson } from '@ferry/core';
import {
  prepareRecoveryDownload,
  triggerRecoveryDownload,
} from '../src/index.js';
import {
  EVM_HTLC,
  EVM_TOKEN,
  NOW_SECONDS,
  makeSignedQuote,
} from './fixtures.js';

describe('recovery download helpers', () => {
  it('prepares a valid recovery file payload and triggers download when a document is supplied', async () => {
    const quote = await makeSignedQuote();
    const payload = prepareRecoveryDownload({
      quote: {
        orderId: quote.orderId,
        terms: { ...quote.terms, pricing: quote.terms.pricing! },
        signature: quote.signature,
      },
      createdAt: NOW_SECONDS,
      contracts: {
        evm: {
          chainId: 84532,
          htlcAddress: EVM_HTLC,
          tokenAddress: EVM_TOKEN,
        },
        bch: {
          network: 'chipnet',
          htlcAddress: 'bchtest:pq3v0p7n5v2j2x4m5z3q7h9v2n5k8t6w4e3r2y1u0i',
          tokenAddress: 'bchtest:zq3v0p7n5v2j2x4m5z3q7h9v2n5k8t6w4e3r2y1u0i',
          redeemScript: '0x51',
          lockingBytecode: `0xaa20${'11'.repeat(32)}87`,
        },
      },
    });

    expect(payload.filename).toBe(`ferry-${quote.orderId}.json`);
    expect(payload.mimeType).toBe('application/json');
    const parsed = parseRecoveryFileJson(payload.json);
    expect(parsed.orderId).toBe(quote.orderId);

    // Without DOM in Node
    expect(triggerRecoveryDownload(payload)).toBe(false);

    // With mocked DOM document
    let clicked = false;
    let removed = false;
    const anchor = {
      href: '',
      download: '',
      click() {
        clicked = true;
      },
      remove() {
        removed = true;
      },
    };
    const triggered = triggerRecoveryDownload(payload, {
      createElement: () => anchor,
      body: { appendChild: () => undefined },
    });
    expect(triggered).toBe(true);
    expect(anchor.download).toBe(payload.filename);
    expect(clicked).toBe(true);
    expect(removed).toBe(true);
  });
});
