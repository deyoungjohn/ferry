import { describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import { SolverDatabase } from '../src/db/database.js';
import { stringifyTerms } from '../src/engine/runner.js';
import { SolverConfigSchema } from '../src/config.js';
import { buildServer } from '../src/api/server.js';
import { SolverClient } from '@ferry/solver-client';
import { newTestEngine } from './support/test-engine.js';
import type { BchChainPort, EvmChainPort } from '../src/engine/types.js';
import type { SolverOrderRecord } from '../src/state-machine/types.js';
import { parseOrderTerms, type Hex32, type OrderTerms } from '@ferry/core';

function sha256Hex(hexWithoutPrefix: string): `0x${string}` {
  return `0x${crypto.createHash('sha256').update(Buffer.from(hexWithoutPrefix, 'hex')).digest('hex')}` as `0x${string}`;
}

const defaultSecret =
  '0x112233445566778899001122334455667788990011223344556677889900aabb' as const;
const defaultHashLock = sha256Hex(defaultSecret.slice(2));

function makeTestOrder(overrides: Partial<SolverOrderRecord> = {}): {
  terms: OrderTerms;
  record: SolverOrderRecord;
} {
  const hashLock = overrides.hashLock ?? defaultHashLock;
  const now = Math.floor(Date.now() / 1000);

  const terms = parseOrderTerms({
    version: 1,
    direction: 'EVM_TO_BCH',
    bchToken: 'PUSD',
    bchTokenCategory: `0x${'aa'.repeat(32)}`,
    bchTokenAmount: 1000n,
    evmAmount: 1000000n,
    evmToken: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    evmChainId: 8453,
    evmHtlc: '0x5A0C062f4B7b8fF2263530e12bc15De9C836a641',
    userEvmAddress: '0x87Ea46fe296C1810eF234A8e8D782A2122deFaDd',
    userBchLockingBytecode:
      '0x76a914000000000000000000000000000000000000000088ac',
    solverEvmAddress: '0xC9ec91859Bdb598dC2eeE715934D8231478f7A70',
    solverBchLockingBytecode:
      '0x76a914111111111111111111111111111111111111111188ac',
    hashLock,
    evmDeadline: now + 86400,
    bchRefundHeight: 330036,
    bchCarrySats: 3000n,
    bchMaxFee: 1500n,
    quoteId: 'test-quote-fwd',
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

  const record: SolverOrderRecord = {
    id: 'fwd-test-order-001',
    direction: 'EVM_TO_BCH',
    status: 'SOLVER_LOCK_SEEN',
    lane: 'safe',
    fastOptIn: false,
    terms,
    hashLock,
    solverLockTxId: 'solver_bch_lock_txid_1234',
    userLockTxId: '0xuser_evm_lock_txid_1234',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };

  return { terms, record };
}

describe('Forward swap finish-for-me delegation & ordering invariant', () => {
  it('1. handoff then the payee is paid on BCH and EVM lock is claimed after', async () => {
    const db = new SolverDatabase(':memory:');
    const { terms, record } = makeTestOrder({ secret: defaultSecret });

    db.saveOrder({
      id: record.id,
      direction: 'EVM_TO_BCH',
      status: 'SOLVER_LOCK_SEEN',
      userCounterAddress: terms.userEvmAddress!,
      lockId: terms.hashLock,
      termsJson: stringifyTerms(terms),
      hashLock: terms.hashLock,
      secret: defaultSecret,
      secretSource: 'cooperative',
      solverLockTxId: record.solverLockTxId,
      userLockTxId: record.userLockTxId,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    });

    const bchBroadcasts: string[] = [];
    const evmBroadcasts: string[] = [];

    const mockBchPort: BchChainPort = {
      getTip: async () => ({ height: 330000, hash: '0x00tip' }),
      isQuorumHealthy: () => true,
      isQuotingEnabled: () => true,
      broadcast: async (hex) => {
        bchBroadcasts.push(hex);
        return 'bch_claim_broadcast_txid';
      },
      isOnChain: async () => bchBroadcasts.length > 0,
      getScriptHashHistory: async () => [],
      buildClaim: async (order) => ({
        txid: `bch_claim_built_${order.id}`,
        txHex: `hex_bch_claim_${order.id}`,
      }),
    };

    const mockEvmPort: EvmChainPort = {
      getTip: async () => ({ height: 1000, finalized: true }),
      getLock: async () => ({ status: 'locked' }),
      isFinal: async () => true,
      broadcast: async (hex) => {
        evmBroadcasts.push(hex);
        return '0xevm_claim_broadcast_txid';
      },
      isOnChain: async () => evmBroadcasts.length > 0,
      claim: async (lockId) => ({
        txid: `0xevm_claim_${lockId}`,
        txHex: `0xhex_evm_claim_${lockId}`,
      }),
    };

    const engine = newTestEngine(db, mockBchPort, mockEvmPort);

    // Initial step from SOLVER_LOCK_SEEN with secret:
    // broadcasts BCH claim, sees on network, transitions to USER_CLAIM_SEEN, then claims EVM
    await engine.stepOrder(db.getOrder(record.id)!);

    const updated = db.getOrder(record.id);
    expect(updated?.userClaimTxId).toBeDefined();
    expect(updated?.solverClaimTxId).toBeDefined();
    expect(updated?.status).toBe('DONE');

    // Verify ordering: BCH payout broadcast occurred BEFORE EVM claim
    expect(bchBroadcasts.length).toBe(1);
    expect(evmBroadcasts.length).toBe(1);
  });

  it('2. the solver strictly never claims EVM before its Bitcoin Cash claim is seen (a test that tries)', async () => {
    const db = new SolverDatabase(':memory:');
    const { terms, record } = makeTestOrder({ secret: defaultSecret });

    db.saveOrder({
      id: record.id,
      direction: 'EVM_TO_BCH',
      status: 'SECRET_KNOWN',
      userCounterAddress: terms.userEvmAddress!,
      lockId: terms.hashLock,
      termsJson: stringifyTerms(terms),
      hashLock: terms.hashLock,
      secret: defaultSecret,
      secretSource: 'cooperative',
      solverLockTxId: record.solverLockTxId,
      userLockTxId: record.userLockTxId,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    });

    // BCH port where the claim transaction is NOT seen on chain
    const mockBchPort: BchChainPort = {
      getTip: async () => ({ height: 330000, hash: '0x00tip' }),
      isQuorumHealthy: () => true,
      isQuotingEnabled: () => true,
      broadcast: async () => 'bch_claim_pending_unseen',
      isOnChain: async () => false, // NEVER SEEN ON NETWORK
      getScriptHashHistory: async () => [],
      buildClaim: async (order) => ({
        txid: `bch_claim_built_${order.id}`,
        txHex: `hex_bch_claim_${order.id}`,
      }),
    };

    const evmBroadcasts: string[] = [];
    const mockEvmPort: EvmChainPort = {
      getTip: async () => ({ height: 1000, finalized: true }),
      getLock: async () => ({ status: 'locked' }),
      isFinal: async () => true,
      broadcast: async (hex) => {
        evmBroadcasts.push(hex);
        return '0xevm_claim_txid';
      },
      isOnChain: async () => true,
      claim: async (lockId) => ({
        txid: `0xevm_claim_${lockId}`,
        txHex: `0xhex_evm_claim_${lockId}`,
      }),
    };

    const engine = newTestEngine(db, mockBchPort, mockEvmPort);

    // Test trying to directly invoke buildSolverEvmClaim before BCH claim is seen on network
    const solverOrder = record;
    await expect(engine.buildSolverEvmClaim(solverOrder)).rejects.toThrow(
      /Ordering invariant violated: cannot claim EVM lock for forward order.*before Bitcoin Cash claim is seen on network/,
    );

    // Run engine step: should broadcast BCH claim, but because it's not seen on chain, EVM claim must NOT be broadcast
    await engine.stepOrder(db.getOrder(record.id)!);

    const postStep = db.getOrder(record.id);
    expect(postStep?.status).toBe('SECRET_KNOWN');
    expect(postStep?.solverClaimTxId).toBeUndefined();
    expect(evmBroadcasts.length).toBe(0);
  });

  it('3. a wrong secret is refused', async () => {
    const db = new SolverDatabase(':memory:');
    const { terms, record } = makeTestOrder();

    db.saveOrder({
      id: record.id,
      direction: 'EVM_TO_BCH',
      status: 'SOLVER_LOCK_SEEN',
      userCounterAddress: terms.userEvmAddress!,
      lockId: terms.hashLock,
      termsJson: stringifyTerms(terms),
      hashLock: terms.hashLock,
      solverLockTxId: record.solverLockTxId,
      userLockTxId: record.userLockTxId,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    });

    const mockBchPort: BchChainPort = {
      getTip: async () => ({ height: 330000, hash: '0x00tip' }),
      isQuorumHealthy: () => true,
      isQuotingEnabled: () => true,
      broadcast: async () => 'bch_txid',
      isOnChain: async () => true,
      getScriptHashHistory: async () => [],
    };

    const mockEvmPort: EvmChainPort = {
      getTip: async () => ({ height: 1000, finalized: true }),
      getLock: async () => ({ status: 'locked' }),
      isFinal: async () => true,
      broadcast: async () => '0xevm_txid',
      isOnChain: async () => true,
    };

    const config = SolverConfigSchema.parse({
      solverEvmPrivateKey:
        '0x1111111111111111111111111111111111111111111111111111111111111111',
    });

    const engine = newTestEngine(db, mockBchPort, mockEvmPort);
    const app = buildServer({
      config,
      db,
      evmAdapter: {} as never,
      bchClient: {} as never,
      engine,
      priceSource: {
        getUsdPrice: () => ({
          priceUsd: '1.00',
          asOf: Math.floor(Date.now() / 1000),
          source: 'cauldron',
        }),
      } as never,
    });

    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    const client = new SolverClient({ baseUrl: address });

    const wrongSecret = ('0x' + '99'.repeat(32)) as Hex32;
    await expect(
      client.revealSecret(record.id as Hex32, wrongSecret),
    ).rejects.toThrow(/Secret preimage does not match hash lock/i);

    const untouched = db.getOrder(record.id);
    expect(untouched?.secret).toBeUndefined();
    expect(untouched?.status).toBe('SOLVER_LOCK_SEEN');

    await app.close();
  });

  it("4. the page's own claim and the solver's racing each other leave one payout and one EVM claim", async () => {
    const db = new SolverDatabase(':memory:');
    const { terms, record } = makeTestOrder({ secret: defaultSecret });

    db.saveOrder({
      id: record.id,
      direction: 'EVM_TO_BCH',
      status: 'SECRET_KNOWN',
      userCounterAddress: terms.userEvmAddress!,
      lockId: terms.hashLock,
      termsJson: stringifyTerms(terms),
      hashLock: terms.hashLock,
      secret: defaultSecret,
      secretSource: 'cooperative',
      solverLockTxId: record.solverLockTxId,
      userLockTxId: record.userLockTxId,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    });

    const pageClaimTxId = 'page_bch_claim_txid_9999';
    let bchBroadcastAttempts = 0;
    let scriptHistoryCalls = 0;
    const evmBroadcasts: string[] = [];

    const mockBchPort: BchChainPort = {
      getTip: async () => ({ height: 330000, hash: '0x00tip' }),
      isQuorumHealthy: () => true,
      isQuotingEnabled: () => true,
      broadcast: async () => {
        bchBroadcastAttempts++;
        // Simulate mempool conflict because page's claim just arrived
        throw new Error('txn-mempool-conflict: txn already in mempool');
      },
      isOnChain: async (txid) => txid === pageClaimTxId,
      // First call: page claim not yet seen in script history so solver attempts broadcast;
      // Second call after conflict: page claim is found in history.
      getScriptHashHistory: async () => {
        scriptHistoryCalls++;
        if (scriptHistoryCalls === 1) {
          return [{ tx_hash: record.solverLockTxId!, height: 330000 }];
        }
        return [
          { tx_hash: record.solverLockTxId!, height: 330000 },
          { tx_hash: pageClaimTxId, height: 330001 },
        ];
      },
      buildClaim: async (order) => ({
        txid: `bch_claim_built_${order.id}`,
        txHex: `hex_bch_claim_${order.id}`,
      }),
    };

    const mockEvmPort: EvmChainPort = {
      getTip: async () => ({ height: 1000, finalized: true }),
      getLock: async () => ({ status: 'locked' }),
      isFinal: async () => true,
      broadcast: async (hex) => {
        evmBroadcasts.push(hex);
        return '0xevm_claim_txid_race';
      },
      isOnChain: async () => evmBroadcasts.length > 0,
      claim: async (lockId) => ({
        txid: `0xevm_claim_${lockId}`,
        txHex: `0xhex_evm_claim_${lockId}`,
      }),
    };

    const engine = newTestEngine(db, mockBchPort, mockEvmPort);

    // Step order: Solver handles conflict, adopts page's claim, sees it on chain, transitions to USER_CLAIM_SEEN, claims EVM
    await engine.stepOrder(db.getOrder(record.id)!);

    const settled = db.getOrder(record.id);
    expect(settled?.userClaimTxId).toBe(pageClaimTxId); // Adopted the one BCH payout
    expect(settled?.solverClaimTxId).toMatch(/^0xevm_claim_/); // One EVM claim
    expect(settled?.status).toBe('DONE');
    expect(bchBroadcastAttempts).toBe(1);
    expect(evmBroadcasts.length).toBe(1);
  });

  it('5. restart between the steps resumes', async () => {
    const db = new SolverDatabase(':memory:');
    const { terms, record } = makeTestOrder({ secret: defaultSecret });

    const bchClaimTxId = 'bch_claim_before_crash_8888';

    // Simulate state right after solver broadcast BCH claim, before EVM claim, followed by a restart
    db.saveOrder({
      id: record.id,
      direction: 'EVM_TO_BCH',
      status: 'SECRET_KNOWN',
      userCounterAddress: terms.userEvmAddress!,
      lockId: terms.hashLock,
      termsJson: stringifyTerms(terms),
      hashLock: terms.hashLock,
      secret: defaultSecret,
      secretSource: 'cooperative',
      solverLockTxId: record.solverLockTxId,
      userLockTxId: record.userLockTxId,
      userClaimTxId: bchClaimTxId, // recorded before crash
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    });

    const bchBroadcasts: string[] = [];
    const evmBroadcasts: string[] = [];

    const mockBchPort: BchChainPort = {
      getTip: async () => ({ height: 330000, hash: '0x00tip' }),
      isQuorumHealthy: () => true,
      isQuotingEnabled: () => true,
      broadcast: async (hex) => {
        bchBroadcasts.push(hex);
        return 'new_tx';
      },
      isOnChain: async (txid) => txid === bchClaimTxId,
      getScriptHashHistory: async () => [],
    };

    const mockEvmPort: EvmChainPort = {
      getTip: async () => ({ height: 1000, finalized: true }),
      getLock: async () => ({ status: 'locked' }),
      isFinal: async () => true,
      broadcast: async (hex) => {
        evmBroadcasts.push(hex);
        return '0xevm_claim_resumed';
      },
      isOnChain: async () => evmBroadcasts.length > 0,
      claim: async (lockId) => ({
        txid: `0xevm_claim_${lockId}`,
        txHex: `0xhex_evm_claim_${lockId}`,
      }),
    };

    // New engine instance representing restart
    const engineAfterRestart = newTestEngine(db, mockBchPort, mockEvmPort);

    await engineAfterRestart.stepOrder(db.getOrder(record.id)!);

    const postRestart = db.getOrder(record.id);
    expect(postRestart?.status).toBe('DONE');
    expect(postRestart?.userClaimTxId).toBe(bchClaimTxId);
    expect(postRestart?.solverClaimTxId).toMatch(/^0xevm_claim_/);
    expect(bchBroadcasts.length).toBe(0); // Did not re-broadcast BCH claim unnecessarily
    expect(evmBroadcasts.length).toBe(1); // Completed EVM claim
  });

  it('6. without consent nothing is sent', async () => {
    const db = new SolverDatabase(':memory:');
    const { terms, record } = makeTestOrder();

    // Order locked by solver, but secret is NOT known (no consent given)
    db.saveOrder({
      id: record.id,
      direction: 'EVM_TO_BCH',
      status: 'SOLVER_LOCK_SEEN',
      userCounterAddress: terms.userEvmAddress!,
      lockId: terms.hashLock,
      termsJson: stringifyTerms(terms),
      hashLock: terms.hashLock,
      // No secret, no secretSource
      solverLockTxId: record.solverLockTxId,
      userLockTxId: record.userLockTxId,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    });

    const bchBroadcasts: string[] = [];
    const evmBroadcasts: string[] = [];

    const mockBchPort: BchChainPort = {
      getTip: async () => ({ height: 330000, hash: '0x00tip' }),
      isQuorumHealthy: () => true,
      isQuotingEnabled: () => true,
      broadcast: async (hex) => {
        bchBroadcasts.push(hex);
        return 'bch_tx';
      },
      isOnChain: async () => true,
      getScriptHashHistory: async () => [],
    };

    const mockEvmPort: EvmChainPort = {
      getTip: async () => ({ height: 1000, finalized: true }),
      getLock: async () => ({ status: 'locked' }),
      isFinal: async () => true,
      broadcast: async (hex) => {
        evmBroadcasts.push(hex);
        return 'evm_tx';
      },
      isOnChain: async () => true,
    };

    const engine = newTestEngine(db, mockBchPort, mockEvmPort);

    await engine.stepOrder(db.getOrder(record.id)!);

    const orderStillWaiting = db.getOrder(record.id);
    expect(orderStillWaiting?.status).toBe('SOLVER_LOCK_SEEN');
    expect(orderStillWaiting?.secret).toBeUndefined();
    expect(orderStillWaiting?.userClaimTxId).toBeUndefined();
    expect(orderStillWaiting?.solverClaimTxId).toBeUndefined();
    expect(bchBroadcasts.length).toBe(0);
    expect(evmBroadcasts.length).toBe(0);
  });
});
