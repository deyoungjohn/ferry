import http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import type { Hex } from '@ferry/core';
import { bestQuote } from '../src/index.js';
import {
  BCH_TIP_HEIGHT,
  NOW_SECONDS,
  SOLVER_ACCOUNT_A,
  SOLVER_ACCOUNT_B,
  makeQuoteRequest,
  makeSignedQuote,
  serializeQuoteForJson,
} from './fixtures.js';

const servers: http.Server[] = [];

async function startFakeServer(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
): Promise<string> {
  const server = http.createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const addr = server.address();
  if (addr === null || typeof addr === 'string') {
    throw new Error('Expected TCP server address');
  }
  return `http://127.0.0.1:${addr.port}`;
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        }),
    ),
  );
});

describe('bestQuote (multi-solver)', () => {
  it('ignores lying, wrong-key, slow, and refusing servers and picks the best verified payout', async () => {
    const request = makeQuoteRequest('EVM_TO_BCH');

    // 1. Lies about output amount (claims 999 instead of 995)
    const liarQuote = await makeSignedQuote({
      account: SOLVER_ACCOUNT_A,
      spreadBps: 50,
      overrideTerms: { bchTokenAmount: 999n },
    });
    const liarUrl = await startFakeServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(serializeQuoteForJson(liarQuote));
    });

    // 2. Signs with the wrong key
    const wrongSig = await makeSignedQuote({ account: SOLVER_ACCOUNT_B });
    const badSigQuote = await makeSignedQuote({
      account: SOLVER_ACCOUNT_A,
      overrideTerms: {
        solverEvmAddress: SOLVER_ACCOUNT_A.address.toLowerCase() as Hex,
      },
      overrideSignature: wrongSig.signature,
    });
    const badSigUrl = await startFakeServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(serializeQuoteForJson(badSigQuote));
    });

    // 3. Slow server (times out at 60ms)
    const slowQuote = await makeSignedQuote({
      account: SOLVER_ACCOUNT_A,
      spreadBps: 10,
    });
    const slowUrl = await startFakeServer((_req, res) => {
      setTimeout(() => {
        if (!res.writableEnded) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(serializeQuoteForJson(slowQuote));
        }
      }, 1500);
    });

    // 4. Refuses for insufficient liquidity (HTTP 422)
    const refusingUrl = await startFakeServer((_req, res) => {
      res.writeHead(422, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          reason: 'INSUFFICIENT_LIQUIDITY',
          maxAmount: '42',
          asset: 'PUSD',
        }),
      );
    });

    // 5. Valid solver A (50 bps -> 995)
    const validA = await makeSignedQuote({
      account: SOLVER_ACCOUNT_A,
      spreadBps: 50,
    });
    const validAUrl = await startFakeServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(serializeQuoteForJson(validA));
    });

    // 6. Valid solver B (20 bps -> 998, best!)
    const validB = await makeSignedQuote({
      account: SOLVER_ACCOUNT_B,
      spreadBps: 20,
    });
    const validBUrl = await startFakeServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(serializeQuoteForJson(validB));
    });

    const result = await bestQuote(
      [liarUrl, badSigUrl, slowUrl, refusingUrl, validAUrl, validBUrl],
      request,
      {
        bchTipHeight: BCH_TIP_HEIGHT,
        evmTokenDecimals: 6,
        nowSeconds: NOW_SECONDS,
        timeoutMs: 600,
      },
    );

    expect(result.best?.solverUrl).toBe(validBUrl);
    expect(result.best?.quote.receiveAmount).toBe(998n);
    expect(result.quotes).toHaveLength(2);
    expect(result.failures).toHaveLength(4);

    const byUrl = new Map(result.failures.map((f) => [f.solverUrl, f]));
    expect(byUrl.get(liarUrl)).toMatchObject({
      kind: 'verification',
      field: 'bchTokenAmount',
    });
    expect(byUrl.get(badSigUrl)).toMatchObject({
      kind: 'verification',
      field: 'signature',
    });
    expect(byUrl.get(slowUrl)?.kind).toBe('timeout');
    expect(byUrl.get(refusingUrl)).toMatchObject({
      kind: 'refusal',
      refusal: { reason: 'INSUFFICIENT_LIQUIDITY', maxAmount: '42' },
    });
  });

  it('breaks ties on equal receiveAmount by lower latency', async () => {
    const request = makeQuoteRequest('EVM_TO_BCH');
    const quoteFast = await makeSignedQuote({
      account: SOLVER_ACCOUNT_A,
      spreadBps: 50,
    });
    const quoteDelayed = await makeSignedQuote({
      account: SOLVER_ACCOUNT_B,
      spreadBps: 50,
    });

    const delayedUrl = await startFakeServer((_req, res) => {
      setTimeout(() => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(serializeQuoteForJson(quoteDelayed));
      }, 45);
    });
    const fastUrl = await startFakeServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(serializeQuoteForJson(quoteFast));
    });

    const result = await bestQuote([delayedUrl, fastUrl], request, {
      bchTipHeight: BCH_TIP_HEIGHT,
      evmTokenDecimals: 6,
      nowSeconds: NOW_SECONDS,
      timeoutMs: 500,
    });

    expect(result.quotes).toHaveLength(2);
    expect(result.best?.solverUrl).toBe(fastUrl);
    expect(result.quotes[0]!.latencyMs).toBeLessThanOrEqual(
      result.quotes[1]!.latencyMs,
    );
  });
});
