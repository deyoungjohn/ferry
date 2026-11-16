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
import { SolverClient, SolverRefusalError } from '@ferry/solver-client';
import type { Hex32 } from '@ferry/core';

const RUN_E2E = process.env.FERRY_RUN_E2E === '1';

describe.skipIf(!RUN_E2E)(
  'Opt-in Local End-to-End Integration Suite using SolverClient (item 2 & 4)',
  () => {
    const config = loadConfigFromEnv({
      ALLOW_DEV_KEYS: '1',
      OPERATOR_TOKEN: 'a'.repeat(32),
    });

    const now = Math.floor(Date.now() / 1000);
    const secret = ('0x' + '33'.repeat(32)) as Hex32;
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
        txId: ('0x' + 'aa'.repeat(32)) as Hex32,
      }),
      claim: async () => ({
        chain: 'base' as const,
        txId: ('0x' + 'bb'.repeat(32)) as Hex32,
      }),
      refund: async () => ({
        chain: 'base' as const,
        txId: ('0x' + 'cc'.repeat(32)) as Hex32,
      }),
    } as unknown as EvmChainAdapter;

    it('1. Forward happy path through SolverClient: quote -> relay-lock -> secret -> relay-claim -> done', async () => {
      const db = new SolverDatabase(':memory:');
      const engine = new SolverEngine(db, mockBchPort, mockEvmPort, config);

      const app = buildServer({
        config,
        db,
        evmAdapter: mockEvmAdapter,
        bchClient,
        engine,
        priceSource: mockPriceSource,
      });

      const address = await app.listen({ port: 0, host: '127.0.0.1' });
      const client = new SolverClient({ baseUrl: address });

      // 1. Request Quote via SolverClient
      const quote = await client.quote({
        direction: 'EVM_TO_BCH',
        token: 'PUSD',
        chainId: 8453,
        evmToken: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
        amountIn: 10_000_000n,
        userEvmAddress: '0x87Ea46fe296C1810eF234A8e8D782A2122deFaDd',
        userBchLockingBytecode:
          '0x76a914111111111111111111111111111111111111111188ac',
        hashLock,
        lane: 'safe',
      });

      expect(quote.orderId).toBeDefined();
      const orderId = quote.orderId as Hex32;

      // 2. User Relay Lock via SolverClient
      const relayLockRes = await client.relayLock(orderId, {
        intent: {
          orderId,
          deadline: Math.floor(Date.now() / 1000) + 3600,
        },
        signature: '0x1234',
      });
      expect(relayLockRes.ok).toBe(true);
      expect(relayLockRes.txHash).toBeDefined();

      // 3. User Secret Reveal via SolverClient
      const secretRes = await client.revealSecret(orderId, secret);
      expect(secretRes.ok).toBe(true);

      // 4. Relay Claim via SolverClient
      const relayClaimRes = await client.relayClaim(orderId, {
        secret,
      });
      expect(relayClaimRes.ok).toBe(true);
      expect(relayClaimRes.txHash).toBeDefined();

      // 5. Order status verification via SolverClient
      const order = await client.getOrder(orderId);
      expect(order.state).toBe('SOLVER_CLAIM_BROADCAST');
      expect(order.txids.evmClaim).toBeDefined();

      await app.close();
      db.close();
    });

    it('2. Reverse happy path through SolverClient: quote -> secret reveal -> state verified', async () => {
      const db = new SolverDatabase(':memory:');
      const engine = new SolverEngine(db, mockBchPort, mockEvmPort, config);

      const app = buildServer({
        config,
        db,
        evmAdapter: mockEvmAdapter,
        bchClient,
        engine,
        priceSource: mockPriceSource,
      });

      const address = await app.listen({ port: 0, host: '127.0.0.1' });
      const client = new SolverClient({ baseUrl: address });

      const quote = await client.quote({
        direction: 'BCH_TO_EVM',
        token: 'PUSD',
        chainId: 8453,
        evmToken: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
        amountIn: 1_000n, // 10.00 PUSD
        userEvmAddress: '0x87Ea46fe296C1810eF234A8e8D782A2122deFaDd',
        userBchLockingBytecode:
          '0x76a914111111111111111111111111111111111111111188ac',
        hashLock,
        lane: 'safe',
      });

      expect(quote.orderId).toBeDefined();
      const orderId = quote.orderId as Hex32;

      // Secret reveal via SolverClient
      const secretRes = await client.revealSecret(orderId, secret);
      expect(secretRes.ok).toBe(true);

      const order = await client.getOrder(orderId);
      expect(order.state).toBe('SECRET_KNOWN');

      await app.close();
      db.close();
    });

    it('3. Refund drill: expired lock triggers refund transition', async () => {
      const db = new SolverDatabase(':memory:');
      const engine = new SolverEngine(db, mockBchPort, mockEvmPort, config);

      const app = buildServer({
        config,
        db,
        evmAdapter: mockEvmAdapter,
        bchClient,
        engine,
        priceSource: mockPriceSource,
      });

      const address = await app.listen({ port: 0, host: '127.0.0.1' });
      const client = new SolverClient({ baseUrl: address });

      const quote = await client.quote({
        direction: 'EVM_TO_BCH',
        token: 'PUSD',
        chainId: 8453,
        evmToken: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
        amountIn: 10_000_000n,
        userEvmAddress: '0x87Ea46fe296C1810eF234A8e8D782A2122deFaDd',
        userBchLockingBytecode:
          '0x76a914111111111111111111111111111111111111111188ac',
        hashLock,
        lane: 'safe',
      });
      const orderId = quote.orderId as Hex32;

      // Simulate solver lock seen on counter chain
      db.saveOrder({
        ...db.getOrder(orderId)!,
        status: 'SOLVER_LOCK_SEEN',
        solverLockTxId: '0x' + 'bb'.repeat(32),
      });

      // Simulate refund transition on counter deadline passed
      const orderRecord = db.getOrder(orderId)!;
      const solverOrder = orderRecordToSolverOrder(orderRecord);
      const refunded = transition(solverOrder, {
        type: 'COUNTER_DEADLINE_PASSED',
        refundTxId: '0x' + '33'.repeat(32),
      });
      expect(refunded.nextStatus).toBe('SOLVER_REFUNDED');
      db.saveOrder({
        ...orderRecord,
        status: refunded.nextStatus,
        solverRefundTxId: refunded.mutations?.solverRefundTxId,
      });

      const finalStatus = await client.getOrder(orderId);
      expect(finalStatus.state).toBe('SOLVER_REFUNDED');

      await app.close();
      db.close();
    });

    it('4. Stale price refusal: SolverClient throws SolverRefusalError with PRICE_UNAVAILABLE', async () => {
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
        bchClient,
        engine: new SolverEngine(db, mockBchPort, mockEvmPort, config),
        priceSource: stalePriceSource,
      });

      const address = await app.listen({ port: 0, host: '127.0.0.1' });
      const client = new SolverClient({ baseUrl: address });

      await expect(
        client.quote({
          direction: 'EVM_TO_BCH',
          token: 'PUSD',
          chainId: 8453,
          evmToken: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
          amountIn: 10_000_000n,
          userEvmAddress: '0x87Ea46fe296C1810eF234A8e8D782A2122deFaDd',
          userBchLockingBytecode:
            '0x76a914111111111111111111111111111111111111111188ac',
          hashLock,
          lane: 'safe',
        }),
      ).rejects.toThrow(SolverRefusalError);

      try {
        await client.quote({
          direction: 'EVM_TO_BCH',
          token: 'PUSD',
          chainId: 8453,
          evmToken: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
          amountIn: 10_000_000n,
          userEvmAddress: '0x87Ea46fe296C1810eF234A8e8D782A2122deFaDd',
          userBchLockingBytecode:
            '0x76a914111111111111111111111111111111111111111188ac',
          hashLock,
          lane: 'safe',
        });
      } catch (err) {
        expect(err).toBeInstanceOf(SolverRefusalError);
        expect((err as SolverRefusalError).refusal.reason).toBe(
          'PRICE_UNAVAILABLE',
        );
      }

      await app.close();
      db.close();
    });
  },
);
