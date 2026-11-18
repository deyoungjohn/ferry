import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { sha256 } from 'viem';
import type { EvmChainAdapter } from '@ferry/chain-evm';
import { deriveSendLinkTag, type Hex32 } from '@ferry/core';
import { buildServer } from '../src/api/server.js';
import { SolverDatabase } from '../src/db/database.js';
import { SolverConfigSchema } from '../src/config.js';
import { SolverEngine } from '../src/engine/runner.js';
import type { BchQuorumClient } from '../src/bch/quorum-client.js';
import { MockPriceSource } from '../src/pricing/price-source.js';
import { QuoteRateLimiter } from '../src/api/rate-limiter.js';

describe('Blinded send link tags and query endpoint (B4-13)', () => {
  let app: FastifyInstance;
  let db: SolverDatabase;
  let fakeBchClient: BchQuorumClient;
  let fakeEvmAdapter: EvmChainAdapter & {
    getTip: () => Promise<{
      height: number;
      ageSeconds: number;
      stale: boolean;
    }>;
  };
  let engine: SolverEngine;
  let priceSource: MockPriceSource;

  const solverEvmKey =
    '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as const;
  const operatorToken = 'test-operator-token-32-chars-long-secret!';

  beforeAll(async () => {
    db = new SolverDatabase(':memory:');

    fakeBchClient = {
      getQuorumStatus: () => ({
        quorumTip: 330000,
        tips: { 'wss://mock1': 330000, 'wss://mock2': 330000 },
        isQuorumHealthy: true,
        isLivenessHealthy: true,
        ageSeconds: 15,
        lastConfirmedAt: Math.floor(Date.now() / 1000) - 15,
      }),
      listUnspent: async () => [
        {
          height: 330000,
          tx_hash: '11'.repeat(32),
          tx_pos: 0,
          value: 100000,
          token_data: {
            category:
              'ec335fd3ffa45f80cef7217cf98e8adf562df5a3e33f354f69df2951703586ac',
            amount: '100000000',
          },
        },
      ],
      getHistory: async () => [],
      broadcast: async () => '0xmock-bch-broadcast',
      subscribeScriptHash: async () => {},
      unsubscribeScriptHash: async () => {},
      close: () => {},
    } as unknown as BchQuorumClient;

    fakeEvmAdapter = {
      getTip: async () => ({
        height: 12000000,
        ageSeconds: 2,
        stale: false,
      }),
      getBalance: async () => 100_000_000n,
      getNativeBalance: async () => 1_000_000_000_000_000_000n,
      estimateLockGas: async () => 100_000n,
      estimateClaimGas: async () => 80_000n,
      estimateRefundGas: async () => 60_000n,
      getBaseFee: async () => 1_000_000_000n,
      getGasPrice: async () => 1_500_000_000n,
    } as unknown as EvmChainAdapter & {
      getTip: () => Promise<{
        height: number;
        ageSeconds: number;
        stale: boolean;
      }>;
    };

    priceSource = new MockPriceSource();

    const config = SolverConfigSchema.parse({
      solverEvmPrivateKey: solverEvmKey,
      operatorToken,
      allowMockPaylinkSignatures: true,
    });

    engine = {
      isQuotingEnabled: () => true,
      start: async () => {},
      stop: () => {},
    } as unknown as SolverEngine;

    app = buildServer({
      config,
      db,
      evmAdapter: fakeEvmAdapter,
      bchClient: fakeBchClient,
      priceSource,
      engine,
    });

    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    db.close();
  });

  const clientViewKey = ('0x' + 'aa'.repeat(32)) as Hex32;
  let recipientIndex = 0x2000;

  async function createSendQuote(extra: Record<string, unknown>) {
    recipientIndex += 1;
    const recipient = `0x${recipientIndex.toString(16).padStart(40, '0')}`;
    return app.inject({
      method: 'POST',
      url: '/v1/send-quotes',
      payload: {
        destinationChainId: 8453,
        token: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        amount: '10000000',
        recipientAddress: recipient,
        windowSeconds: 86400,
        bchToken: 'PUSD',
        hashLock: sha256(
          ('0x' +
            recipientIndex.toString(16).padStart(64, '0')) as `0x${string}`,
        ),
        ...extra,
      },
    });
  }

  it('stores viewTag beside order and returns matching link with tag via POST /v1/send-links/query', async () => {
    const tag0 = await deriveSendLinkTag(clientViewKey, 0);
    const tag1 = await deriveSendLinkTag(clientViewKey, 1);

    const res0 = await createSendQuote({
      viewTag: tag0,
      note: 'Dinner transfer #0',
    });
    expect(res0.statusCode).toBe(200);
    const order0 = res0.json();

    const res1 = await createSendQuote({
      viewTag: tag1,
      note: 'Dinner transfer #1',
    });
    expect(res1.statusCode).toBe(200);
    const order1 = res1.json();

    // Query both tags
    const queryRes = await app.inject({
      method: 'POST',
      url: '/v1/send-links/query',
      payload: {
        tags: [tag0, tag1],
      },
    });

    expect(queryRes.statusCode).toBe(200);
    const queryBody = queryRes.json();
    expect(queryBody.links).toHaveLength(2);
    expect(queryBody.matches).toHaveLength(2);

    const match0 = queryBody.links.find(
      (m: { tag: string }) => m.tag.toLowerCase() === tag0.toLowerCase(),
    );
    const match1 = queryBody.links.find(
      (m: { tag: string }) => m.tag.toLowerCase() === tag1.toLowerCase(),
    );

    expect(match0).toBeDefined();
    expect(match0.id).toBe(order0.orderId);
    expect(match0.note).toBe('Dinner transfer #0');
    expect(match0.status).toBe('pending_lock');
    expect(match0.token).toBe('PUSD');
    expect(match0.tag).toBe(tag0.toLowerCase());
    // STRICT PRIVACY: Secret is NEVER revealed in query response
    expect(match0.secret).toBeUndefined();

    expect(match1).toBeDefined();
    expect(match1.id).toBe(order1.orderId);
    expect(match1.note).toBe('Dinner transfer #1');
    expect(match1.tag).toBe(tag1.toLowerCase());
    expect(match1.secret).toBeUndefined();
  });

  it('duplicate tag: refuses send quote when viewTag is already used by another order', async () => {
    const tagReuse = await deriveSendLinkTag(clientViewKey, 99);

    const first = await createSendQuote({
      viewTag: tagReuse,
      note: 'First use',
    });
    expect(first.statusCode).toBe(200);

    const second = await createSendQuote({
      viewTag: tagReuse,
      note: 'Duplicate use',
    });
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe('CONFLICT');
    expect(second.json().error.message).toContain(
      'viewTag has already been used',
    );
  });

  it('no match: returns empty links list when tags do not match any order', async () => {
    const unknownTag = ('0x' + 'ee'.repeat(32)) as Hex32;
    const res = await app.inject({
      method: 'POST',
      url: '/v1/send-links/query',
      payload: {
        tags: [unknownTag],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().links).toEqual([]);
    expect(res.json().matches).toEqual([]);
  });

  it('unknown tag reveals nothing beyond no match in mixed query', async () => {
    const tagKnown = await deriveSendLinkTag(clientViewKey, 0);
    const tagUnknown1 = ('0x' + 'e1'.repeat(32)) as Hex32;
    const tagUnknown2 = ('0x' + 'e2'.repeat(32)) as Hex32;

    const res = await app.inject({
      method: 'POST',
      url: '/v1/send-links/query',
      payload: {
        tags: [tagKnown, tagUnknown1, tagUnknown2],
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    // Only the single matching link is returned
    expect(body.links).toHaveLength(1);
    expect(body.links[0].tag.toLowerCase()).toBe(tagKnown.toLowerCase());
    // Nothing is returned or leaked for unknown tags
    const unknownTagsPresent = body.links.filter(
      (m: { tag: string }) => m.tag === tagUnknown1 || m.tag === tagUnknown2,
    );
    expect(unknownTagsPresent).toHaveLength(0);
  });

  it('duplicate tag in query: returns single match without duplicate results', async () => {
    const tagKnown = await deriveSendLinkTag(clientViewKey, 0);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/send-links/query',
      payload: {
        tags: [tagKnown, tagKnown],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().links).toHaveLength(1);
    expect(res.json().links[0].tag.toLowerCase()).toBe(tagKnown.toLowerCase());
  });

  it('too many tags: rejects request exceeding 50 tags cap or empty tags', async () => {
    const tooManyTags = Array.from(
      { length: 51 },
      (_, i) => ('0x' + i.toString(16).padStart(64, '0')) as Hex32,
    );

    const resOver = await app.inject({
      method: 'POST',
      url: '/v1/send-links/query',
      payload: {
        tags: tooManyTags,
      },
    });
    expect(resOver.statusCode).toBe(400);
    expect(resOver.json().error.code).toBe('VALIDATION_ERROR');

    const resEmpty = await app.inject({
      method: 'POST',
      url: '/v1/send-links/query',
      payload: {
        tags: [],
      },
    });
    expect(resEmpty.statusCode).toBe(400);
    expect(resEmpty.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('rate limit: enforces per-IP rate limit on POST /v1/send-links/query', async () => {
    const limitedLimiter = new QuoteRateLimiter({
      windowMs: 60_000,
      maxPerAddress: 10,
      maxPerIp: 2,
    });

    const testApp = buildServer({
      config: SolverConfigSchema.parse({
        solverEvmPrivateKey: solverEvmKey,
        operatorToken,
        allowMockPaylinkSignatures: true,
      }),
      db,
      evmAdapter: fakeEvmAdapter,
      bchClient: fakeBchClient,
      priceSource,
      engine,
      rateLimiter: limitedLimiter,
    });
    await testApp.ready();

    const tag = await deriveSendLinkTag(clientViewKey, 0);

    // Call 1: ok
    const res1 = await testApp.inject({
      method: 'POST',
      url: '/v1/send-links/query',
      payload: { tags: [tag] },
      remoteAddress: '198.51.100.1',
    });
    expect(res1.statusCode).toBe(200);

    // Call 2: ok
    const res2 = await testApp.inject({
      method: 'POST',
      url: '/v1/send-links/query',
      payload: { tags: [tag] },
      remoteAddress: '198.51.100.1',
    });
    expect(res2.statusCode).toBe(200);

    // Call 3: Rate limited (429)
    const res3 = await testApp.inject({
      method: 'POST',
      url: '/v1/send-links/query',
      payload: { tags: [tag] },
      remoteAddress: '198.51.100.1',
    });
    expect(res3.statusCode).toBe(429);
    expect(res3.json().error.code).toBe('RATE_LIMITED');

    await testApp.close();
  });

  it('no endpoint lists tags or counts them', async () => {
    const getTags = await app.inject({
      method: 'GET',
      url: '/v1/send-links/tags',
    });
    expect(getTags.statusCode).toBe(404);

    const getTagsRoot = await app.inject({
      method: 'GET',
      url: '/v1/tags',
    });
    expect(getTagsRoot.statusCode).toBe(404);

    const countTags = await app.inject({
      method: 'GET',
      url: '/v1/send-links/tags/count',
    });
    expect(countTags.statusCode).toBe(404);
  });
});
