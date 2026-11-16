import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { runContractSuite } from '../src/testing.js';

const ORDER_ID =
  '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
const UNKNOWN_ORDER_ID =
  '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
const EXPIRED_ORDER_ID =
  '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
const HASH_LOCK =
  '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const EVM_ADDR = '0x1111111111111111111111111111111111111111';
const EVM_TOKEN = '0x036cbd53842c5426634e7929541ec2318f3dcf7e';
const BCH_LOCKING = '0x76a914111111111111111111111111111111111111111188ac';
const TX_HASH =
  '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';
const SIG = '0x' + '11'.repeat(65);
const NOW = 1_794_764_200;

function makeValidQuoteResponse(orderId = ORDER_ID) {
  return {
    orderId,
    terms: {
      version: 1,
      direction: 'EVM_TO_BCH',
      bchToken: 'PUSD',
      bchTokenCategory: HASH_LOCK,
      bchTokenAmount: '100',
      evmToken: EVM_TOKEN,
      evmChainId: 84532,
      evmHtlc: EVM_ADDR,
      evmAmount: '1000000',
      userEvmAddress: EVM_ADDR,
      userBchLockingBytecode: BCH_LOCKING,
      solverEvmAddress: EVM_ADDR,
      solverBchLockingBytecode: BCH_LOCKING,
      hashLock: HASH_LOCK,
      evmDeadline: NOW + 7200,
      bchRefundHeight: 500_144,
      bchCarrySats: '1000',
      bchMaxFee: '800',
      quoteId: 'q-1',
      quoteExpiry: NOW + 300,
      pricing: {
        refs: [
          {
            asset: 'PUSD',
            usdPrice: '1.0',
            source: 'test-feed',
            asOf: NOW,
          },
        ],
        spreadBps: 50,
        fixedFeeBase: '10000',
        rounding: 'floor',
      },
    },
    signature: SIG,
    signerAddress: EVM_ADDR,
  };
}

async function readJsonBody(
  req: IncomingMessage,
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const text = Buffer.concat(chunks).toString('utf8');
  return text.length > 0 ? (JSON.parse(text) as Record<string, unknown>) : {};
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(body));
}

function startFakeSolver(opts: { breakHealth?: boolean } = {}): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
}> {
  return new Promise((resolve, reject) => {
    const server = createServer(async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      const path = url.pathname;
      const method = req.method ?? 'GET';

      if (method === 'GET' && path === '/v1/health') {
        if (opts.breakHealth) {
          return sendJson(res, 200, { ok: true, timestamp: 'bad' });
        }
        return sendJson(res, 200, {
          ok: true,
          quotingEnabled: true,
          timestamp: NOW,
          tips: { bchHeight: 500_000, evmBlocks: { '84532': 12345 } },
          tipAges: { bchSeconds: 5, evmSeconds: { '84532': 2 } },
          inventory: { PUSD: '100000' },
        });
      }

      if (method === 'GET' && path === '/v1/liquidity') {
        return sendJson(res, 200, {
          routes: [
            {
              route: 'base:usdc->bch:pusd',
              asset: 'PUSD',
              decimals: 2,
              available: '5000',
              inventory: '10000',
              exposure: '5000',
              reserved: '0',
            },
          ],
          asOf: NOW,
        });
      }

      if (method === 'GET' && path === '/v1/chains') {
        return sendJson(res, 200, {
          chains: [
            {
              chainId: 84532,
              name: 'Base Sepolia',
              enabled: true,
              confirmations: { fast: 1, safe: 5 },
              tokens: [
                {
                  symbol: 'USDC',
                  address: EVM_TOKEN,
                  decimals: 6,
                  permit: true,
                },
              ],
            },
          ],
          asOf: NOW,
        });
      }

      if (method === 'GET' && path === '/v1/stats') {
        return sendJson(res, 200, {
          completedSwaps: 10,
          totalVolumeUsd: '1500.00',
          medianFastSeconds: 8,
          asOf: NOW,
        });
      }

      if (method === 'GET' && path === '/v1/orders/recent') {
        return sendJson(res, 200, {
          orders: [],
          asOf: NOW,
        });
      }

      if (method === 'GET' && path === '/v1/pegs') {
        return sendJson(res, 200, {
          tokens: [
            {
              asset: 'PUSD',
              currentUsdPrice: '1.000',
              points: [{ at: NOW, usdPrice: '1.000' }],
            },
          ],
          asOf: NOW,
        });
      }

      if (method === 'GET' && path === '/v1/metrics') {
        return sendJson(res, 200, {
          openExposureUsd: '0',
          unfundedQuotes: 0,
          tipAges: { bchSeconds: 5, evmSeconds: { '84532': 2 } },
          errorCounts: {},
          lastConfirmedAt: NOW,
          timestamp: NOW,
        });
      }

      if (method === 'GET' && path === '/v1/operator/needs-attention') {
        if (!req.headers.authorization?.startsWith('Bearer ')) {
          return sendJson(res, 401, {
            error: { code: 'UNAUTHORIZED', message: 'Missing bearer token' },
          });
        }
        return sendJson(res, 200, {
          alerts: [],
          orders: [],
          timestamp: NOW,
        });
      }

      if (method === 'POST' && path === '/v1/quotes') {
        const body = await readJsonBody(req);
        if (body.invalid === true) {
          return sendJson(res, 400, {
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Invalid quote body',
            },
          });
        }
        if (body.amountIn === '999999999999999') {
          return sendJson(res, 422, {
            reason: 'INSUFFICIENT_LIQUIDITY',
            maxAmount: '100',
            asset: 'PUSD',
          });
        }
        return sendJson(res, 200, makeValidQuoteResponse(ORDER_ID));
      }

      if (method === 'GET' && path.startsWith('/v1/orders/')) {
        const id = decodeURIComponent(path.slice('/v1/orders/'.length));
        if (id === UNKNOWN_ORDER_ID) {
          return sendJson(res, 404, {
            error: { code: 'ORDER_NOT_FOUND', message: 'Order not found' },
          });
        }
        return sendJson(res, 200, {
          orderId: id,
          state: 'QUOTED',
          direction: 'EVM_TO_BCH',
          txids: {},
          quoteExpiry: NOW + 300,
          counterDeadline: NOW + 7200,
          bchRefundHeight: 500_144,
          updatedAt: NOW,
        });
      }

      if (method === 'POST' && path.endsWith('/secret')) {
        const id = decodeURIComponent(
          path.slice('/v1/orders/'.length, -'/secret'.length),
        );
        if (id === EXPIRED_ORDER_ID) {
          return sendJson(res, 410, {
            error: { code: 'QUOTE_EXPIRED', message: 'Quote expired' },
          });
        }
        return sendJson(res, 200, {
          ok: true,
          orderId: id,
          state: 'SECRET_KNOWN',
          updatedAt: NOW,
        });
      }

      if (method === 'POST' && path.endsWith('/relay-lock')) {
        const id = decodeURIComponent(
          path.slice('/v1/orders/'.length, -'/relay-lock'.length),
        );
        return sendJson(res, 200, {
          ok: true,
          orderId: id,
          txHash: TX_HASH,
          updatedAt: NOW,
        });
      }

      if (method === 'POST' && path.endsWith('/relay-claim')) {
        const id = decodeURIComponent(
          path.slice('/v1/orders/'.length, -'/relay-claim'.length),
        );
        return sendJson(res, 200, {
          ok: true,
          orderId: id,
          txHash: TX_HASH,
          updatedAt: NOW,
        });
      }

      if (method === 'POST' && path === '/v1/links') {
        return sendJson(res, 201, {
          id: 'pl-1',
          kind: 'invoice',
          status: 'open',
          token: 'PUSD',
          recipientAddress:
            'bchtest:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq00000000',
          recipientLockingBytecode: BCH_LOCKING,
          amountOut: '25',
          memo: 'Contract test invoice',
          createdAt: NOW,
        });
      }

      if (method === 'GET' && path === '/v1/links') {
        return sendJson(res, 200, {
          owner: 'bchtest:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq00000000',
          links: [],
          asOf: NOW,
        });
      }

      if (method === 'GET' && path.startsWith('/v1/links/')) {
        const id = decodeURIComponent(path.slice('/v1/links/'.length));
        return sendJson(res, 200, {
          id,
          kind: 'invoice',
          status: 'open',
          token: 'PUSD',
          recipientAddress:
            'bchtest:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq00000000',
          recipientLockingBytecode: BCH_LOCKING,
          amountOut: '25',
          createdAt: NOW,
        });
      }

      if (method === 'POST' && path.endsWith('/quotes')) {
        return sendJson(res, 200, makeValidQuoteResponse(ORDER_ID));
      }

      if (method === 'POST' && path.endsWith('/cancel')) {
        const id = decodeURIComponent(
          path.slice('/v1/links/'.length, -'/cancel'.length),
        );
        return sendJson(res, 200, {
          ok: true,
          id,
          status: 'cancelled',
          updatedAt: NOW,
        });
      }

      if (method === 'POST' && path === '/v1/send-quotes') {
        return sendJson(res, 200, makeValidQuoteResponse(ORDER_ID));
      }

      if (method === 'GET' && path.startsWith('/v1/send-links/')) {
        const id = decodeURIComponent(path.slice('/v1/send-links/'.length));
        return sendJson(res, 200, {
          id,
          orderId: ORDER_ID,
          status: 'locked',
          token: 'PUSD',
          chainId: 84532,
          evmToken: EVM_TOKEN,
          recipientEvmAddress: '0x2222222222222222222222222222222222222222',
          hashLock: HASH_LOCK,
          evmDeadline: NOW + 86400,
          bchRefundHeight: 500_144,
          createdAt: NOW,
          updatedAt: NOW,
        });
      }

      return sendJson(res, 404, {
        error: { code: 'NOT_FOUND', message: `Unhandled ${method} ${path}` },
      });
    });

    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr === null || typeof addr === 'string') {
        reject(new Error('Unexpected server address'));
        return;
      }
      resolve({
        baseUrl: `http://127.0.0.1:${addr.port}`,
        close: () =>
          new Promise<void>((res, rej) =>
            server.close((err) => (err ? rej(err) : res())),
          ),
      });
    });
  });
}

describe('runContractSuite', () => {
  let closeServer: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (closeServer !== undefined) {
      await closeServer();
      closeServer = undefined;
    }
  });

  it('passes all 24 route and negative checks against a compliant fake server', async () => {
    const server = await startFakeSolver();
    closeServer = server.close;

    const report = await runContractSuite(server.baseUrl, {
      bearerToken: 'test-token',
    });

    expect(report.failed).toBe(0);
    expect(report.ok).toBe(true);
    expect(report.passed).toBe(24);
    expect(report.results).toHaveLength(24);
    expect(report.results.every((r) => r.ok)).toBe(true);
  });

  it('reports schema mismatches with route and reason without throwing', async () => {
    const server = await startFakeSolver({ breakHealth: true });
    closeServer = server.close;

    const report = await runContractSuite(server.baseUrl, {
      bearerToken: 'test-token',
    });

    expect(report.ok).toBe(false);
    expect(report.failed).toBe(1);
    const health = report.results.find((r) => r.route === 'GET /v1/health');
    expect(health?.ok).toBe(false);
    expect(health?.reason).toContain('Schema mismatch');
  });
});
