import {
  SolverEngine,
  type ActionExecutor,
  type BchChainPort,
  type EngineConfig,
  type EvmChainPort,
  type SolverDatabase,
} from '../../src/index.js';

/**
 * A port set whose on-chain actions are test doubles: deterministic transaction ids and no keys.
 * The engine itself refuses to invent transactions (it throws when a port cannot build one), so
 * the state-machine tests, which have no real chains, supply them here, in the test directory only.
 */
export function withTestActions(
  bch: BchChainPort,
  evm: EvmChainPort,
): { bch: BchChainPort; evm: EvmChainPort } {
  return {
    bch: {
      buildLock: async (order) => ({
        txid: `bch_lock_${order.id}`,
        txHex: `hex_bch_lock_${order.id}`,
      }),
      buildClaim: async (order) => ({
        txid: `bch_claim_${order.id}`,
        txHex: `hex_bch_claim_${order.id}`,
      }),
      ...bch,
    },
    evm: {
      lock: async (terms) => ({
        txid: `evm_lock_${terms.hashLock}`,
        txHex: `hex_evm_lock_${terms.hashLock}`,
      }),
      claim: async (lockId) => ({
        txid: `evm_claim_${lockId}`,
        txHex: `hex_evm_claim_${lockId}`,
      }),
      ...evm,
    },
  };
}

export function newTestEngine(
  db: SolverDatabase,
  bch: BchChainPort,
  evm: EvmChainPort,
  config?: EngineConfig,
  bchExecutor?: ActionExecutor,
  evmExecutor?: ActionExecutor,
): SolverEngine {
  const ports = withTestActions(bch, evm);
  return new SolverEngine(
    db,
    ports.bch,
    ports.evm,
    config,
    bchExecutor,
    evmExecutor,
  );
}
