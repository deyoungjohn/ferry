import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from 'vitest';
import type { FastifyInstance } from 'fastify';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { sha256 } from 'viem';
import type { EvmChainAdapter } from '@ferry/chain-evm';
import {
  confirmRouteRequestTypedData,
  switchRouteRequestTypedData,
} from '@ferry/core/api';
import {
  parseOrderTerms,
  type Hex,
  type Hex32,
  type OrderTerms,
} from '@ferry/core';
import { buildServer } from '../src/api/server.js';
import { SolverDatabase } from '../src/db/database.js';
import { SolverConfigSchema } from '../src/config.js';
import { SolverEngine, stringifyTerms } from '../src/engine/runner.js';
import type { BchQuorumClient } from '../src/bch/quorum-client.js';
import { MockPriceSource } from '../src/pricing/price-source.js';
import type { InventoryReader } from '../src/pricing/inventory-reader.js';
import type { SolverRoutesContext } from '../src/ops/routes-config.js';
import type { BchChainPort, EvmChainPort } from '../src/engine/types.js';
import { newTestEngine } from './support/test-engine.js';

describe('Send link hold solver EVM lock until receiver chooses', () => {
  let app: FastifyInstance;
  let db: SolverDatabase;
  let fakeBchClient: BchQuorumClient;
  let fakeEvmAdapter: EvmChainAdapter;
  let engine: SolverEngine;
  let priceSource: MockPriceSource;
  const quorumTip = 330000;
  let evmBroadcastSpy: Mock<(txHex: string) => Promise<string>>;
  let evmPort: EvmChainPort;
  let bchPort: BchChainPort;

  const solverEvmKey =
    '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as const;
  const operatorToken = 'test-operator-token-32-chars-long-secret!';

  const mockInventoryMap = new Map<string, bigint>([
    ['base:USDC', 1_000_000_000_000n],
    ['arbitrum:USDC', 1_000_000_000_000n],
    ['ethereum:USDC', 1_000_000_000_000n],
  ]);

  const fakeInventoryReader = {
    getBchInventory: async () => ({
      sats: 10_000_000,
      pusd: 50_000_000n,
      musd: 50_000_000n,
    }),
    getEvmInventory: async () => ({
      nativeWei: 1_000_000_000_000_000_000n,
      tokenAtoms: 100_000_000n,
    }),
    getAssetInventory: async (params: { asset: string; chain: string }) => {
      const key = `${params.chain.toLowerCase()}:${params.asset.toUpperCase()}`;
      return mockInventoryMap.get(key) ?? 0n;
    },
    isFresh: () => true,
    lastReadTime: () => Date.now(),
  };

  const routesContext = {
    chainConfig: {
      facts: [
        {
          id: 'base',
          chainId: 8453,
          name: 'Base',
          htlcAddress: '0x1111111111111111111111111111111111111111',
          assets: [
            {
              symbol: 'USDC',
              address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
              decimals: 6,
              verified: true,
            },
          ],
        },
        {
          id: 'arbitrum',
          chainId: 42161,
          name: 'Arbitrum',
          htlcAddress: '0x2222222222222222222222222222222222222222',
          assets: [
            {
              symbol: 'USDC',
              address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
              decimals: 6,
              verified: true,
            },
          ],
        },
      ],
    },
    enabledRoutes: [
      { chain: 'base', asset: 'USDC' },
      { chain: 'arbitrum', asset: 'USDC' },
    ],
  };

  beforeAll(async () => {
    db = new SolverDatabase(':memory:');

    fakeBchClient = {
      getQuorumStatus: () => ({
        quorumTip,
        tips: { 'wss://mock1': quorumTip, 'wss://mock2': quorumTip },
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
    } as unknown as EvmChainAdapter;

    priceSource = new MockPriceSource();

    evmOnChain = false;
    evmBroadcastSpy = vi.fn().mockImplementation(async () => {
      evmOnChain = true;
      return '0xevm_lock_broadcast_tx';
    });

    evmPort = {
      getTip: async () => ({ height: 1000, finalized: true }),
      getLock: async () => ({ status: 'none' }),
      isFinal: async () => false,
      broadcast: evmBroadcastSpy,
      isOnChain: async () => evmOnChain,
    };

    bchPort = {
      getTip: async () => ({ height: quorumTip, hash: '0x00tip' }),
      isQuorumHealthy: () => true,
      isQuotingEnabled: () => true,
      broadcast: vi.fn().mockResolvedValue('0xbch_txid'),
      isOnChain: async () => true,
      getScriptHashHistory: async () => [
        { tx_hash: 'tx_bch_lock_confirmed', height: quorumTip - 2 },
      ],
    };

    engine = newTestEngine(db, bchPort, evmPort);

    const config = SolverConfigSchema.parse({
      solverEvmPrivateKey: solverEvmKey,
      operatorToken,
      allowMockPaylinkSignatures: true,
      baseHtlcAddress: '0x1111111111111111111111111111111111111111',
      baseUsdcAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    });

    app = await buildServer({
      config,
      db,
      evmAdapter: fakeEvmAdapter,
      bchClient: fakeBchClient,
      engine,
      priceSource,
      inventoryReader: fakeInventoryReader as unknown as InventoryReader,
      routesContext: routesContext as unknown as SolverRoutesContext,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  let evmOnChain = false;

  beforeEach(() => {
    evmOnChain = false;
    evmBroadcastSpy.mockClear();
  });

  function createTestOrder(params: {
    recipientAccount: ReturnType<typeof privateKeyToAccount>;
    isHeld?: boolean;
    bchRefundHeightOffset?: number;
    evmDeadlineOffset?: number;
  }) {
    const now = Math.floor(Date.now() / 1000);
    const secret = ('0x' + '77'.repeat(32)) as Hex32;
    const hashLock = sha256(secret);

    const terms: OrderTerms = parseOrderTerms({
      version: 1,
      direction: 'BCH_TO_EVM',
      bchToken: 'PUSD',
      bchTokenCategory: `0x${'aa'.repeat(32)}`,
      bchTokenAmount: 2000n,
      evmAmount: 20_000_000n,
      evmToken: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      evmChainId: 8453,
      evmHtlc: '0x1111111111111111111111111111111111111111',
      userEvmAddress: params.recipientAccount.address,
      userBchLockingBytecode:
        '0x76a914000000000000000000000000000000000000000088ac',
      solverEvmAddress: '0xC9ec91859Bdb598dC2eeE715934D8231478f7A70',
      solverBchLockingBytecode:
        '0x76a914111111111111111111111111111111111111111188ac',
      hashLock,
      evmDeadline: now + (params.evmDeadlineOffset ?? 21600),
      bchRefundHeight: quorumTip + (params.bchRefundHeightOffset ?? 144),
      bchCarrySats: 3000n,
      bchMaxFee: 1500n,
      quoteId: `quote-${now}-${Math.random().toString(36).slice(2, 6)}`,
      quoteExpiry: now + 300,
      pricing: {
        refs: [
          {
            asset: 'PUSD',
            usdPrice: '1.000',
            source: 'cauldron',
            asOf: now - 10,
          },
        ],
        spreadBps: 50,
        fixedFeeBase: 0n,
        rounding: 'floor',
      },
    });

    const orderId = ('0x' +
      Array.from({ length: 64 }, () =>
        Math.floor(Math.random() * 16).toString(16),
      ).join('')) as Hex32;
    const lockId = ('0x' +
      Array.from({ length: 64 }, () =>
        Math.floor(Math.random() * 16).toString(16),
      ).join('')) as Hex32;

    db.saveOrder({
      id: orderId,
      direction: 'BCH_TO_EVM',
      status: 'USER_LOCK_FINAL',
      userCounterAddress: terms.userEvmAddress,
      lockId,
      termsJson: stringifyTerms(terms),
      hashLock,
      lane: 'safe',
      fastOptIn: false,
      userLockTxId: 'tx_bch_lock_confirmed',
      firstSeenAtMs: Date.now(),
      needsAttention: false,
      createdAt: now,
      updatedAt: now,
    });
    db.markSendLinkOrder(orderId);

    if (params.isHeld) {
      db.markSendLinkHeld(orderId, now);
    }

    return { orderId, terms, secret, hashLock };
  }

  it('criterion 1: a held order does not lock before confirmation', async () => {
    const recipient = privateKeyToAccount(generatePrivateKey());
    const { orderId } = createTestOrder({
      recipientAccount: recipient,
      isHeld: true,
    });

    expect(db.isSendLinkHeld(orderId)).toBe(true);

    const orderRecord = db.getOrder(orderId)!;
    await engine.stepOrder(orderRecord);

    // The runner did NOT broadcast an EVM lock
    expect(evmBroadcastSpy).not.toHaveBeenCalled();
    const updated = db.getOrder(orderId)!;
    expect(updated.status).toBe('USER_LOCK_FINAL');
    expect(updated.solverLockTxId).toBeUndefined();
  });

  it('criterion 2: after a confirm of the default it locks on the default chain', async () => {
    const recipient = privateKeyToAccount(generatePrivateKey());
    const { orderId, terms } = createTestOrder({
      recipientAccount: recipient,
      isHeld: true,
    });

    const orderIdHex = (
      orderId.startsWith('0x') ? orderId : `0x${orderId}`
    ) as `0x${string}`;
    const typed = confirmRouteRequestTypedData({
      targetChainId: terms.evmChainId,
      orderId: orderIdHex,
      token: terms.evmToken as `0x${string}`,
    });
    const signature = await recipient.signTypedData(typed);

    const res = await app.inject({
      method: 'POST',
      url: `/v1/send-links/${orderId}/confirm`,
      payload: {
        chainId: terms.evmChainId,
        token: terms.evmToken,
        signature,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.status).toBe('confirmed');

    // Hold is now confirmed
    expect(db.isSendLinkHeld(orderId)).toBe(false);

    // Engine steps and builds the EVM lock on the default chain
    const orderRecord = db.getOrder(orderId)!;
    await engine.stepOrder(orderRecord);

    expect(evmBroadcastSpy).toHaveBeenCalledTimes(1);
    const lockedOrder = db.getOrder(orderId)!;
    expect(lockedOrder.status).toBe('SOLVER_LOCK_SEEN');
  });

  it('criterion 3: after a switch it locks on the chosen chain with the same hash lock', async () => {
    const recipient = privateKeyToAccount(generatePrivateKey());
    const { orderId, hashLock } = createTestOrder({
      recipientAccount: recipient,
      isHeld: true,
    });

    const targetChainId = 42161; // Arbitrum
    const targetToken = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' as Hex;

    const orderIdHex = (
      orderId.startsWith('0x') ? orderId : `0x${orderId}`
    ) as `0x${string}`;
    const typed = switchRouteRequestTypedData({
      targetChainId,
      orderId: orderIdHex,
      token: targetToken,
    });
    const signature = await recipient.signTypedData(typed);

    const res = await app.inject({
      method: 'POST',
      url: `/v1/send-links/${orderId}/switch-route`,
      payload: {
        chainId: targetChainId,
        token: targetToken,
        signature,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    const newOrderId = body.newOrderId;

    // Both old order and new order hold are confirmed
    expect(db.isSendLinkHeld(orderId)).toBe(false);
    expect(db.isSendLinkHeld(newOrderId)).toBe(false);

    // Engine steps the replacement order
    const replacementRecord = db.getOrder(newOrderId)!;
    expect(replacementRecord.hashLock).toBe(hashLock);
    expect(JSON.parse(replacementRecord.termsJson).evmChainId).toBe(
      targetChainId,
    );

    await engine.stepOrder(replacementRecord);

    expect(evmBroadcastSpy).toHaveBeenCalledTimes(1);
    const lockedReplacement = db.getOrder(newOrderId)!;
    expect(lockedReplacement.status).toBe('SOLVER_LOCK_SEEN');
    expect(lockedReplacement.hashLock).toBe(hashLock);
  });

  it('criterion 4: a confirm too late is refused', async () => {
    const recipient = privateKeyToAccount(generatePrivateKey());
    // Insufficient time: refund height is already reached
    const { orderId, terms } = createTestOrder({
      recipientAccount: recipient,
      isHeld: true,
      bchRefundHeightOffset: 1, // Only 1 block above tip: invariant R fails!
    });

    const orderIdHex = (
      orderId.startsWith('0x') ? orderId : `0x${orderId}`
    ) as `0x${string}`;
    const typed = confirmRouteRequestTypedData({
      targetChainId: terms.evmChainId,
      orderId: orderIdHex,
      token: terms.evmToken as `0x${string}`,
    });
    const signature = await recipient.signTypedData(typed);

    const res = await app.inject({
      method: 'POST',
      url: `/v1/send-links/${orderId}/confirm`,
      payload: {
        chainId: terms.evmChainId,
        token: terms.evmToken,
        signature,
      },
    });

    expect(res.statusCode).toBe(422);
    const body = res.json();
    expect(body.error.code).toBe('TIMING_INVARIANT_FAILED');
    expect(body.error.message).toBe(
      'This send link can no longer be claimed in time. The sender will receive a refund on Bitcoin Cash.',
    );
  });

  it("criterion 5: a stranger's signature is refused", async () => {
    const recipient = privateKeyToAccount(generatePrivateKey());
    const stranger = privateKeyToAccount(generatePrivateKey());
    const { orderId, terms } = createTestOrder({
      recipientAccount: recipient,
      isHeld: true,
    });

    const orderIdHex = (
      orderId.startsWith('0x') ? orderId : `0x${orderId}`
    ) as `0x${string}`;
    const typed = confirmRouteRequestTypedData({
      targetChainId: terms.evmChainId,
      orderId: orderIdHex,
      token: terms.evmToken as `0x${string}`,
    });
    // Signed by stranger!
    const signature = await stranger.signTypedData(typed);

    const res = await app.inject({
      method: 'POST',
      url: `/v1/send-links/${orderId}/confirm`,
      payload: {
        chainId: terms.evmChainId,
        token: terms.evmToken,
        signature,
      },
    });

    expect(res.statusCode).toBe(401);
    const body = res.json();
    expect(body.error.code).toBe('UNAUTHORIZED');
    expect(body.error.message.toLowerCase()).toContain(
      recipient.address.toLowerCase(),
    );
  });

  it('criterion 6: a cancelled held order is never locked', async () => {
    const recipient = privateKeyToAccount(generatePrivateKey());
    const { orderId } = createTestOrder({
      recipientAccount: recipient,
      isHeld: true,
    });

    const now = Math.floor(Date.now() / 1000);
    db.recordSendLinkCancellation(orderId, 'sender_bch_address', now);

    const cancelledOrder = db.getOrder(orderId)!;
    expect(cancelledOrder.status).toBe('CANCELLED');

    // Engine steps the cancelled order: it must NEVER lock!
    await engine.stepOrder(cancelledOrder);

    expect(evmBroadcastSpy).not.toHaveBeenCalled();
    const refreshed = db.getOrder(orderId)!;
    expect(refreshed.solverLockTxId).toBeUndefined();
  });

  it('criterion 7: an old (not held) order still locks at once', async () => {
    const recipient = privateKeyToAccount(generatePrivateKey());
    // isHeld: false (standard or legacy send link made before hold was introduced)
    const { orderId } = createTestOrder({
      recipientAccount: recipient,
      isHeld: false,
    });

    expect(db.isSendLinkHeld(orderId)).toBe(false);

    const orderRecord = db.getOrder(orderId)!;
    await engine.stepOrder(orderRecord);

    // Old order locks at once without needing receiver confirmation!
    expect(evmBroadcastSpy).toHaveBeenCalledTimes(1);
    const updated = db.getOrder(orderId)!;
    expect(updated.status).toBe('SOLVER_LOCK_SEEN');
    expect(updated.solverLockTxId).toBeDefined();
  });
});
