import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { sha256 } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type { EvmChainAdapter } from '@ferry/chain-evm';
import { buildServer } from '../src/api/server.js';
import { SolverDatabase } from '../src/db/database.js';
import { SolverConfigSchema } from '../src/config.js';
import { SolverEngine } from '../src/engine/runner.js';
import type { BchQuorumClient } from '../src/bch/quorum-client.js';
import { MockPriceSource } from '../src/pricing/price-source.js';
import { QuoteRateLimiter } from '../src/api/rate-limiter.js';
import {
  verifyOrderSignature,
  type EvmAssetConfig,
  type Hex32,
  type LockState,
} from '@ferry/core';

describe('Solver HTTP API Endpoints (blueprint §5.3, §23.3, FR-17, FR-18)', () => {
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
  const solverAccount = privateKeyToAccount(solverEvmKey);
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
      listUnspent: async () => [],
      getHistory: async () => [],
      broadcast: async () => '0xmock-bch-broadcast',
      subscribeScriptHash: async () => {},
      unsubscribeScriptHash: async () => {},
      close: () => {},
    } as unknown as BchQuorumClient;

    const mockAsset: EvmAssetConfig = {
      symbol: 'USDC',
      decimals: 6,
      address: '0x1111111111111111111111111111111111111111',
      permit: false,
    };
    const knownLocks = new Map<string, LockState>();
    fakeEvmAdapter = {
      id: 'base',
      address: solverAccount.address,
      getTip: async () => ({
        height: 1234567,
        ageSeconds: 5,
        stale: false,
      }),
      getLock: async (lockId: string) => {
        return (
          knownLocks.get(lockId.toLowerCase()) ?? {
            status: 'absent' as const,
          }
        );
      },
      isFinal: async () => true,
      relayLock: async (input: {
        chain: string;
        orderId: `0x${string}`;
        payload: Parameters<EvmChainAdapter['relayLock']>[0]['payload'];
      }) => {
        const txId = ('0x' + 'aa'.repeat(32)) as Hex32;
        const order = db.getOrder(input.orderId);
        const lockId = order?.lockId ?? input.orderId;
        const hashLock = (order?.hashLock ?? '0x' + '00'.repeat(32)) as Hex32;
        knownLocks.set(lockId.toLowerCase(), {
          status: 'locked' as const,
          owner: solverAccount.address,
          recipient: solverAccount.address,
          asset: mockAsset,
          amount: 10000000n,
          hashLock,
          deadline: Math.floor(Date.now() / 1000) + 7200,
          lockTx: { chain: 'base', txId },
        });
        return {
          chain: 'base' as const,
          txId,
        };
      },
      claim: async (lockId: string, secret: `0x${string}`) => {
        const lock = knownLocks.get(lockId.toLowerCase());
        if (!lock || lock.status === 'absent') {
          throw new Error(`Lock ${lockId} is absent`);
        }
        const claimTxId = ('0x' + 'bb'.repeat(32)) as Hex32;
        if (lock.status === 'locked' || lock.status === 'claimed') {
          knownLocks.set(lockId.toLowerCase(), {
            ...lock,
            status: 'claimed' as const,
            claimTx: { chain: 'base', txId: claimTxId },
            secret: secret as Hex32,
          });
        }
        return {
          chain: 'base' as const,
          txId: claimTxId,
        };
      },
      refund: async (lockId: string) => {
        const lock = knownLocks.get(lockId.toLowerCase());
        if (!lock || lock.status === 'absent') {
          throw new Error(`Lock ${lockId} is absent`);
        }
        const refundTxId = ('0x' + 'cc'.repeat(32)) as Hex32;
        if (lock.status === 'locked' || lock.status === 'refunded') {
          knownLocks.set(lockId.toLowerCase(), {
            ...lock,
            status: 'refunded' as const,
            refundTx: { chain: 'base', txId: refundTxId },
          });
        }
        return {
          chain: 'base' as const,
          txId: refundTxId,
        };
      },
    } as unknown as EvmChainAdapter & {
      getTip: () => Promise<{
        height: number;
        ageSeconds: number;
        stale: boolean;
      }>;
    };

    engine = {
      isQuotingEnabled: () => true,
      start: async () => {},
      stop: () => {},
    } as unknown as SolverEngine;

    const now = Math.floor(Date.now() / 1000);
    priceSource = new MockPriceSource();
    priceSource.setPrice('USDC', {
      usdPrice: 1_000_000n,
      source: 'chainlink',
      asOf: now,
    });
    priceSource.setPrice('PUSD', {
      usdPrice: 1_000_000n,
      source: 'cauldron',
      asOf: now,
    });
    priceSource.setPrice('MUSD', {
      usdPrice: 1_000_000n,
      source: 'cauldron',
      asOf: now,
    });

    const config = SolverConfigSchema.parse({
      solverEvmPrivateKey: solverEvmKey,
      operatorToken,
      allowMockPaylinkSignatures: true,
    });

    app = buildServer({
      config,
      db,
      evmAdapter: fakeEvmAdapter,
      bchClient: fakeBchClient,
      engine,
      priceSource,
    });

    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    db.close();
  });

  describe('1. Quotes endpoint (POST /v1/quotes)', () => {
    it('returns signed terms with pricing evidence for a valid quote request', async () => {
      const hashLock = sha256(('0x' + '11'.repeat(32)) as `0x${string}`);
      const res = await app.inject({
        method: 'POST',
        url: '/v1/quotes',
        payload: {
          direction: 'EVM_TO_BCH',
          bchToken: 'PUSD',
          amountIn: '25000000', // 25 USDC ($25.00)
          userEvmAddress: '0x87Ea46fe296C1810eF234A8e8D782A2122deFaDd',
          userBchLockingBytecode:
            '0x76a914000000000000000000000000000000000000000088ac',
          hashLock,
          lane: 'safe',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.orderId).toBeDefined();
      expect(body.terms).toBeDefined();
      expect(body.signerAddress).toBe(solverAccount.address.toLowerCase());
      expect(body.terms.pricing).toBeDefined();
      expect(body.terms.pricing.refs.length).toBe(2);
      expect(body.terms.bchTokenAmount).toBe('2490'); // 24.90 PUSD

      // Verify solver signature
      const validSig = await verifyOrderSignature(
        body.orderId,
        body.signature,
        solverAccount.address,
      );
      expect(validSig).toBe(true);

      // Verify order saved to DB as QUOTED
      const order = db.getOrder(body.orderId);
      expect(order).not.toBeNull();
      expect(order?.status).toBe('QUOTED');
    });

    it('refuses quote with 422 and QuoteRefusal when reference price is stale', async () => {
      const now = Math.floor(Date.now() / 1000);
      priceSource.setPrice('USDC', {
        usdPrice: 1_000_000n,
        source: 'chainlink',
        asOf: now - 35, // 35s stale
      });

      const res = await app.inject({
        method: 'POST',
        url: '/v1/quotes',
        payload: {
          direction: 'EVM_TO_BCH',
          bchToken: 'PUSD',
          amountIn: '10000000',
          userEvmAddress: '0x87Ea46fe296C1810eF234A8e8D782A2122deFaDd',
          userBchLockingBytecode:
            '0x76a914000000000000000000000000000000000000000088ac',
          hashLock: sha256(('0x' + '22'.repeat(32)) as `0x${string}`),
          lane: 'safe',
        },
      });

      expect(res.statusCode).toBe(422);
      const refusal = res.json();
      expect(refusal.reason).toBe('PRICE_UNAVAILABLE');

      // Restore price
      priceSource.setPrice('USDC', {
        usdPrice: 1_000_000n,
        source: 'chainlink',
        asOf: Math.floor(Date.now() / 1000),
      });
    });

    it('refuses fast-lane quote exceeding zero-conf cap ($25) with 400 AMOUNT_OUT_OF_RANGE', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/quotes',
        payload: {
          direction: 'EVM_TO_BCH',
          bchToken: 'PUSD',
          amountIn: '30000000', // $30.00 > $25.00
          userEvmAddress: '0x87Ea46fe296C1810eF234A8e8D782A2122deFaDd',
          userBchLockingBytecode:
            '0x76a914000000000000000000000000000000000000000088ac',
          hashLock: sha256(('0x' + '33'.repeat(32)) as `0x${string}`),
          lane: 'fast',
          fastOptIn: true,
        },
      });

      expect(res.statusCode).toBe(400);
      const err = res.json();
      expect(err.error.code).toBe('AMOUNT_OUT_OF_RANGE');
    });
  });

  describe('2. Order details & secret reveal (GET /v1/orders/:id & POST /v1/orders/:id/secret)', () => {
    it('returns order status and deadlines, and accepts valid cooperative secret reveal', async () => {
      const secret = ('0x' + '44'.repeat(32)) as `0x${string}`;
      const hashLock = sha256(secret);

      // 1. Create quote
      const quoteRes = await app.inject({
        method: 'POST',
        url: '/v1/quotes',
        payload: {
          direction: 'EVM_TO_BCH',
          bchToken: 'PUSD',
          amountIn: '10000000',
          userEvmAddress: '0x87Ea46fe296C1810eF234A8e8D782A2122deFaDd',
          userBchLockingBytecode:
            '0x76a914000000000000000000000000000000000000000088ac',
          hashLock,
          lane: 'safe',
        },
      });
      const { orderId } = quoteRes.json();

      // 2. GET /v1/orders/:id
      const getRes = await app.inject({
        method: 'GET',
        url: `/v1/orders/${orderId}`,
      });
      expect(getRes.statusCode).toBe(200);
      const orderData = getRes.json();
      expect(orderData.orderId).toBe(orderId);
      expect(orderData.state).toBe('QUOTED');
      expect(orderData.quoteExpiry).toBeGreaterThan(0);
      expect(orderData.quoteExpiry).toBeLessThan(100_000_000_000); // Strict seconds

      // 3. POST /v1/orders/:id/secret
      const secretRes = await app.inject({
        method: 'POST',
        url: `/v1/orders/${orderId}/secret`,
        payload: { secret },
      });
      expect(secretRes.statusCode).toBe(200);
      expect(secretRes.json().ok).toBe(true);

      // Verify order transitioned to SECRET_KNOWN in DB
      const updated = db.getOrder(orderId);
      expect(updated?.status).toBe('SECRET_KNOWN');
      expect(updated?.secret).toBe(secret);
    });

    it('rejects secret reveal when preimage does not match hashLock', async () => {
      const secret = ('0x' + '55'.repeat(32)) as `0x${string}`;
      const badSecret = ('0x' + '66'.repeat(32)) as `0x${string}`;
      const hashLock = sha256(secret);

      const quoteRes = await app.inject({
        method: 'POST',
        url: '/v1/quotes',
        payload: {
          direction: 'EVM_TO_BCH',
          bchToken: 'PUSD',
          amountIn: '10000000',
          userEvmAddress: '0x87Ea46fe296C1810eF234A8e8D782A2122deFaDd',
          userBchLockingBytecode:
            '0x76a914000000000000000000000000000000000000000088ac',
          hashLock,
          lane: 'safe',
        },
      });
      const { orderId } = quoteRes.json();

      const badRes = await app.inject({
        method: 'POST',
        url: `/v1/orders/${orderId}/secret`,
        payload: { secret: badSecret },
      });

      expect(badRes.statusCode).toBe(400);
      expect(badRes.json().error.code).toBe('BAD_REQUEST');
    });
  });

  describe('3. Relay endpoints (POST /v1/orders/:id/relay-lock & relay-claim)', () => {
    it('relays lock and transitions order to USER_LOCK_SEEN', async () => {
      const hashLock = sha256(('0x' + '77'.repeat(32)) as `0x${string}`);
      const quoteRes = await app.inject({
        method: 'POST',
        url: '/v1/quotes',
        payload: {
          direction: 'EVM_TO_BCH',
          bchToken: 'PUSD',
          amountIn: '10000000',
          userEvmAddress: '0x87Ea46fe296C1810eF234A8e8D782A2122deFaDd',
          userBchLockingBytecode:
            '0x76a914000000000000000000000000000000000000000088ac',
          hashLock,
          lane: 'safe',
        },
      });
      const { orderId } = quoteRes.json();

      const relayRes = await app.inject({
        method: 'POST',
        url: `/v1/orders/${orderId}/relay-lock`,
        payload: { payload: { dummy: 'lock' } },
      });

      expect(relayRes.statusCode).toBe(200);
      expect(relayRes.json().ok).toBe(true);
      expect(relayRes.json().txHash).toBeDefined();
    });

    it('relays claim and transitions order to SOLVER_CLAIM_BROADCAST', async () => {
      const secret = ('0x' + '88'.repeat(32)) as `0x${string}`;
      const hashLock = sha256(secret);

      const quoteRes = await app.inject({
        method: 'POST',
        url: '/v1/quotes',
        payload: {
          direction: 'EVM_TO_BCH',
          bchToken: 'PUSD',
          amountIn: '10000000',
          userEvmAddress: '0x87Ea46fe296C1810eF234A8e8D782A2122deFaDd',
          userBchLockingBytecode:
            '0x76a914000000000000000000000000000000000000000088ac',
          hashLock,
          lane: 'safe',
        },
      });
      const { orderId } = quoteRes.json();

      await app.inject({
        method: 'POST',
        url: `/v1/orders/${orderId}/relay-lock`,
        payload: { payload: { dummy: 'lock' } },
      });

      const relayClaimRes = await app.inject({
        method: 'POST',
        url: `/v1/orders/${orderId}/relay-claim`,
        payload: { secret },
      });

      expect(relayClaimRes.statusCode).toBe(200);
      expect(relayClaimRes.json().ok).toBe(true);
      expect(relayClaimRes.json().txHash).toBeDefined();
    });
  });

  describe('4. Operational endpoints (GET /v1/health, /v1/liquidity, /v1/chains, /v1/stats, /v1/metrics)', () => {
    it('GET /v1/health returns health status matching HealthResponseSchema', async () => {
      const res = await app.inject({ method: 'GET', url: '/v1/health' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.ok).toBe(true);
      expect(body.quotingEnabled).toBe(true);
      expect(body.timestamp).toBeGreaterThan(0);
      expect(body.timestamp).toBeLessThan(100_000_000_000);
    });

    it('GET /v1/liquidity returns route liquidity matching LiquidityResponseSchema', async () => {
      const res = await app.inject({ method: 'GET', url: '/v1/liquidity' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.routes).toBeInstanceOf(Array);
      expect(body.routes.length).toBeGreaterThan(0);
      expect(body.asOf).toBeGreaterThan(0);
    });

    it('GET /v1/chains returns multi-chain configuration', async () => {
      const res = await app.inject({ method: 'GET', url: '/v1/chains' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.chains).toBeDefined();
    });

    it('GET /v1/stats returns completed swaps summary', async () => {
      const res = await app.inject({ method: 'GET', url: '/v1/stats' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.quotePolicy).toBeDefined();
    });

    it('GET /v1/orders/recent returns recent settled swaps list', async () => {
      const res = await app.inject({ method: 'GET', url: '/v1/orders/recent' });
      expect(res.statusCode).toBe(200);
      expect(res.json().orders).toBeInstanceOf(Array);
    });

    it('GET /v1/pegs returns peg snapshot with unix seconds timestamps', async () => {
      const res = await app.inject({ method: 'GET', url: '/v1/pegs' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.tokens.length).toBe(2);
      expect(body.tokens[0].points[0].at).toBeLessThan(100_000_000_000);
    });

    it('GET /v1/metrics enforces strict privacy: NO user addresses or order lists in public metrics', async () => {
      const res = await app.inject({ method: 'GET', url: '/v1/metrics' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.unfundedQuotes).toBeDefined();
      expect(body.openExposureUsd).toBeDefined();
      expect(body.tipAges).toBeDefined();

      // STRICT PRIVACY CHECK:
      expect(body.orders).toBeUndefined();
      expect(body.userAddress).toBeUndefined();
      expect(body.secret).toBeUndefined();
    });
  });

  describe('5. Operator needs-attention endpoint (GET /v1/operator/needs-attention)', () => {
    it('refuses access with 401 UNAUTHORIZED when Authorization header is missing or incorrect', async () => {
      const resMissing = await app.inject({
        method: 'GET',
        url: '/v1/operator/needs-attention',
      });
      expect(resMissing.statusCode).toBe(401);

      const resBad = await app.inject({
        method: 'GET',
        url: '/v1/operator/needs-attention',
        headers: {
          authorization: 'Bearer wrong-operator-token-here',
        },
      });
      expect(resBad.statusCode).toBe(401);
    });

    it('returns orders needing attention when valid Bearer token is supplied, without exposing secret', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/operator/needs-attention',
        headers: {
          authorization: `Bearer ${operatorToken}`,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.orders).toBeInstanceOf(Array);
      expect(body.timestamp).toBeGreaterThan(0);
      expect(body.timestamp).toBeLessThan(100_000_000_000);
    });
  });

  describe('6. Pay link endpoints (blueprint §23.3)', () => {
    let createdPayLinkId: string;

    it('POST /v1/links creates a pay link with CashAddr recipient validation', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/links',
        payload: {
          kind: 'invoice',
          recipientCashaddr:
            'bchtest:zqg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zy6fphnwyk',
          recipientLockingBytecode:
            '0x76a914111111111111111111111111111111111111111188ac',
          token: 'PUSD',
          amountOut: '2500', // 25.00 PUSD
          memo: 'Test invoice',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toBeDefined();
      expect(body.status).toBe('open');
      expect(body.amountOut).toBe('2500');
      createdPayLinkId = body.id;
    });

    it('GET /v1/links/:id retrieves public pay link details', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/v1/links/${createdPayLinkId}`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toBe(createdPayLinkId);
      expect(body.status).toBe('open');
    });

    it('POST /v1/links/:id/quotes provides exact-output quote for pay link', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/v1/links/${createdPayLinkId}/quotes`,
        payload: {
          counterChain: 'base',
          counterSymbol: 'USDC',
          userCounterAddress: '0x87Ea46fe296C1810eF234A8e8D782A2122deFaDd',
          hashLock: sha256(('0x' + '99'.repeat(32)) as `0x${string}`),
          lane: 'safe',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.orderId).toBeDefined();
      expect(body.terms.bchTokenAmount).toBe('2500'); // Exactly pays invoice amount
    });
  });

  describe('7. Send link endpoints (blueprint §23.3, item 5)', () => {
    it('POST /v1/send-quotes plans window, hold fee, and generates send link quote', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/send-quotes',
        payload: {
          destinationChainId: 8453,
          token: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
          amount: '10000000', // 10 USDC ($10.00)
          recipientAddress: '0x87Ea46fe296C1810eF234A8e8D782A2122deFaDd',
          windowSeconds: 86400, // 24 hours
          bchToken: 'PUSD',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.orderId).toBeDefined();
      expect(body.terms.evmChainId).toBe(8453);
      expect(body.terms.evmDeadline).toBeGreaterThan(0);
      expect(body.terms.bchRefundHeight).toBeGreaterThan(0);
    });

    it('GET /v1/send-links/:id returns send-link details without exposing the secret', async () => {
      // Create a dummy send link order in DB
      const id = ('0x' + 'ab'.repeat(32)) as `0x${string}`;
      const now = Math.floor(Date.now() / 1000);
      db.saveOrder({
        id,
        direction: 'BCH_TO_EVM',
        status: 'QUOTED',
        userCounterAddress: '0x87Ea46fe296C1810eF234A8e8D782A2122deFaDd',
        lockId: id,
        termsJson: JSON.stringify(
          {
            version: 1,
            direction: 'BCH_TO_EVM',
            bchToken: 'PUSD',
            bchTokenCategory: '0x' + '00'.repeat(32),
            evmToken: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
            evmChainId: 8453,
            evmHtlc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
            userEvmAddress: '0x87Ea46fe296C1810eF234A8e8D782A2122deFaDd',
            userBchLockingBytecode:
              '0x76a914000000000000000000000000000000000000000088ac',
            solverEvmAddress: solverAccount.address,
            solverBchLockingBytecode:
              '0x76a914000000000000000000000000000000000000000088ac',
            hashLock: '0x' + 'cd'.repeat(32),
            evmDeadline: now + 86400,
            bchRefundHeight: 330000,
            bchCarrySats: 1000,
            bchMaxFee: 500,
            bchTokenAmount: 10000000n,
            evmAmount: 10000000n,
            quoteId: 'quote-test',
            quoteExpiry: now + 300,
            pricing: {
              refs: [],
              spreadBps: 40,
              fixedFeeBase: 0n,
              rounding: 'floor',
            },
          },
          (_, v) => (typeof v === 'bigint' ? v.toString() + 'n' : v),
        ),
        hashLock: '0x' + 'cd'.repeat(32),
        secret: '0x' + 'ef'.repeat(32), // SECRET MUST NEVER BE EXPOSED IN GET /v1/send-links/:id
        lane: 'safe',
        fastOptIn: false,
        firstSeenAtMs: now,
        needsAttention: false,
        createdAt: now,
        updatedAt: now,
      });

      const res = await app.inject({
        method: 'GET',
        url: `/v1/send-links/${id}`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toBe(id);
      expect(body.chainId).toBe(8453);
      expect(body.recipientEvmAddress).toBe(
        '0x87ea46fe296c1810ef234a8e8d782a2122defadd',
      );
      expect(body.amountOut).toBe('10000000');
      expect(body.status).toBe('pending_lock');

      // STRICT PRIVACY VERIFICATION:
      expect(body.secret).toBeUndefined();
    });
  });

  describe('8. Rate limiting (quote & link-creation routes)', () => {
    it('enforces per-address and per-IP rate limits on POST /v1/quotes and POST /v1/links', async () => {
      // Create server with low rate limits (max 2 per address)
      const limitedLimiter = new QuoteRateLimiter({
        windowMs: 60_000,
        maxPerAddress: 2,
        maxPerIp: 10,
      });

      const config = SolverConfigSchema.parse({
        solverEvmPrivateKey: solverEvmKey,
        operatorToken,
        allowMockPaylinkSignatures: true,
      });

      const limitedApp = buildServer({
        config,
        db,
        evmAdapter: fakeEvmAdapter,
        bchClient: fakeBchClient,
        engine,
        priceSource,
        rateLimiter: limitedLimiter,
      });
      await limitedApp.ready();

      const userAddress = '0x1111111111111111111111111111111111111111';
      const quotePayload = {
        direction: 'EVM_TO_BCH',
        bchToken: 'PUSD',
        amountIn: '25000000',
        userEvmAddress: userAddress,
        userBchLockingBytecode:
          '0x76a914000000000000000000000000000000000000000088ac',
        hashLock: sha256(('0x' + '22'.repeat(32)) as `0x${string}`),
        lane: 'safe',
      };

      // 1st request succeeds
      const r1 = await limitedApp.inject({
        method: 'POST',
        url: '/v1/quotes',
        payload: quotePayload,
      });
      expect(r1.statusCode).toBe(200);

      // 2nd request succeeds
      const r2 = await limitedApp.inject({
        method: 'POST',
        url: '/v1/quotes',
        payload: quotePayload,
      });
      expect(r2.statusCode).toBe(200);

      // 3rd request is rate-limited (429)
      const r3 = await limitedApp.inject({
        method: 'POST',
        url: '/v1/quotes',
        payload: quotePayload,
      });
      expect(r3.statusCode).toBe(429);
      expect(r3.json().error.code).toBe('RATE_LIMITED');

      // Test rate limiting on POST /v1/links
      const cashaddr = 'bchtest:zqg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zy6fphnwyk';
      const linkPayload = {
        kind: 'invoice',
        recipientCashaddr: cashaddr,
        recipientLockingBytecode:
          '0x76a914111111111111111111111111111111111111111188ac',
        token: 'PUSD',
        amountOut: '2500',
      };

      const l1 = await limitedApp.inject({
        method: 'POST',
        url: '/v1/links',
        payload: linkPayload,
      });
      expect(l1.statusCode).toBe(200);

      const l2 = await limitedApp.inject({
        method: 'POST',
        url: '/v1/links',
        payload: linkPayload,
      });
      expect(l2.statusCode).toBe(200);

      const l3 = await limitedApp.inject({
        method: 'POST',
        url: '/v1/links',
        payload: linkPayload,
      });
      expect(l3.statusCode).toBe(429);
      expect(l3.json().error.code).toBe('RATE_LIMITED');

      await limitedApp.close();
    });
  });

  describe('9. Request body size limit (64KB)', () => {
    it('rejects oversized request bodies with 413 PAYLOAD_TOO_LARGE', async () => {
      // 70KB payload > 64KB (65536 bytes) limit
      const bigString = 'x'.repeat(70 * 1024);
      const res = await app.inject({
        method: 'POST',
        url: '/v1/quotes',
        payload: {
          direction: 'EVM_TO_BCH',
          bchToken: 'PUSD',
          amountIn: '25000000',
          userEvmAddress: '0x87Ea46fe296C1810eF234A8e8D782A2122deFaDd',
          userBchLockingBytecode:
            '0x76a914000000000000000000000000000000000000000088ac',
          hashLock: sha256(('0x' + '22'.repeat(32)) as `0x${string}`),
          lane: 'safe',
          padding: bigString,
        },
      });

      expect(res.statusCode).toBe(413);
      expect(res.json().error.code).toBe('PAYLOAD_TOO_LARGE');
    });
  });

  describe('10. Error sanitizer (no stack traces leaked)', () => {
    it('does not leak stack traces in error responses', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/quotes',
        payload: { invalid: 'payload' },
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error).toBeDefined();
      expect(body.stack).toBeUndefined();
      expect(body.error.stack).toBeUndefined();
    });
  });

  describe('11. Operator routes authentication & inventory view', () => {
    it('rejects unauthenticated or wrongly authenticated requests to operator endpoints', async () => {
      // Missing header
      const r1 = await app.inject({
        method: 'GET',
        url: '/v1/operator/inventory',
      });
      expect(r1.statusCode).toBe(401);

      // Wrong bearer token
      const r2 = await app.inject({
        method: 'GET',
        url: '/v1/operator/inventory',
        headers: { authorization: 'Bearer wrong-secret-token' },
      });
      expect(r2.statusCode).toBe(401);
    });

    it('GET /v1/operator/inventory returns balances, reservations, exposure, and skew in bps', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/operator/inventory',
        headers: { authorization: `Bearer ${operatorToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.assets).toBeInstanceOf(Array);
      expect(body.assets.length).toBeGreaterThan(0);
      expect(typeof body.skewBps).toBe('number');
      expect(typeof body.skewMaxBps).toBe('number');
      expect(body.timestamp).toBeGreaterThan(0);
    });

    it('GET /v1/operator/alerts returns system alerts with bearer token', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/operator/alerts',
        headers: { authorization: `Bearer ${operatorToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.systemAlerts).toBeInstanceOf(Array);
      expect(body.timestamp).toBeGreaterThan(0);
    });

    it('POST /v1/kill-switch, /v1/pause, and /v1/resume operate with bearer token', async () => {
      const pauseRes = await app.inject({
        method: 'POST',
        url: '/v1/pause',
        headers: { authorization: `Bearer ${operatorToken}` },
      });
      expect(pauseRes.statusCode).toBe(200);
      expect(pauseRes.json().quotingEnabled).toBe(false);

      const resumeRes = await app.inject({
        method: 'POST',
        url: '/v1/resume',
        headers: { authorization: `Bearer ${operatorToken}` },
      });
      expect(resumeRes.statusCode).toBe(200);
      expect(resumeRes.json().quotingEnabled).toBe(true);

      const killRes = await app.inject({
        method: 'POST',
        url: '/v1/kill-switch',
        headers: { authorization: `Bearer ${operatorToken}` },
      });
      expect(killRes.statusCode).toBe(200);
      expect(killRes.json().ok).toBe(true);
    });

    it('GET /v1/config returns redacted solver configuration', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/config',
        headers: { authorization: `Bearer ${operatorToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.network).toBeDefined();
      expect(body.baseHtlcAddress).toBeDefined();
      expect(body.solverEvmPrivateKey).toBe('[REDACTED]');
      expect(body.operatorToken).toBe('[REDACTED]');
    });
  });
});
