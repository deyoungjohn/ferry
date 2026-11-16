import { describe, expect, it } from 'vitest';
import { buildServer } from '../src/api/server.js';
import { loadConfigFromEnv } from '../src/config.js';
import { SolverDatabase } from '../src/db/database.js';
import {
  SolverEngine,
  orderRecordToSolverOrder,
} from '../src/engine/runner.js';
import { MockPriceSource } from '../src/pricing/price-source.js';
import { sha256 } from 'viem';
import { transition } from '../src/state-machine/transitions.js';
import type { BchChainPort, EvmChainPort } from '../src/engine/types.js';
import type { BchQuorumStatus } from '../src/bch/types.js';
import type { BchQuorumClient } from '../src/bch/quorum-client.js';
import type { EvmChainAdapter } from '@ferry/chain-evm';

const RUN_E2E = process.env.FERRY_RUN_E2E === '1';

describe.skipIf(!RUN_E2E)(
  'Opt-in Local End-to-End Integration Suite (item 4)',
  () => {
    const config = loadConfigFromEnv({
      ALLOW_DEV_KEYS: '1',
      OPERATOR_TOKEN: 'a'.repeat(32),
    });

    const now = Math.floor(Date.now() / 1000);
    const secret = ('0x' + '33'.repeat(32)) as `0x${string}`;
    const hashLock = sha256(secret);

    const mockPriceSource = new MockPriceSource(
      new Map([
        [
          'usdc',
          {
            usdPrice: 1_000_000n,
            source: 'reference',
            asOf: now,
          },
        ],
        [
          'pusd',
          {
            usdPrice: 1_000_000n,
            source: 'reference',
            asOf: now,
          },
        ],
      ]),
    );

    const mockBchPort: BchChainPort = {
      isQuorumHealthy() {
        return true;
      },
      isQuotingEnabled() {
        return true;
      },
      async getTip() {
        return { height: 330000, hash: '00'.repeat(32) };
      },
      async broadcast() {
        return 'bch-tx-' + Math.random().toString(36).slice(2, 8);
      },
      async isOnChain() {
        return true;
      },
      async getScriptHashHistory() {
        return [];
      },
    };

    const bchClient = {
      ...mockBchPort,
      getQuorumStatus(): BchQuorumStatus {
        return {
          quorumTip: 330000,
          tips: { 'wss://node1.bch': 330000, 'wss://node2.bch': 330000 },
          isQuorumHealthy: true,
          isLivenessHealthy: true,
          ageSeconds: 15,
          lastConfirmedAt: Math.floor(Date.now() / 1000) - 15,
          livenessAgeSeconds: 5,
          healthyServersCount: 2,
          quotingAllowed: true,
          quotingState: 'HEALTHY',
        };
      },
      async waitForDoubleSpendProof() {
        return { hasProof: false };
      },
      async broadcastTransaction() {
        return 'bch-tx-' + Math.random().toString(36).slice(2, 8);
      },
      async start() {},
      async stop() {},
    } as unknown as BchQuorumClient;

    const mockEvmPort: EvmChainPort = {
      async getTip() {
        return { height: 1000000, finalized: true };
      },
      async getLock() {
        return { status: 'locked' as const };
      },
      async isFinal() {
        return true;
      },
      async broadcast(txHex: string) {
        return txHex;
      },
      async isOnChain() {
        return true;
      },
    };

    const mockEvmAdapter = {
      id: 'base',
      address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as `0x${string}`,
      getTip: async () => ({
        height: 1234567,
        ageSeconds: 5,
        stale: false,
      }),
      getLock: async () => ({ status: 'absent' as const }),
      isFinal: async () => true,
      relayLock: async () => ({
        chain: 'base' as const,
        txId: ('0x' + 'aa'.repeat(32)) as `0x${string}`,
      }),
      claim: async () => ({
        chain: 'base' as const,
        txId: ('0x' + 'bb'.repeat(32)) as `0x${string}`,
      }),
      refund: async () => ({
        chain: 'base' as const,
        txId: ('0x' + 'cc'.repeat(32)) as `0x${string}`,
      }),
    } as unknown as EvmChainAdapter;

    it('1. Forward happy path: quote -> relay-lock -> secret -> relay-claim -> done', async () => {
      const db = new SolverDatabase(':memory:');
      const engine = new SolverEngine(db, mockBchPort, mockEvmPort, config);

      const app = buildServer({
        config,
        db,
        evmAdapter: mockEvmAdapter,
        bchClient: bchClient,
        engine,
        priceSource: mockPriceSource,
      });

      // 1. Request Quote
      const quoteRes = await app.inject({
        method: 'POST',
        url: '/v1/quotes',
        payload: {
          direction: 'EVM_TO_BCH',
          bchToken: 'PUSD',
          amountIn: '10000000',
          userEvmAddress: '0x87Ea46fe296C1810eF234A8e8D782A2122deFaDd',
          userBchLockingBytecode:
            '0x76a914111111111111111111111111111111111111111188ac',
          hashLock,
          lane: 'safe',
        },
      });
      expect(quoteRes.statusCode).toBe(200);
      const { orderId } = quoteRes.json();
      expect(orderId).toBeDefined();

      // 2. User Relay Lock
      const relayLockRes = await app.inject({
        method: 'POST',
        url: `/v1/orders/${orderId}/relay-lock`,
        payload: {
          payload: { test: true },
        },
      });
      expect(relayLockRes.statusCode).toBe(200);
      expect(relayLockRes.json().relayed).toBe(true);

      // 3. User Secret Reveal
      const secretRes = await app.inject({
        method: 'POST',
        url: `/v1/orders/${orderId}/secret`,
        payload: { secret },
      });
      expect(secretRes.statusCode).toBe(200);
      expect(secretRes.json().accepted).toBe(true);

      // 4. Relay Claim
      const relayClaimRes = await app.inject({
        method: 'POST',
        url: `/v1/orders/${orderId}/relay-claim`,
        payload: {
          secret,
        },
      });
      expect(relayClaimRes.statusCode).toBe(200);
      expect(relayClaimRes.json().relayed).toBe(true);

      // 5. Final order status verification
      const orderRes = await app.inject({
        method: 'GET',
        url: `/v1/orders/${orderId}`,
      });
      expect(orderRes.statusCode).toBe(200);
      const orderData = orderRes.json();
      expect(orderData.status).toBe('SOLVER_CLAIM_BROADCAST');
      expect(orderData.txIds.solverClaimTxId).toBeDefined();
      db.close();
    });

    it('2. Reverse happy path: quote -> secret reveal -> relay-claim', async () => {
      const db = new SolverDatabase(':memory:');
      const engine = new SolverEngine(db, mockBchPort, mockEvmPort, config);

      const app = buildServer({
        config,
        db,
        evmAdapter: mockEvmAdapter,
        bchClient: bchClient,
        engine,
        priceSource: mockPriceSource,
      });

      const quoteRes = await app.inject({
        method: 'POST',
        url: '/v1/quotes',
        payload: {
          direction: 'BCH_TO_EVM',
          bchToken: 'PUSD',
          amountIn: '1000', // 10.00 PUSD
          userEvmAddress: '0x87Ea46fe296C1810eF234A8e8D782A2122deFaDd',
          userBchLockingBytecode:
            '0x76a914111111111111111111111111111111111111111188ac',
          hashLock,
          lane: 'safe',
        },
      });
      expect(quoteRes.statusCode).toBe(200);
      const { orderId } = quoteRes.json();

      // Secret reveal
      const secretRes = await app.inject({
        method: 'POST',
        url: `/v1/orders/${orderId}/secret`,
        payload: { secret },
      });
      expect(secretRes.statusCode).toBe(200);

      const orderRes = await app.inject({
        method: 'GET',
        url: `/v1/orders/${orderId}`,
      });
      expect(orderRes.statusCode).toBe(200);
      expect(orderRes.json().status).toBe('SECRET_KNOWN');
      db.close();
    });

    it('3. Refund drill: expired lock triggers refund transition', async () => {
      const db = new SolverDatabase(':memory:');
      const engine = new SolverEngine(db, mockBchPort, mockEvmPort, config);

      const app = buildServer({
        config,
        db,
        evmAdapter: mockEvmAdapter,
        bchClient: bchClient,
        engine,
        priceSource: mockPriceSource,
      });

      // Create quote
      const quoteRes = await app.inject({
        method: 'POST',
        url: '/v1/quotes',
        payload: {
          direction: 'EVM_TO_BCH',
          bchToken: 'PUSD',
          amountIn: '10000000',
          userEvmAddress: '0x87Ea46fe296C1810eF234A8e8D782A2122deFaDd',
          userBchLockingBytecode:
            '0x76a914111111111111111111111111111111111111111188ac',
          hashLock,
          lane: 'safe',
        },
      });
      const { orderId } = quoteRes.json();

      // Simulate solver lock seen on counter chain
      db.saveOrder({
        ...db.getOrder(orderId)!,
        status: 'SOLVER_LOCK_SEEN',
        solverLockTxId: '0x' + 'bb'.repeat(32),
      });

      // Simulate refund transition on counter deadline passed
      const order = db.getOrder(orderId)!;
      const solverOrder = orderRecordToSolverOrder(order);
      const refunded = transition(solverOrder, {
        type: 'COUNTER_DEADLINE_PASSED',
        refundTxId: '0x' + '33'.repeat(32),
      });
      expect(refunded.nextStatus).toBe('SOLVER_REFUNDED');
      db.saveOrder({
        ...order,
        status: refunded.nextStatus,
        solverRefundTxId: refunded.mutations?.solverRefundTxId,
      });
      const updated = db.getOrder(orderId);
      expect(updated?.status).toBe('SOLVER_REFUNDED');
      db.close();
    });

    it('4. Stale price refusal: quote rejected with 422 PRICE_UNAVAILABLE', async () => {
      const db = new SolverDatabase(':memory:');
      const stalePriceSource = new MockPriceSource(
        new Map([
          [
            'usdc',
            {
              usdPrice: 1_000_000n,
              source: 'reference',
              asOf: now - 3600, // 1 hour stale
            },
          ],
          [
            'pusd',
            {
              usdPrice: 1_000_000n,
              source: 'reference',
              asOf: now,
            },
          ],
        ]),
      );

      const app = buildServer({
        config,
        db,
        evmAdapter: mockEvmAdapter,
        bchClient: bchClient,
        engine: new SolverEngine(db, mockBchPort, mockEvmPort, config),
        priceSource: stalePriceSource,
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
            '0x76a914111111111111111111111111111111111111111188ac',
          hashLock,
          lane: 'safe',
        },
      });

      expect(res.statusCode).toBe(422);
      const body = res.json();
      expect(body.reason).toBe('PRICE_UNAVAILABLE');
      db.close();
    });
  },
);
