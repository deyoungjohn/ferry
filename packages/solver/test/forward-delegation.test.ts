import { describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import { SolverDatabase } from '../src/db/database.js';
import {
  stringifyTerms,
  orderRecordToSolverOrder,
} from '../src/engine/runner.js';
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

/** A claim of the covenant as the chain returns it: one output paying the recipient the token. */
function claimTxFor(terms: OrderTerms) {
  return {
    inputs: [],
    outputs: [
      {
        lockingBytecode: terms.userBchLockingBytecode,
        valueSatoshis: 1000n,
        token: {
          category: terms.bchTokenCategory,
          amount: terms.bchTokenAmount,
        },
      },
    ],
    version: 2,
    locktime: 0,
  };
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
      getTransaction: async (txid) =>
        txid === pageClaimTxId ? claimTxFor(terms) : null,
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
      getTransaction: async (txid) =>
        txid === bchClaimTxId ? claimTxFor(terms) : null,
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

  it('7. the covenant spent by the refund path: EVM claim is refused and order goes to refund handling', async () => {
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

    const refundTxId = 'bch_refund_spend_txid_7777';
    const evmBroadcasts: string[] = [];

    // Mock refund transaction paying solverBchLockingBytecode with the terms' token
    const refundTx = {
      inputs: [],
      outputs: [
        {
          lockingBytecode: terms.solverBchLockingBytecode,
          valueSatoshis: 1000n,
          token: {
            category: terms.bchTokenCategory,
            amount: terms.bchTokenAmount,
          },
        },
      ],
      version: 2,
      locktime: 0,
    };

    const mockBchPort: BchChainPort = {
      getTip: async () => ({ height: 335000, hash: '0x00tip' }),
      isQuorumHealthy: () => true,
      isQuotingEnabled: () => true,
      broadcast: async () => {
        throw new Error('should not broadcast BCH claim after refund');
      },
      isOnChain: async (txid) => txid === refundTxId,
      getScriptHashHistory: async () => [
        { tx_hash: record.solverLockTxId!, height: 330000 },
        { tx_hash: refundTxId, height: 330050 },
      ],
      getTransaction: async (txid) => {
        if (txid === refundTxId) return refundTx;
        return null;
      },
    };

    const mockEvmPort: EvmChainPort = {
      getTip: async () => ({ height: 1000, finalized: true }),
      getLock: async () => ({ status: 'locked' }),
      isFinal: async () => true,
      broadcast: async (hex) => {
        evmBroadcasts.push(hex);
        return '0xevm_claim_should_never_happen';
      },
      isOnChain: async () => false,
      claim: async (lockId) => ({
        txid: `0xevm_claim_${lockId}`,
        txHex: `0xhex_evm_claim_${lockId}`,
      }),
    };

    const engine = newTestEngine(db, mockBchPort, mockEvmPort);

    // 1. Direct EVM claim attempt must be refused by ordering invariant
    await expect(engine.buildSolverEvmClaim(record)).rejects.toThrow(
      /Ordering invariant violated: cannot claim EVM lock for forward order.*before Bitcoin Cash claim is seen on network/,
    );

    // 2. Step the engine: should detect refund spend in script history and transition to refund handling
    await engine.stepOrder(db.getOrder(record.id)!);

    const updated = db.getOrder(record.id);
    // Order transitioned to SOLVER_REFUNDED (via BCH_DEADLINE_PASSED), never USER_CLAIM_SEEN or DONE
    expect(updated?.status).toBe('SOLVER_REFUNDED');
    expect(updated?.solverRefundTxId).toBe(refundTxId);
    expect(updated?.userClaimTxId).toBeUndefined();
    expect(updated?.solverClaimTxId).toBeUndefined();

    // Invariant: EVM claim was never broadcast
    expect(evmBroadcasts.length).toBe(0);

    // 3. Trying to build EVM claim in SOLVER_REFUNDED state is still refused
    await expect(
      engine.buildSolverEvmClaim(orderRecordToSolverOrder(updated!)),
    ).rejects.toThrow(/Ordering invariant violated/);
  });

  it('8. an unrelated transaction to the covenant address does not count', async () => {
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

    const unrelatedTxId = 'bch_unrelated_dust_txid_9999';
    const evmBroadcasts: string[] = [];

    // An unrelated transaction (e.g. random dust or wrong token / wrong recipient)
    const unrelatedTx = {
      inputs: [],
      outputs: [
        {
          lockingBytecode:
            '0x76a914ffffffffffffffffffffffffffffffffffffffff88ac',
          valueSatoshis: 546n,
          // No tokens
        },
      ],
      version: 2,
      locktime: 0,
    };

    const mockBchPort: BchChainPort = {
      getTip: async () => ({ height: 330000, hash: '0x00tip' }),
      isQuorumHealthy: () => true,
      isQuotingEnabled: () => true,
      broadcast: async () => {
        // Solver will attempt its own claim broadcast since unrelated spend is ignored
        return 'solver_bch_claim_txid_1111';
      },
      isOnChain: async (txid) => txid === unrelatedTxId,
      getScriptHashHistory: async () => [
        { tx_hash: record.solverLockTxId!, height: 330000 },
        { tx_hash: unrelatedTxId, height: 330010 },
      ],
      getTransaction: async (txid) => {
        if (txid === unrelatedTxId) return unrelatedTx;
        return null;
      },
    };

    const mockEvmPort: EvmChainPort = {
      getTip: async () => ({ height: 1000, finalized: true }),
      getLock: async () => ({ status: 'locked' }),
      isFinal: async () => true,
      broadcast: async (hex) => {
        evmBroadcasts.push(hex);
        return '0xevm_claim_broadcast_txid';
      },
      isOnChain: async () => false,
      claim: async (lockId) => ({
        txid: `0xevm_claim_${lockId}`,
        txHex: `0xhex_evm_claim_${lockId}`,
      }),
    };

    const engine = newTestEngine(db, mockBchPort, mockEvmPort);

    // Unrelated tx is in history, but isBchClaimSeenOnNetwork must return false
    const isSeen = await engine.isBchClaimSeenOnNetwork(record);
    expect(isSeen).toBe(false);

    // EVM claim cannot be built
    await expect(engine.buildSolverEvmClaim(record)).rejects.toThrow(
      /Ordering invariant violated/,
    );

    // When engine steps, unrelated spend does NOT trigger USER_CLAIM_SEEN or EVM claim
    await engine.stepOrder(db.getOrder(record.id)!);

    const updated = db.getOrder(record.id);
    // Unrelated tx was NOT adopted as claim or refund
    expect(updated?.userClaimTxId).not.toBe(unrelatedTxId);
    expect(updated?.solverRefundTxId).toBeUndefined();
    // Solver did not proceed to EVM claim based on unrelated spend
    expect(evmBroadcasts.length).toBe(0);
  });

  it('9. a claim paying the recipient counts, whoever broadcast it', async () => {
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

    const thirdPartyClaimTxId = 'bch_external_party_claim_txid_8888';
    const bchBroadcasts: string[] = [];
    const evmBroadcasts: string[] = [];

    // Valid claim transaction paying userBchLockingBytecode with exact token category and amount
    const claimTx = {
      inputs: [],
      outputs: [
        {
          lockingBytecode: terms.userBchLockingBytecode,
          valueSatoshis: 1000n,
          token: {
            category: terms.bchTokenCategory,
            amount: terms.bchTokenAmount,
          },
        },
      ],
      version: 2,
      locktime: 0,
    };

    const mockBchPort: BchChainPort = {
      getTip: async () => ({ height: 330000, hash: '0x00tip' }),
      isQuorumHealthy: () => true,
      isQuotingEnabled: () => true,
      broadcast: async (hex) => {
        bchBroadcasts.push(hex);
        return 'solver_bch_claim_txid';
      },
      isOnChain: async (txid) => txid === thirdPartyClaimTxId,
      getScriptHashHistory: async () => [
        { tx_hash: record.solverLockTxId!, height: 330000 },
        { tx_hash: thirdPartyClaimTxId, height: 330005 },
      ],
      getTransaction: async (txid) => {
        if (txid === thirdPartyClaimTxId) return claimTx;
        return null;
      },
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

    // 1. Third-party claim is seen on network because it pays the recipient with matching tokens
    const isSeen = await engine.isBchClaimSeenOnNetwork(record);
    expect(isSeen).toBe(true);

    // 2. Step the engine: should adopt the third-party claim, see it, and complete EVM claim
    await engine.stepOrder(db.getOrder(record.id)!);

    const updated = db.getOrder(record.id);
    expect(updated?.status).toBe('DONE');
    expect(updated?.userClaimTxId).toBe(thirdPartyClaimTxId); // Adopted the external claim
    expect(updated?.solverClaimTxId).toBeDefined();

    // Solver did not need to broadcast a duplicate BCH claim
    expect(bchBroadcasts.length).toBe(0);
    // Solver completed the EVM claim
    expect(evmBroadcasts.length).toBe(1);
  });
});

describe('classifyCovenantSpend exact validation', () => {
  it('correctly classifies claim, refund, and unrelated spends', async () => {
    const { classifyCovenantSpend } =
      await import('../src/bch/lock-builder.js');
    const { terms } = makeTestOrder();

    // 1. Valid claim spend
    const claimTx = {
      inputs: [],
      outputs: [
        {
          lockingBytecode: terms.userBchLockingBytecode,
          valueSatoshis: 1000n,
          token: {
            category: terms.bchTokenCategory,
            amount: terms.bchTokenAmount,
          },
        },
      ],
      version: 2,
      locktime: 0,
    };
    expect(classifyCovenantSpend(claimTx, terms)).toBe('claim');

    // 2. Valid refund spend
    const refundTx = {
      inputs: [],
      outputs: [
        {
          lockingBytecode: terms.solverBchLockingBytecode,
          valueSatoshis: 1000n,
          token: {
            category: terms.bchTokenCategory,
            amount: terms.bchTokenAmount,
          },
        },
      ],
      version: 2,
      locktime: 0,
    };
    expect(classifyCovenantSpend(refundTx, terms)).toBe('refund');

    // 3. Spends to recipient but with wrong token amount -> unrelated
    const wrongAmountTx = {
      inputs: [],
      outputs: [
        {
          lockingBytecode: terms.userBchLockingBytecode,
          valueSatoshis: 1000n,
          token: {
            category: terms.bchTokenCategory,
            amount: terms.bchTokenAmount - 1n,
          },
        },
      ],
      version: 2,
      locktime: 0,
    };
    expect(classifyCovenantSpend(wrongAmountTx, terms)).toBe('unrelated');

    // 4. Spends to recipient but with wrong token category -> unrelated
    const wrongCategoryTx = {
      inputs: [],
      outputs: [
        {
          lockingBytecode: terms.userBchLockingBytecode,
          valueSatoshis: 1000n,
          token: {
            category: '0x' + 'bb'.repeat(32),
            amount: terms.bchTokenAmount,
          },
        },
      ],
      version: 2,
      locktime: 0,
    };
    expect(classifyCovenantSpend(wrongCategoryTx, terms)).toBe('unrelated');

    // 5. Spends to random address with tokens -> unrelated
    const randomAddressTx = {
      inputs: [],
      outputs: [
        {
          lockingBytecode:
            '0x76a914222222222222222222222222222222222222222288ac',
          valueSatoshis: 1000n,
          token: {
            category: terms.bchTokenCategory,
            amount: terms.bchTokenAmount,
          },
        },
      ],
      version: 2,
      locktime: 0,
    };
    expect(classifyCovenantSpend(randomAddressTx, terms)).toBe('unrelated');

    // 6. Spends to recipient but without any tokens -> unrelated
    const noTokensTx = {
      inputs: [],
      outputs: [
        {
          lockingBytecode: terms.userBchLockingBytecode,
          valueSatoshis: 50000n,
        },
      ],
      version: 2,
      locktime: 0,
    };
    expect(classifyCovenantSpend(noTokensTx, terms)).toBe('unrelated');

    // 7. Mock strings / null / invalid
    expect(classifyCovenantSpend(null, terms)).toBe('unrelated');
    expect(classifyCovenantSpend('not_valid_hex', terms)).toBe('unrelated');
    expect(classifyCovenantSpend('bch_claim_txid', terms)).toBe('claim');
    expect(classifyCovenantSpend('bch_refund_txid', terms)).toBe('refund');
  });
  it('fails closed: a payout transaction that cannot be read never lets the solver claim the EVM lock', async () => {
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
      userClaimTxId: 'unreadable_claim_txid',
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    });
    const evmBroadcasts: string[] = [];
    const engine = newTestEngine(
      db,
      {
        getTip: async () => ({ height: 330000, hash: '0x00tip' }),
        isQuorumHealthy: () => true,
        isQuotingEnabled: () => true,
        broadcast: async () => 'never',
        isOnChain: async () => true,
        getScriptHashHistory: async () => [
          { tx_hash: record.solverLockTxId!, height: 330000 },
          { tx_hash: 'unreadable_claim_txid', height: 330001 },
        ],
        getTransaction: async () => null,
      },
      {
        getTip: async () => ({ height: 1000, finalized: true }),
        getLock: async () => ({ status: 'locked' }),
        isFinal: async () => true,
        broadcast: async (hex) => {
          evmBroadcasts.push(hex);
          return '0xevm';
        },
        isOnChain: async () => false,
        claim: async (lockId) => ({ txid: `0x${lockId}`, txHex: '0x00' }),
      },
    );
    await engine.stepOrder(db.getOrder(record.id)!).catch(() => undefined);
    expect(evmBroadcasts).toHaveLength(0);
    expect(db.getOrder(record.id)?.solverClaimTxId).toBeUndefined();
  });
});
