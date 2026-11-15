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
  extractSecretFromSpend?(txid: string): Promise<`0x${string}` | null>;
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
}

export interface EngineConfig {
  dsproofWindowMs?: number | undefined; // default 5000 ms
  pollIntervalMs?: number | undefined;
}
