import type { OrderTerms } from '@ferry/core';
import type { SolverOrderRecord } from '../state-machine/types.js';

export interface BchChainPort {
  getTip(): Promise<{ height: number; hash: string }>;
  isQuorumHealthy(): boolean;
  isQuotingEnabled(): boolean;
  broadcast(txHex: string): Promise<string>;
  isOnChain(txid: string): Promise<boolean>;
  getScriptHashHistory(
    scriptHash: string,
  ): Promise<Array<{ tx_hash: string; height: number }>>;
  subscribeScriptHash?(
    scriptHash: string,
    callback: (status: string | null) => void,
  ): () => void;
  waitForDoubleSpendProof?(
    txid: string,
    waitWindowMs?: number,
  ): Promise<{ hasProof: boolean; proof?: unknown }>;
  extractSecretFromSpend?(
    txid: string,
    hashLock?: string,
  ): Promise<`0x${string}` | null>;
  listUnspent?(
    scriptHash: string,
    filter?: string,
  ): Promise<
    Array<{
      tx_hash: string;
      tx_pos: number;
      value: number;
      height: number;
      token_data?: {
        category: string;
        amount: string;
        nft?: unknown;
      };
    }>
  >;
  buildLock?(
    order: SolverOrderRecord,
  ): Promise<{ txid: string; txHex: string }>;
  buildClaim?(
    order: SolverOrderRecord,
  ): Promise<{ txid: string; txHex: string }>;
}

export interface EvmLockState {
  status: 'none' | 'locked' | 'claimed' | 'refunded';
  txid?: string | undefined;
  secret?: `0x${string}` | undefined;
}

export interface EvmChainPort {
  getTip(): Promise<{ height: number; finalized: boolean }>;
  getLock(lockId: string): Promise<EvmLockState>;
  isFinal(txid: string, lane: 'safe' | 'fast'): Promise<boolean>;
  broadcast(txHex: string): Promise<string>;
  isOnChain(txid: string): Promise<boolean>;
  subscribeLockEvents?(
    callback: (event: {
      type: 'Locked' | 'Claimed' | 'Refunded';
      lockId: string;
      txid: string;
      secret?: `0x${string}` | undefined;
    }) => void,
  ): () => void;
  extractSecretFromClaim?(txid: string): Promise<`0x${string}` | null>;
  lock?(terms: OrderTerms): Promise<{ txid: string; txHex: string }>;
  claim?(
    lockId: string,
    secret: `0x${string}`,
  ): Promise<{ txid: string; txHex: string }>;
}

export interface EngineConfig {
  /**
   * False while the engine's on-chain actions are placeholders: it then quotes nothing and moves
   * no order, so nobody can lock funds the solver cannot yet complete. Defaults to true so the
   * local test harness, which supplies its own executors, is unchanged.
   */
  executionReady?: boolean | undefined;
  dsproofWindowMs?: number | undefined; // default 5000 ms
  pollIntervalMs?: number | undefined;
  solverBchWif?: string | undefined;
  bchNetwork?: 'mainnet' | 'chipnet' | undefined;
}
