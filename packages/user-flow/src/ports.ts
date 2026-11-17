import type {
  Hex,
  Hex32,
  LockState,
  OrderTerms,
  UnsignedLock,
} from '@ferry/core';
import type { WizardConnectSignRequest } from '@ferry/htlc-bch';
import type { SolverClient } from '@ferry/solver-client';

/**
 * Everything a wallet or a network does goes through one of these ports, so the
 * session never imports a wallet library, a Node module or a socket. The web
 * page implements them with its wallet libraries; tests use in-memory fakes.
 */

/** The user's EVM wallet. */
export interface EvmSignerPort {
  getAddress(): Promise<Hex>;
  getChainId(): Promise<number>;
  /** EIP-712 signing: the permit and the lock intent. Returns the 65-byte signature. */
  signTypedData(typedData: unknown): Promise<Hex>;
  /** Used only by the approve-plus-lock path and by the user's own EVM refund. */
  sendTransaction(transaction: {
    readonly to: Hex;
    readonly data: Hex;
    readonly value?: bigint;
    readonly chainId: number;
  }): Promise<Hex32>;
}

/** Reads on the EVM chain. An `EvmChainAdapter` from the chain package satisfies the first two. */
export interface EvmChainPort {
  buildUserLock(terms: OrderTerms): Promise<UnsignedLock>;
  getLock(lockId: Hex32): Promise<LockState>;
  waitForReceipt(txHash: Hex32): Promise<void>;
  /** Timestamp of the latest block, in seconds. */
  getBlockTimestamp(): Promise<number>;
}

/** The user's Bitcoin Cash wallet (WizardConnect). It signs; it does not have to broadcast. */
export interface BchSignerPort {
  /** Returns the fully signed transaction as hex. */
  signTransaction(request: WizardConnectSignRequest): Promise<string>;
}

export interface BchUtxo {
  readonly txid: string;
  readonly vout: number;
  readonly satoshis: bigint;
  readonly token?: { readonly category: string; readonly amount: bigint };
}

/** Bitcoin Cash chain reads and broadcast (in a browser: public Fulcrum over `wss`). */
export interface BchChainPort {
  getTipHeight(): Promise<number>;
  /** Unspent outputs locked by this locking bytecode (hex, no `0x` needed). */
  getUtxos(lockingBytecodeHex: string): Promise<readonly BchUtxo[]>;
  /** Returns the transaction id. */
  broadcast(txHex: string): Promise<string>;
}

/** Where the secret and the recovery file live (IndexedDB or localStorage in a browser). */
export interface RecoveryStorePort {
  save(orderId: Hex32, json: string): Promise<void>;
  load(orderId: Hex32): Promise<string | null>;
  list(): Promise<readonly Hex32[]>;
}

/** The slice of the solver client the session uses. */
export type SolverPort = Pick<
  SolverClient,
  'quote' | 'getOrder' | 'relayLock' | 'relayClaim' | 'health'
>;

/** A small in-memory store: the reference implementation and the one tests use. */
export function createMemoryStore(): RecoveryStorePort & {
  readonly files: Map<Hex32, string>;
} {
  const files = new Map<Hex32, string>();
  return {
    files,
    save: (orderId, json) => {
      files.set(orderId, json);
      return Promise.resolve();
    },
    load: (orderId) => Promise.resolve(files.get(orderId) ?? null),
    list: () => Promise.resolve([...files.keys()]),
  };
}
