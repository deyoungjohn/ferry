import { describe, expect, it } from 'vitest';
import { SolverDatabase } from '../src/db/database.js';
import { stringifyTerms } from '../src/engine/runner.js';
import { newTestEngine } from './support/test-engine.js';
import type { BchChainPort, EvmChainPort } from '../src/engine/types.js';

describe('quoted orders are not read on chain every pass', () => {
  it('reads a quote with no lock at most once per 10 seconds', async () => {
    const db = new SolverDatabase(':memory:');
    const now = Math.floor(Date.now() / 1000);
    const terms = {
      version: 1,
      direction: 'EVM_TO_BCH',
      bchToken: 'PUSD',
      bchTokenCategory: '0x' + 'aa'.repeat(32),
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
      hashLock: '0x' + 'bb'.repeat(32),
      evmDeadline: now + 3600,
      bchRefundHeight: 330036,
      bchCarrySats: 3000n,
      bchMaxFee: 1500n,
      quoteId: 'q-throttle',
      quoteExpiry: now + 300,
    };
    db.saveOrder({
      id: 'quoted-1',
      direction: 'EVM_TO_BCH',
      status: 'QUOTED',
      userCounterAddress: terms.userEvmAddress,
      lockId: terms.hashLock,
      termsJson: stringifyTerms(terms as never),
      hashLock: terms.hashLock,
      createdAt: now,
      updatedAt: now,
    });
    let lockReads = 0;
    const bch: BchChainPort = {
      getTip: async () => ({ height: 330000, hash: '0x00' }),
      isQuorumHealthy: () => true,
      isQuotingEnabled: () => true,
      broadcast: async () => 'tx',
      isOnChain: async () => false,
      getScriptHashHistory: async () => [],
    };
    const evm: EvmChainPort = {
      getTip: async () => ({ height: 1000, finalized: true }),
      getLock: async () => {
        lockReads += 1;
        return { status: 'none' };
      },
      isFinal: async () => false,
      broadcast: async () => '0x',
      isOnChain: async () => false,
    };
    const engine = newTestEngine(db, bch, evm);
    await engine.reconcileOrders();
    await engine.reconcileOrders();
    await engine.reconcileOrders();
    expect(lockReads).toBe(1);
  });
});
