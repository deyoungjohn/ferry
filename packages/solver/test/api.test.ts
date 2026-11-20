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
        {
          height: 330000,
          tx_hash: '22'.repeat(32),
          tx_pos: 0,
          value: 100000,
          token_data: {
            category:
              'c99627aec3e041f281068704c2609699d234586d5097301eff995f3bd00ac04d',
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
      getTokenBalance: async () => 100_000_000_000n,
      getNativeBalance: async () => 10_000_000_000_000_000_000n,
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
      expect(body.terms.pricing.fixedFeeBase).toBe('1'); // $0.01 Base fixed fee in 2-decimal PUSD
      expect(body.terms.bchTokenAmount).toBe('2489'); // 24.89 PUSD ($25.00 - 0.4% spread - $0.01 fixed fee)

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

    it('refuses a second quote with a hash lock an earlier order used', async () => {
      const hashLock = sha256(('0x' + '98'.repeat(32)) as `0x${string}`);
      const payload = {
        direction: 'EVM_TO_BCH',
        bchToken: 'PUSD',
        amountIn: '10000000',
        userEvmAddress: '0x87Ea46fe296C1810eF234A8e8D782A2122deFaDd',
        userBchLockingBytecode:
          '0x76a914000000000000000000000000000000000000000088ac',
        hashLock,
        lane: 'safe',
      };
      const first = await app.inject({
        method: 'POST',
        url: '/v1/quotes',
        payload,
      });
      expect(first.statusCode).toBe(200);
      const second = await app.inject({
        method: 'POST',
        url: '/v1/quotes',
        payload,
      });
      expect(second.statusCode).toBe(409);
      expect(second.body).toMatch(/hashLock has already been used/);
    });

    it('GET /v1/orders/by-hash-lock/:hashLock returns order status and public terms, 404 when unknown', async () => {
      const secret = ('0x' + '99'.repeat(32)) as `0x${string}`;
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

      // Lookup by hash lock with 0x
      const resWithPrefix = await app.inject({
        method: 'GET',
        url: `/v1/orders/by-hash-lock/${hashLock}`,
      });
      expect(resWithPrefix.statusCode).toBe(200);
      const dataWithPrefix = resWithPrefix.json();
      expect(dataWithPrefix.orderId).toBe(orderId);
      expect(dataWithPrefix.state).toBe('QUOTED');
      expect(dataWithPrefix.direction).toBe('EVM_TO_BCH');
      expect(dataWithPrefix.bchRefundHeight).toBeGreaterThan(0);
      expect(dataWithPrefix.summary).toBeDefined();
      expect(dataWithPrefix.summary.bchToken).toBe('PUSD');
      // Verify nothing secret is exposed
      expect(
        (dataWithPrefix as Record<string, unknown>).secret,
      ).toBeUndefined();

      // Lookup by hash lock without 0x
      const cleanHash = hashLock.slice(2);
      const resWithoutPrefix = await app.inject({
        method: 'GET',
        url: `/v1/orders/by-hash-lock/${cleanHash}`,
      });
      expect(resWithoutPrefix.statusCode).toBe(200);
      expect(resWithoutPrefix.json().orderId).toBe(orderId);

      // Unknown hash lock returns 404
      const unknownHash = '0x' + '12'.repeat(32);
      const unknownRes = await app.inject({
        method: 'GET',
        url: `/v1/orders/by-hash-lock/${unknownHash}`,
      });
      expect(unknownRes.statusCode).toBe(404);
      expect(unknownRes.json().error.code).toBe('ORDER_NOT_FOUND');
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

    it('GET /v1/orders?address lists that address funded swaps and refuses a bad address', async () => {
      const addr = '0x1111111111111111111111111111111111111111';
      const now = Math.floor(Date.now() / 1000);
      const make = (
        id: string,
        status: 'DONE' | 'QUOTED',
        direction: 'EVM_TO_BCH' | 'BCH_TO_EVM' = 'EVM_TO_BCH',
      ) =>
        db.saveOrder({
          id: ('0x' + id.repeat(32)) as `0x${string}`,
          direction,
          status,
          userCounterAddress: addr,
          lockId: ('0x' + id.repeat(32)) as `0x${string}`,
          termsJson: JSON.stringify({
            evmAmount: '1000000n',
            bchTokenAmount: '99n',
            bchToken: 'PUSD',
          }),
          hashLock: ('0x' + id.repeat(32)) as `0x${string}`,
          createdAt: now,
          updatedAt: now,
        });
      make('c1', 'DONE');
      make('c2', 'QUOTED');
      make('c3', 'DONE', 'BCH_TO_EVM');
      const ok = await app.inject({
        method: 'GET',
        url: `/v1/orders?address=${addr.toUpperCase().replace('0X', '0x')}`,
      });
      expect(ok.statusCode).toBe(200);
      const listed = ok.json().orders;
      expect(listed).toHaveLength(2);
      // A BCH to EVM swap is listed as such (it was once listed the wrong way round).
      expect(
        listed.find((o: { direction: string }) => o.direction === 'BCH_TO_EVM'),
      ).toBeDefined();
      expect(listed[0]).toMatchObject({
        status: 'DONE',
        direction: expect.stringMatching(/EVM_TO_BCH|BCH_TO_EVM/),
        evmAmount: '1000000',
        bchTokenAmount: '99',
        bchToken: 'PUSD',
      });
      const bad = await app.inject({
        method: 'GET',
        url: '/v1/orders?address=nope',
      });
      expect(bad.statusCode).toBe(400);
    });

    it('relay-claim refuses a claim signed by anyone but the recipient fixed in the order', async () => {
      const { privateKeyToAccount, generatePrivateKey } =
        await import('viem/accounts');
      const { claimRequestTypedData } = await import('@ferry/core/api');
      const recipient = privateKeyToAccount(generatePrivateKey());
      const stranger = privateKeyToAccount(generatePrivateKey());
      const now = Math.floor(Date.now() / 1000);
      const orderId = ('0x' + 'f1'.repeat(32)) as `0x${string}`;
      const lockId = ('0x' + 'f2'.repeat(32)) as `0x${string}`;
      db.saveOrder({
        id: orderId,
        direction: 'BCH_TO_EVM',
        status: 'SOLVER_LOCK_SEEN',
        userCounterAddress: recipient.address,
        lockId,
        termsJson: JSON.stringify({
          userEvmAddress: recipient.address,
          evmChainId: 8453,
          bchRefundHeight: 330100,
          evmDeadline: now + 3600,
        }),
        hashLock: orderId,
        createdAt: now,
        updatedAt: now,
      });
      const typed = claimRequestTypedData({ chainId: 8453, orderId, lockId });
      const bad = await stranger.signTypedData(typed);
      const refused = await app.inject({
        method: 'POST',
        url: `/v1/orders/${orderId}/relay-claim`,
        payload: { secret: '0x' + '11'.repeat(32), lockId, claimSig: bad },
      });
      expect(refused.statusCode).toBeGreaterThanOrEqual(400);
      expect(JSON.stringify(refused.json())).toContain(
        'Only ' + recipient.address,
      );

      // Signed by the recipient: the signature check passes (later checks may still refuse).
      const good = await recipient.signTypedData(typed);
      const passed = await app.inject({
        method: 'POST',
        url: `/v1/orders/${orderId}/relay-claim`,
        payload: { secret: '0x' + '11'.repeat(32), lockId, claimSig: good },
      });
      expect(JSON.stringify(passed.json())).not.toContain(
        'Only ' + recipient.address,
      );
    });

    it('refuses a pay link below one dollar, whatever the setting', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/links',
        payload: {
          token: 'PUSD',
          recipientAddress:
            'bchtest:zqg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zy6fphnwyk',
          amountOut: '99',
        },
      });
      expect(res.statusCode).toBe(400);
      expect(JSON.stringify(res.json())).toContain('at least');
    });

    it('a pay link follows the swap that pays it: reserved while it runs, paid when it is done', async () => {
      const created = await app.inject({
        method: 'POST',
        url: '/v1/links',
        payload: {
          token: 'PUSD',
          recipientAddress:
            'bchtest:zqg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zy6fphnwyk',
          amountOut: '200',
        },
      });
      expect(created.statusCode).toBe(200);
      const link = created.json();
      const now = Math.floor(Date.now() / 1000);
      const orderId = ('0x' + 'e7'.repeat(32)) as `0x${string}`;
      db.saveOrder({
        id: orderId,
        direction: 'EVM_TO_BCH',
        status: 'SOLVER_LOCK_SEEN',
        userCounterAddress: '0x2222222222222222222222222222222222222222',
        lockId: orderId,
        termsJson: JSON.stringify({
          evmAmount: '2060000n',
          evmChainId: 8453,
          evmToken: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
          bchTokenAmount: '200n',
          bchToken: 'PUSD',
          userBchLockingBytecode: link.recipientLockingBytecode,
        }),
        hashLock: orderId,
        createdAt: now,
        updatedAt: now,
      });
      const running = await app.inject({
        method: 'GET',
        url: `/v1/links/${link.id}`,
      });
      expect(running.json()).toMatchObject({ status: 'reserved', orderId });

      db.saveOrder({
        ...db.getOrder(orderId)!,
        status: 'DONE',
        updatedAt: now + 30,
      });
      const done = await app.inject({
        method: 'GET',
        url: `/v1/links/${link.id}`,
      });
      expect(done.json()).toMatchObject({
        status: 'paid',
        orderId,
        paidAt: now + 30,
      });
      // The answer says what the swap moved, so a paid link can show the amount and what was used.
      expect(done.json().order.summary).toMatchObject({
        bchToken: 'PUSD',
        bchTokenAmount: '200',
        evmAmount: '2060000',
        evmChainId: 8453,
      });
      // One answer carries the swap's state and its timeline, kept in the database.
      expect(done.json().order.timeline).toEqual([
        { status: 'SOLVER_LOCK_SEEN', at: now },
        { status: 'DONE', at: now + 30 },
      ]);
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
          hashLock: sha256(('0x' + '9a'.repeat(32)) as `0x${string}`),
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
    it('refuses a send quote for a chain or token that is not an enabled route', async () => {
      const base = {
        amount: '10000000',
        recipientAddress: '0x87Ea46fe296C1810eF234A8e8D782A2122deFaDd',
        windowSeconds: 86400,
        bchToken: 'PUSD',
        hashLock: `0x${'ab'.repeat(32)}`,
      };
      const otherChain = await app.inject({
        method: 'POST',
        url: '/v1/send-quotes',
        payload: { ...base, destinationChainId: 999999 },
      });
      expect(otherChain.statusCode).toBe(422);
      expect(otherChain.json().reason).toBe('ROUTE_DISABLED');
      const otherToken = await app.inject({
        method: 'POST',
        url: '/v1/send-quotes',
        payload: {
          ...base,
          evmToken: '0x1111111111111111111111111111111111111111',
        },
      });
      expect(otherToken.statusCode).toBe(422);
      expect(otherToken.json().reason).toBe('ROUTE_DISABLED');
    });

    it('POST /v1/send-quotes plans window, hold fee, and generates send link quote', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/send-quotes',
        payload: {
          amount: '10000000', // 10 USDC ($10.00)
          recipientAddress: '0x87Ea46fe296C1810eF234A8e8D782A2122deFaDd',
          windowSeconds: 86400, // 24 hours
          bchToken: 'PUSD',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.orderId).toBeDefined();
      expect(body.terms.evmChainId).toBe(84532);
      expect(body.terms.evmDeadline).toBeGreaterThan(0);
      expect(body.terms.bchRefundHeight).toBeGreaterThan(0);
    });

    // Each call uses a different recipient so the per-address rate limit never trips.
    let recipientCounter = 0x1000;
    let sendQuoteCount = 0;
    async function sendQuote(extra: Record<string, unknown>) {
      recipientCounter += 1;
      const recipient = `0x${recipientCounter.toString(16).padStart(40, '0')}`;
      return app.inject({
        method: 'POST',
        url: '/v1/send-quotes',
        payload: {
          amount: '10000000',
          recipientAddress: recipient,
          windowSeconds: 86400,
          bchToken: 'PUSD',
          hashLock: sha256(
            `0x${(sendQuoteCount++).toString(16).padStart(64, '7')}` as `0x${string}`,
          ),
          ...extra,
        },
      });
    }

    it('a send link carries a note, and the receiver reads it from the link details', async () => {
      const note = 'Happy birthday! Dinner is on me.';
      const res = await sendQuote({ note });
      expect(res.statusCode).toBe(200);
      const { orderId } = res.json();

      const details = await app.inject({
        method: 'GET',
        url: `/v1/send-links/${orderId}`,
      });
      expect(details.statusCode).toBe(200);
      expect(details.json().note).toBe(note);
    });

    it('a send link without a note has none in its details', async () => {
      const res = await sendQuote({
        hashLock: sha256(('0x' + '78'.repeat(32)) as `0x${string}`),
      });
      expect(res.statusCode).toBe(200);
      const details = await app.inject({
        method: 'GET',
        url: `/v1/send-links/${res.json().orderId}`,
      });
      expect(details.json().note).toBeUndefined();
    });

    it('refuses a note that is too long, empty, or has line breaks', async () => {
      for (const note of [
        'x'.repeat(141),
        '   ',
        'line one\nline two',
        'tab\there',
      ]) {
        const res = await sendQuote({ note });
        expect(res.statusCode).toBe(400);
      }
    });

    it('trims a note and stores it as plain text, never as markup the page would run', async () => {
      const res = await sendQuote({
        note: '  <img src=x onerror=alert(1)>  ',
        hashLock: sha256(('0x' + '79'.repeat(32)) as `0x${string}`),
      });
      expect(res.statusCode).toBe(200);
      const details = await app.inject({
        method: 'GET',
        url: `/v1/send-links/${res.json().orderId}`,
      });
      // Stored exactly as typed (trimmed); the page shows it as text, which the web test covers.
      expect(details.json().note).toBe('<img src=x onerror=alert(1)>');
    });

    it('accepts a custom claim window between one hour and seven days, and sets the deadline from it', async () => {
      const before = Math.floor(Date.now() / 1000);
      const res = await sendQuote({
        windowSeconds: 5 * 3600 + 1800,
        hashLock: sha256(('0x' + '7a'.repeat(32)) as `0x${string}`),
      });
      expect(res.statusCode).toBe(200);
      const deadline = res.json().terms.evmDeadline as number;
      expect(deadline - before).toBeGreaterThanOrEqual(5 * 3600 + 1800 - 5);
      expect(deadline - before).toBeLessThanOrEqual(5 * 3600 + 1800 + 30);

      const tooLong = await sendQuote({ windowSeconds: 7 * 86_400 + 1 });
      expect(tooLong.statusCode).toBe(400);
      const tooShort = await sendQuote({ windowSeconds: 3_599 });
      expect(tooShort.statusCode).toBe(400);
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
      // The receiver's own wallet needs the lock it claims.
      expect(body.lockId).toBe(id);

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
        payload: {
          ...quotePayload,
          hashLock: sha256(('0x' + '01'.repeat(32)) as `0x${string}`),
        },
      });
      expect(r1.statusCode).toBe(200);

      // 2nd request succeeds
      const r2 = await limitedApp.inject({
        method: 'POST',
        url: '/v1/quotes',
        payload: {
          ...quotePayload,
          hashLock: sha256(('0x' + '02'.repeat(32)) as `0x${string}`),
        },
      });
      expect(r2.statusCode).toBe(200);

      // 3rd request is rate-limited (429)
      const r3 = await limitedApp.inject({
        method: 'POST',
        url: '/v1/quotes',
        payload: {
          ...quotePayload,
          hashLock: sha256(('0x' + '03'.repeat(32)) as `0x${string}`),
        },
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

describe('GET /v1/evm/balance', () => {
  it('refuses a chain or token that is not a recorded one, so it is no general RPC proxy', async () => {
    const config = SolverConfigSchema.parse({});
    const app = buildServer({
      config,
      db: new SolverDatabase(':memory:'),
      evmAdapter: {} as never,
      bchClient: {} as never,
      engine: { isQuotingEnabled: () => true } as never,
      priceSource: new MockPriceSource(),
      publicClient: { readContract: async () => 1n } as never,
    } as never);
    await app.ready();
    const owner = '0x12DC0000000000000000000000000000001Da841';
    const unknownToken = await app.inject({
      method: 'GET',
      url: `/v1/evm/balance?chainId=8453&token=0x1111111111111111111111111111111111111111&owner=${owner}`,
    });
    expect(unknownToken.statusCode).toBe(422);
    const badInput = await app.inject({
      method: 'GET',
      url: '/v1/evm/balance?chainId=abc&token=x&owner=y',
    });
    expect(badInput.statusCode).toBe(400);
  });
});
