import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { sha256 } from 'viem';
import type { EvmChainAdapter } from '@ferry/chain-evm';
import { switchRouteRequestTypedData } from '@ferry/core/api';
import { buildServer } from '../src/api/server.js';
import { SolverDatabase } from '../src/db/database.js';
import { SolverConfigSchema } from '../src/config.js';
import { SolverEngine } from '../src/engine/runner.js';
import type { BchQuorumClient } from '../src/bch/quorum-client.js';
import { MockPriceSource } from '../src/pricing/price-source.js';
import type { InventoryReader } from '../src/inventory/index.js';
import type { ActiveRoutesContext } from '../src/routes/active-routes.js';

describe('Send link route switching (receiver chooses destination)', () => {
  let app: FastifyInstance;
  let db: SolverDatabase;
  let fakeBchClient: BchQuorumClient;
  let fakeEvmAdapter: EvmChainAdapter;
  let engine: SolverEngine;
  let priceSource: MockPriceSource;
  let quorumTip = 330000;

  const solverEvmKey =
    '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as const;
  const operatorToken = 'test-operator-token-32-chars-long-secret!';

  // Simulated inventory balances:
  // Route key: `${chain}:${asset}`
  const mockInventoryMap = new Map<string, bigint>([
    ['base:USDC', 1_000_000_000_000n],
    ['arbitrum:USDC', 1_000_000_000_000n],
    ['ethereum:USDC', 1_000_000_000_000n],
  ]);

  beforeEach(() => {
    mockInventoryMap.set('base:USDC', 1_000_000_000_000n);
    mockInventoryMap.set('arbitrum:USDC', 1_000_000_000_000n);
    mockInventoryMap.set('ethereum:USDC', 1_000_000_000_000n);
  });

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
    } as unknown as EvmChainAdapter;

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
          {
            id: 'ethereum',
            chainId: 1,
            name: 'Ethereum',
            htlcAddress: '0x3333333333333333333333333333333333333333',
            assets: [
              {
                symbol: 'USDC',
                address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
                decimals: 6,
                verified: true,
              },
            ],
          },
        ],
      },
      routes: [
        { key: 'usdc:base', chain: 'base', asset: 'USDC', enabled: true },
        {
          key: 'usdc:arbitrum',
          chain: 'arbitrum',
          asset: 'USDC',
          enabled: true,
        },
        {
          key: 'usdc:ethereum',
          chain: 'ethereum',
          asset: 'USDC',
          enabled: true,
        },
      ],
      enabledRoutes: [
        { key: 'usdc:base', chain: 'base', asset: 'USDC', enabled: true },
        {
          key: 'usdc:arbitrum',
          chain: 'arbitrum',
          asset: 'USDC',
          enabled: true,
        },
        {
          key: 'usdc:ethereum',
          chain: 'ethereum',
          asset: 'USDC',
          enabled: true,
        },
      ],
    };

    app = buildServer({
      config,
      db,
      evmAdapter: fakeEvmAdapter,
      bchClient: fakeBchClient,
      priceSource,
      engine,
      inventoryReader: fakeInventoryReader as unknown as InventoryReader,
      routesContext: routesContext as unknown as ActiveRoutesContext,
    });

    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    db.close();
  });

  async function createInitialSendLink(recipientAddress: string) {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/send-quotes',
      payload: {
        amount: '1000000', // $10.00 in PUSD (2 decimals)
        recipientAddress,
        windowSeconds: 86400, // 24 hours
        bchToken: 'PUSD',
        chainId: 8453, // Base
        evmToken: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // Base USDC
        hashLock: sha256(
          ('0x' +
            Math.random()
              .toString(16)
              .slice(2)
              .padStart(64, '0')) as `0x${string}`,
        ),
      },
    });

    if (res.statusCode !== 200) {
      console.error('send-quote failed with body:', res.body);
    }
    expect(res.statusCode).toBe(200);
    return JSON.parse(res.body);
  }

  it('allows receiver to switch route before EVM lock and maintains original URL resolution', async () => {
    const recipient = privateKeyToAccount(generatePrivateKey());
    const quote = await createInitialSendLink(recipient.address);
    const initialOrderId = quote.orderId;

    // Recipient wants to switch to Arbitrum USDC (chain 42161)
    const arbitrumUsdc = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';
    const targetChainId = 42161;

    const typedData = switchRouteRequestTypedData({
      targetChainId,
      orderId: initialOrderId,
      token: arbitrumUsdc,
    });

    const signature = await recipient.signTypedData(
      typedData as unknown as Parameters<typeof recipient.signTypedData>[0],
    );

    // Call switch route
    const switchRes = await app.inject({
      method: 'POST',
      url: `/v1/send-links/${initialOrderId}/switch-route`,
      payload: {
        chainId: targetChainId,
        token: arbitrumUsdc,
        signature,
      },
    });

    if (switchRes.statusCode !== 200) {
      console.error('switchRes failed with body:', switchRes.body);
    }
    expect(switchRes.statusCode).toBe(200);
    const switchBody = JSON.parse(switchRes.body);
    expect(switchBody.ok).toBe(true);
    expect(switchBody.originalOrderId).toBe(initialOrderId);
    expect(switchBody.newOrderId).not.toBe(initialOrderId);
    expect(switchBody.chainId).toBe(targetChainId);
    expect(switchBody.token.toLowerCase()).toBe(arbitrumUsdc.toLowerCase());

    const newOrderId = switchBody.newOrderId;

    // Both the original link URL (/v1/send-links/:initialOrderId) and the new URL resolve to the new order!
    const getInitialRes = await app.inject({
      method: 'GET',
      url: `/v1/send-links/${initialOrderId}`,
    });
    expect(getInitialRes.statusCode).toBe(200);
    const initialLinkDetails = JSON.parse(getInitialRes.body);
    expect(initialLinkDetails.chainId).toBe(targetChainId);
    expect(initialLinkDetails.evmToken.toLowerCase()).toBe(
      arbitrumUsdc.toLowerCase(),
    );

    const getNewRes = await app.inject({
      method: 'GET',
      url: `/v1/send-links/${newOrderId}`,
    });
    expect(getNewRes.statusCode).toBe(200);
    const newLinkDetails = JSON.parse(getNewRes.body);
    expect(newLinkDetails.chainId).toBe(targetChainId);
    expect(newLinkDetails.hashLock).toBe(initialLinkDetails.hashLock);
    expect(newLinkDetails.bchRefundHeight).toBe(
      initialLinkDetails.bchRefundHeight,
    );

    // Sender refund terms (hashLock and bchRefundHeight) are strictly identical
    expect(newLinkDetails.hashLock).toBe(quote.terms.hashLock);
    expect(newLinkDetails.bchRefundHeight).toBe(quote.terms.bchRefundHeight);

    // DB state: old order is SUPERSEDED, new order is active
    const oldOrder = db.getOrder(initialOrderId);
    expect(oldOrder?.status).toBe('SUPERSEDED');
    const newOrder = db.getOrder(newOrderId);
    expect(newOrder?.status).toBe('QUOTED');
  });

  it('refuses switch after solver has broadcast an EVM lock (409 CONFLICT)', async () => {
    const recipient = privateKeyToAccount(generatePrivateKey());
    const quote = await createInitialSendLink(recipient.address);
    const orderId = quote.orderId;

    // Simulate solver has locked on EVM
    const order = db.getOrder(orderId)!;
    db.saveOrder({
      ...order,
      status: 'SOLVER_LOCK_BROADCAST',
      solverLockTxId: '0x' + 'aa'.repeat(32),
      updatedAt: Math.floor(Date.now() / 1000),
    });

    const arbitrumUsdc = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';
    const targetChainId = 42161;

    const typedData = switchRouteRequestTypedData({
      targetChainId,
      orderId,
      token: arbitrumUsdc,
    });
    const signature = await recipient.signTypedData(
      typedData as unknown as Parameters<typeof recipient.signTypedData>[0],
    );

    const switchRes = await app.inject({
      method: 'POST',
      url: `/v1/send-links/${orderId}/switch-route`,
      payload: {
        chainId: targetChainId,
        token: arbitrumUsdc,
        signature,
      },
    });

    expect(switchRes.statusCode).toBe(409);
    const body = JSON.parse(switchRes.body);
    expect(body.error.code).toBe('CONFLICT');
    expect(body.error.message).toContain('already locked');
  });

  it('refuses switch when stranger signs the request (401 UNAUTHORIZED)', async () => {
    const recipient = privateKeyToAccount(generatePrivateKey());
    const stranger = privateKeyToAccount(generatePrivateKey());
    const quote = await createInitialSendLink(recipient.address);
    const orderId = quote.orderId;

    const arbitrumUsdc = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';
    const targetChainId = 42161;

    // Stranger signs instead of the entered recipient
    const typedData = switchRouteRequestTypedData({
      targetChainId,
      orderId,
      token: arbitrumUsdc,
    });
    const signature = await stranger.signTypedData(
      typedData as unknown as Parameters<typeof stranger.signTypedData>[0],
    );

    const switchRes = await app.inject({
      method: 'POST',
      url: `/v1/send-links/${orderId}/switch-route`,
      payload: {
        chainId: targetChainId,
        token: arbitrumUsdc,
        signature,
      },
    });

    expect(switchRes.statusCode).toBe(401);
    const body = JSON.parse(switchRes.body);
    expect(body.error.code).toBe('UNAUTHORIZED');
    expect(body.error.message).toContain('can change this route');
  });

  it('refuses switch when remaining time before refund is less than safety margin (422 TIMING_INVARIANT_FAILED)', async () => {
    const recipient = privateKeyToAccount(generatePrivateKey());
    const quote = await createInitialSendLink(recipient.address);
    const orderId = quote.orderId;

    // Advance quorumTip close to bchRefundHeight so remainingBlocks < 33 (safety window failed)
    const originalTip = quorumTip;
    quorumTip = quote.terms.bchRefundHeight - 5; // only 5 blocks left!

    try {
      const arbitrumUsdc = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';
      const targetChainId = 42161;

      const typedData = switchRouteRequestTypedData({
        targetChainId,
        orderId,
        token: arbitrumUsdc,
      });
      const signature = await recipient.signTypedData(
        typedData as unknown as Parameters<typeof recipient.signTypedData>[0],
      );

      const switchRes = await app.inject({
        method: 'POST',
        url: `/v1/send-links/${orderId}/switch-route`,
        payload: {
          chainId: targetChainId,
          token: arbitrumUsdc,
          signature,
        },
      });

      expect(switchRes.statusCode).toBe(422);
      const body = JSON.parse(switchRes.body);
      expect(body.error.code).toBe('TIMING_INVARIANT_FAILED');
      expect(body.error.message).toContain(
        'This send link can no longer be claimed in time. The sender will receive a refund on Bitcoin Cash.',
      );
    } finally {
      quorumTip = originalTip;
    }
  });

  it('refuses short-liquidity route and suggests alternative routes with liquidity', async () => {
    const recipient = privateKeyToAccount(generatePrivateKey());
    const quote = await createInitialSendLink(recipient.address);
    const orderId = quote.orderId;

    // Set Arbitrum USDC inventory to 0 so it's short of liquidity
    mockInventoryMap.set('arbitrum:USDC', 0n);

    const arbitrumUsdc = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';
    const targetChainId = 42161;

    const typedData = switchRouteRequestTypedData({
      targetChainId,
      orderId,
      token: arbitrumUsdc,
    });
    const signature = await recipient.signTypedData(
      typedData as unknown as Parameters<typeof recipient.signTypedData>[0],
    );

    const switchRes = await app.inject({
      method: 'POST',
      url: `/v1/send-links/${orderId}/switch-route`,
      payload: {
        chainId: targetChainId,
        token: arbitrumUsdc,
        signature,
      },
    });

    expect(switchRes.statusCode).toBe(422);
    const body = JSON.parse(switchRes.body);
    expect(body.error.code).toBe('INSUFFICIENT_INVENTORY');
    expect(body.suggestedRoutes).toBeDefined();
    expect(body.suggestedRoutes.length).toBeGreaterThanOrEqual(1);

    // Suggested routes should have liquidity (e.g. Base or Ethereum USDC)
    const suggested = body.suggestedRoutes as { chain: string }[];
    expect(suggested.some((r) => r.chain.toLowerCase().includes('base'))).toBe(
      true,
    );
  });
});
