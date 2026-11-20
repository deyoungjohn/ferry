import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import * as libauth from '@bitauth/libauth';
import type { EvmChainAdapter } from '@ferry/chain-evm';
import {
  deriveRecoveryRoot,
  swapCancelHashAt,
  swapCancelKeyAt,
  swapHashLockAt,
  swapSecretAt,
  type Hex32,
  type OrderTerms,
} from '@ferry/core';
import { buildServer } from '../src/api/server.js';
import { SolverDatabase } from '../src/db/database.js';
import { SolverConfigSchema } from '../src/config.js';
import type { SolverEngine } from '../src/engine/runner.js';
import type { BchQuorumClient } from '../src/bch/quorum-client.js';
import { MockPriceSource } from '../src/pricing/price-source.js';

describe('Send link cancellation and quota limits', () => {
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

  // Deterministic recovery root for test sender
  const mockSig = ('0x' + '12'.repeat(65)) as `0x${string}`;
  const senderRoot = deriveRecoveryRoot(mockSig);

  // BCH sender keys (P2PKH)
  const bchPrivHex = '33'.repeat(32);
  let bchPubHex: string;
  let bchP2pkhLockingBytecode: string;

  beforeAll(async () => {
    const secp = await libauth.instantiateSecp256k1();
    const privBin = libauth.hexToBin(bchPrivHex);
    const pubBin = secp.derivePublicKeyCompressed(privBin);
    if (typeof pubBin === 'string') throw new Error(pubBin);
    bchPubHex = libauth.binToHex(pubBin);
    const pkh = libauth.hash160(pubBin);
    bchP2pkhLockingBytecode =
      `0x76a914${libauth.binToHex(pkh)}88ac`.toLowerCase();

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
      earlyReleaseUserBchLock: async () => {},
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

  function seedSendLinkOrder(options: {
    id: string;
    swapIndex?: number;
    status?: string;
    senderBchLocking?: string;
    solverLockTxId?: string;
    omitCancelHash?: boolean;
  }) {
    const swapIndex = options.swapIndex ?? 0;
    const hashLock = swapHashLockAt(senderRoot, swapIndex);
    const secret = swapSecretAt(senderRoot, swapIndex);
    const cancelKey = swapCancelKeyAt(senderRoot, swapIndex);
    const cancelHash = swapCancelHashAt(senderRoot, swapIndex);
    const senderLocking = (
      options.senderBchLocking ?? bchP2pkhLockingBytecode
    ).toLowerCase();

    const now = Math.floor(Date.now() / 1000);
    const terms: OrderTerms = {
      version: 1,
      direction: 'BCH_TO_EVM',
      bchToken: 'PUSD',
      bchTokenCategory: ('0x' + '22'.repeat(32)) as Hex32,
      bchTokenAmount: 2000n,
      evmAmount: 20000000n,
      evmToken: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
      evmChainId: 8453,
      evmHtlc: '0x1111111111111111111111111111111111111111',
      userEvmAddress: '0x2222222222222222222222222222222222222222',
      userBchLockingBytecode: senderLocking as `0x${string}`,
      solverEvmAddress: '0x3333333333333333333333333333333333333333',
      solverBchLockingBytecode:
        '0x76a914444444444444444444444444444444444444444488ac',
      hashLock,
      evmDeadline: now + 86400,
      bchRefundHeight: 330100,
      bchCarrySats: 2000n,
      bchMaxFee: 500n,
      quoteId: `quote_${options.id}`,
      quoteExpiry: now + 3600,
      pricing: {
        refs: [],
        spreadBps: 20,
        fixedFeeBase: 0n,
        rounding: 'floor',
      },
    };

    db.saveOrder({
      id: options.id,
      direction: 'BCH_TO_EVM',
      status: options.status ?? 'LOCKED',
      userCounterAddress: terms.userEvmAddress,
      lockId: '0x' + '55'.repeat(32),
      termsJson: JSON.stringify(terms, (_k, v) =>
        typeof v === 'bigint' ? `${v}n` : v,
      ),
      hashLock,
      secret: options.status === 'DONE' ? secret : undefined,
      solverLockTxId: options.solverLockTxId,
      createdAt: now,
      updatedAt: now,
    });

    if (!options.omitCancelHash) {
      db.saveSendLinkCancelHash(options.id, cancelHash, now);
    }

    return { terms, secret, hashLock, cancelKey, cancelHash };
  }

  it('1. cancel of an unclaimed send link succeeds with cancelKey', async () => {
    const orderId = 'send_cancel_001';
    const { cancelKey } = seedSendLinkOrder({ id: orderId, swapIndex: 0 });

    const res = await app.inject({
      method: 'POST',
      url: `/v1/send-links/${orderId}/cancel`,
      payload: {
        cancelKey,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.orderId).toBe(orderId);
    expect(body.status).toBe('cancelled');
    expect(body.quota.dailyUsed).toBe(1);
    expect(body.quota.dailyRemaining).toBe(1);
    expect(body.quota.monthlyUsed).toBe(1);
    expect(body.quota.monthlyRemaining).toBe(9);

    // Verify cancel hash is now marked spent in DB
    const cancelRecord = db.getSendLinkCancelHash(orderId);
    expect(cancelRecord?.spent).toBe(true);

    // Verify GET /v1/send-links/:id returns status: 'cancelled'
    const viewRes = await app.inject({
      method: 'GET',
      url: `/v1/send-links/${orderId}`,
    });
    expect(viewRes.statusCode).toBe(200);
    expect(viewRes.json().status).toBe('cancelled');
  });

  it('1b. cancel key opens only its own link (isolated per index)', async () => {
    const orderA = 'send_isolate_00a';
    const orderB = 'send_isolate_00b';
    const seedA = seedSendLinkOrder({ id: orderA, swapIndex: 10 });
    seedSendLinkOrder({ id: orderB, swapIndex: 11 });

    // Attempting to cancel orderB with orderA's cancelKey
    const res = await app.inject({
      method: 'POST',
      url: `/v1/send-links/${orderB}/cancel`,
      payload: {
        cancelKey: seedA.cancelKey,
      },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('NOT_YOUR_LINK');
  });

  it('1c. recoveryRoot, recoverySignature, or evmSignature bodies are refused', async () => {
    const orderId = 'send_refuse_root_001';
    seedSendLinkOrder({ id: orderId, swapIndex: 12 });

    // 1. recoveryRoot body is refused
    const resRoot = await app.inject({
      method: 'POST',
      url: `/v1/send-links/${orderId}/cancel`,
      payload: {
        recoveryRoot: senderRoot,
        swapIndex: 12,
      },
    });
    expect(resRoot.statusCode).toBe(403);
    expect(resRoot.json().error.code).toBe('NOT_YOUR_LINK');
    expect(resRoot.json().error.message).toContain('Recovery root');

    // 2. evmSignature body is refused
    const resSig = await app.inject({
      method: 'POST',
      url: `/v1/send-links/${orderId}/cancel`,
      payload: {
        evmSignature: mockSig,
      },
    });
    expect(resSig.statusCode).toBe(403);
    expect(resSig.json().error.code).toBe('NOT_YOUR_LINK');

    // 3. recoverySignature body is refused
    const resRecSig = await app.inject({
      method: 'POST',
      url: `/v1/send-links/${orderId}/cancel`,
      payload: {
        recoverySignature: mockSig,
      },
    });
    expect(resRecSig.statusCode).toBe(403);
    expect(resRecSig.json().error.code).toBe('NOT_YOUR_LINK');
  });

  it('2. cancel of an already cancelled send link is idempotent', async () => {
    const orderId = 'send_cancel_001';
    const cancelKey = swapCancelKeyAt(senderRoot, 0);

    const res = await app.inject({
      method: 'POST',
      url: `/v1/send-links/${orderId}/cancel`,
      payload: {
        cancelKey,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.status).toBe('cancelled');
    // Daily quota remains 1 (not double counted)
    expect(body.quota.dailyUsed).toBe(1);
    expect(body.quota.dailyRemaining).toBe(1);
  });

  it('3. cancel of a claimed send link refuses with ALREADY_CLAIMED', async () => {
    const orderId = 'send_claimed_001';
    const { cancelKey } = seedSendLinkOrder({
      id: orderId,
      swapIndex: 1,
      status: 'DONE',
    });

    const res = await app.inject({
      method: 'POST',
      url: `/v1/send-links/${orderId}/cancel`,
      payload: {
        cancelKey,
      },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('ALREADY_CLAIMED');
  });

  it('4. cancel when counter-lock / claim is in progress refuses with CLAIM_IN_PROGRESS', async () => {
    const orderId = 'send_in_flight_001';
    const { cancelKey } = seedSendLinkOrder({
      id: orderId,
      swapIndex: 2,
      status: 'SOLVER_LOCK_BROADCAST',
      solverLockTxId: '0x' + '77'.repeat(32),
    });

    const res = await app.inject({
      method: 'POST',
      url: `/v1/send-links/${orderId}/cancel`,
      payload: {
        cancelKey,
      },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('CLAIM_IN_PROGRESS');
  });

  it('5. unauthorized cancelKey refuses with NOT_YOUR_LINK', async () => {
    const orderId = 'send_unauth_001';
    seedSendLinkOrder({ id: orderId, swapIndex: 3 });

    const wrongKey = ('0x' + '99'.repeat(32)) as Hex32;
    const res = await app.inject({
      method: 'POST',
      url: `/v1/send-links/${orderId}/cancel`,
      payload: {
        cancelKey: wrongKey,
      },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('NOT_YOUR_LINK');
  });

  it('6. secret in link is rejected as insufficient authorization without recovery key or BCH key', async () => {
    const orderId = 'send_secret_only_001';
    const { secret } = seedSendLinkOrder({ id: orderId, swapIndex: 4 });

    const res = await app.inject({
      method: 'POST',
      url: `/v1/send-links/${orderId}/cancel`,
      payload: {
        // Pretending to be an attacker holding only the link fragment secret
        secret,
      },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('NOT_YOUR_LINK');
  });

  it('7. authorizes cancellation via Bitcoin Cash wallet signature over cancel:orderId', async () => {
    const orderId = 'send_bch_sig_001';
    seedSendLinkOrder({ id: orderId, swapIndex: 5 });

    const secp = await libauth.instantiateSecp256k1();
    const msg = `cancel:${orderId}`;
    const msgHash = libauth.sha256.hash(new TextEncoder().encode(msg));
    const privBin = libauth.hexToBin(bchPrivHex);
    const sigBin = secp.signMessageHashSchnorr(privBin, msgHash);
    if (typeof sigBin === 'string') throw new Error(sigBin);
    const sigHex = libauth.binToHex(sigBin);

    const res = await app.inject({
      method: 'POST',
      url: `/v1/send-links/${orderId}/cancel`,
      payload: {
        bchPublicKey: bchPubHex,
        bchSignature: sigHex,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.status).toBe('cancelled');
    // Daily quota is now 2
    expect(body.quota.dailyUsed).toBe(2);
    expect(body.quota.dailyRemaining).toBe(0);
  });

  it('7b. Bitcoin Cash signature requires EXACT P2PKH match (no substring match)', async () => {
    const orderId = 'send_bch_exact_001';
    // User locking bytecode embeds the pubkey hash but contains extra script opcodes (not exact P2PKH)
    const secp = await libauth.instantiateSecp256k1();
    const privBin = libauth.hexToBin(bchPrivHex);
    const pubBin = secp.derivePublicKeyCompressed(privBin);
    if (typeof pubBin === 'string') throw new Error(pubBin);
    const pkh = libauth.binToHex(libauth.hash160(pubBin));
    // Non-P2PKH script that contains the pkh substring
    const nonP2pkhLocking = `0x0014${pkh}00`;

    seedSendLinkOrder({
      id: orderId,
      swapIndex: 55,
      senderBchLocking: nonP2pkhLocking,
    });

    const msg = `cancel:${orderId}`;
    const msgHash = libauth.sha256.hash(new TextEncoder().encode(msg));
    const sigBin = secp.signMessageHashSchnorr(privBin, msgHash);
    if (typeof sigBin === 'string') throw new Error(sigBin);
    const sigHex = libauth.binToHex(sigBin);

    const res = await app.inject({
      method: 'POST',
      url: `/v1/send-links/${orderId}/cancel`,
      payload: {
        bchPublicKey: bchPubHex,
        bchSignature: sigHex,
      },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('NOT_YOUR_LINK');
  });

  it('7c. legacy link without cancel hash can only be cancelled by Bitcoin Cash signature path', async () => {
    const orderId = 'send_legacy_001';
    const { cancelKey } = seedSendLinkOrder({
      id: orderId,
      swapIndex: 56,
      omitCancelHash: true, // Legacy link made before cancel keys
    });

    // 1. cancelKey fails because link has no stored cancel key
    const resKey = await app.inject({
      method: 'POST',
      url: `/v1/send-links/${orderId}/cancel`,
      payload: {
        cancelKey,
      },
    });
    expect(resKey.statusCode).toBe(403);
    expect(resKey.json().error.code).toBe('NOT_YOUR_LINK');

    // 2. Bitcoin Cash signature path succeeds
    const secp = await libauth.instantiateSecp256k1();
    const freshPrivHex = '77'.repeat(32);
    const freshPrivBin = libauth.hexToBin(freshPrivHex);
    const freshPubBin = secp.derivePublicKeyCompressed(freshPrivBin);
    if (typeof freshPubBin === 'string') throw new Error(freshPubBin);
    const freshPubHex = libauth.binToHex(freshPubBin);
    const freshPkh = libauth.hash160(freshPubBin);
    const freshLocking =
      `0x76a914${libauth.binToHex(freshPkh)}88ac`.toLowerCase();

    const legacyOrder = 'send_legacy_fresh_001';
    seedSendLinkOrder({
      id: legacyOrder,
      swapIndex: 57,
      senderBchLocking: freshLocking,
      omitCancelHash: true,
    });

    const msg = `cancel:${legacyOrder}`;
    const msgHash = libauth.sha256.hash(new TextEncoder().encode(msg));
    const sigBin = secp.signMessageHashSchnorr(freshPrivBin, msgHash);
    if (typeof sigBin === 'string') throw new Error(sigBin);
    const sigHex = libauth.binToHex(sigBin);

    const resSig = await app.inject({
      method: 'POST',
      url: `/v1/send-links/${legacyOrder}/cancel`,
      payload: {
        bchPublicKey: freshPubHex,
        bchSignature: sigHex,
      },
    });

    expect(resSig.statusCode).toBe(200);
    expect(resSig.json().success).toBe(true);
    expect(resSig.json().status).toBe('cancelled');
  });

  it('8. third cancellation in rolling 24 hours refuses with LIMIT_REACHED and returns nextAllowedAt', async () => {
    const orderId = 'send_exceed_daily_001';
    const { cancelKey } = seedSendLinkOrder({ id: orderId, swapIndex: 6 });

    const res = await app.inject({
      method: 'POST',
      url: `/v1/send-links/${orderId}/cancel`,
      payload: {
        cancelKey,
      },
    });

    expect(res.statusCode).toBe(429);
    const body = res.json();
    expect(body.error.code).toBe('LIMIT_REACHED');
    expect(body.error.details.quota.dailyUsed).toBe(2);
    expect(body.error.details.quota.dailyRemaining).toBe(0);
    expect(body.error.details.nextAllowedAt).toBeGreaterThan(0);
  });

  it('9. eleventh cancellation in rolling 30 days refuses with LIMIT_REACHED', async () => {
    // Test with a fresh sender identity
    const freshSender = '0x76a914' + '88'.repeat(20) + '88ac';
    const now = Math.floor(Date.now() / 1000);

    // Seed 10 cancellations over the past 20 days (1 per 2 days)
    for (let i = 0; i < 10; i++) {
      const pastTime = now - (20 - i * 2) * 86400;
      db.recordSendLinkCancellation(`past_cancel_${i}`, freshSender, pastTime);
    }

    // Verify quota before 11th attempt
    const quota = db.getSendLinkCancellationQuota(freshSender, now);
    expect(quota.monthlyUsed).toBe(10);
    expect(quota.monthlyRemaining).toBe(0);
    expect(quota.dailyUsed).toBe(0); // none in last 24h
    expect(quota.dailyRemaining).toBe(2);

    // Now attempt 11th cancellation
    const orderId = 'send_exceed_monthly_001';
    const { cancelKey } = seedSendLinkOrder({
      id: orderId,
      swapIndex: 7,
      senderBchLocking: freshSender,
    });

    const res = await app.inject({
      method: 'POST',
      url: `/v1/send-links/${orderId}/cancel`,
      payload: {
        cancelKey,
      },
    });

    expect(res.statusCode).toBe(429);
    const body = res.json();
    expect(body.error.code).toBe('LIMIT_REACHED');
    expect(body.error.details.quota.monthlyUsed).toBe(10);
    expect(body.error.details.quota.monthlyRemaining).toBe(0);
  });

  it('10. receiver claim after cancellation fails cleanly with LINK_CANCELLED', async () => {
    const orderId = 'send_cancel_001'; // cancelled in test 1

    const res = await app.inject({
      method: 'POST',
      url: `/v1/orders/${orderId}/relay-claim`,
      payload: {
        secret: swapSecretAt(senderRoot, 0),
        lockId: '0x' + '55'.repeat(32),
      },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error.code).toBe('LINK_CANCELLED');
  });

  it('11. GET /v1/send-links/:id/cancel-quota returns current quota', async () => {
    const orderId = 'send_cancel_001';

    const res = await app.inject({
      method: 'GET',
      url: `/v1/send-links/${orderId}/cancel-quota`,
    });

    expect(res.statusCode).toBe(200);
    const quota = res.json();
    expect(quota.dailyLimit).toBe(2);
    expect(quota.monthlyLimit).toBe(10);
    expect(typeof quota.dailyUsed).toBe('number');
    expect(typeof quota.dailyRemaining).toBe('number');
  });

  it('12. concurrency/race test: concurrent claim and cancel never both succeed', async () => {
    // Test 10 consecutive concurrent races
    for (let i = 0; i < 10; i++) {
      const orderId = `send_race_${i}`;
      const { secret, cancelKey } = seedSendLinkOrder({
        id: orderId,
        swapIndex: 20 + i,
        senderBchLocking: `0x76a914${(i + 1).toString(16).padStart(40, '0')}88ac`,
      });

      const cancelPromise = app.inject({
        method: 'POST',
        url: `/v1/send-links/${orderId}/cancel`,
        payload: {
          cancelKey,
        },
      });

      const claimPromise = app.inject({
        method: 'POST',
        url: `/v1/orders/${orderId}/relay-claim`,
        payload: {
          secret,
          lockId: '0x' + '55'.repeat(32),
        },
      });

      const [cancelRes, claimRes] = await Promise.all([
        cancelPromise,
        claimPromise,
      ]);

      const cancelSuccess = cancelRes.statusCode === 200;
      const claimSuccess = claimRes.statusCode === 200;

      // Invariant: Never can both claim and cancel succeed!
      expect(cancelSuccess && claimSuccess).toBe(false);

      if (cancelSuccess) {
        expect(claimRes.statusCode).toBe(400); // LINK_CANCELLED
      }
    }
  });
});
