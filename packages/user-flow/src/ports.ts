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
  /** Asks the wallet to switch to a chain; absent when the wallet cannot be asked. */
  switchChain?(chainId: number): Promise<void>;
  /** EIP-712 signing: the permit and the lock intent. Returns the 65-byte signature. */
  signTypedData(typedData: unknown): Promise<Hex>;
  /** Used only by the approve-plus-lock path and by the user's own EVM refund. */
  sendTransaction(transaction: {
    readonly to: Hex;
    readonly data: Hex;
    readonly value?: bigint;
    readonly chainId: number;
    /**
     * A gas limit to use when the wallet cannot estimate it (a transaction that
     * depends on one still waiting to be mined). Use it when present.
     */
    readonly gas?: bigint;
  }): Promise<Hex32>;
}

/** Reads on the EVM chain. An `EvmChainAdapter` from the chain package satisfies the first two. */
export interface EvmChainPort {
  buildUserLock(terms: OrderTerms): Promise<UnsignedLock>;
  getLock(lockId: Hex32): Promise<LockState>;
  /** Resolves when the transaction is mined. Return the status when it is known: `reverted` stops the flow. */
  waitForReceipt(
    txHash: Hex32,
  ): Promise<void | { readonly status: 'success' | 'reverted' }>;
  /** Timestamp of the latest block, in seconds. */
  getBlockTimestamp(): Promise<number>;
}

/** The user's Bitcoin Cash wallet (WizardConnect). It signs; it does not have to broadcast. */
/** An address of the user's wallet that may hold funds, with where the wallet keeps its key. */
export interface FundingAddress {
  readonly lockingBytecodeHex: string;
  readonly derivationPath: readonly ['receive' | 'change', number];
}

export interface BchSignerPort {
  /** Returns the fully signed transaction as hex. */
  signTransaction(request: WizardConnectSignRequest): Promise<string>;
  /**
   * The wallet's addresses that may hold funds. A wallet that rotates addresses keeps its money
   * on many of them; looking at one address sees only a fraction of the balance.
   */
  listFundingAddresses?(): Promise<readonly FundingAddress[]>;
}

export interface BchUtxo {
  readonly txid: string;
  readonly vout: number;
  readonly satoshis: bigint;
  /** The token category is in explorer byte order, as in `OrderTerms.bchTokenCategory`. */
  readonly token?: { readonly category: string; readonly amount: bigint };
  /** Set when the output also holds an NFT: such an output is never spent by a lock. */
  readonly nft?: { readonly capability?: string; readonly commitment?: string };
  /** The lock script of the address holding this output (hex), when it is not the primary address. */
  readonly lockingBytecodeHex?: string;
  /** Where the user's wallet keeps the key for this output, so it can sign it. */
  readonly derivationPath?: readonly ['receive' | 'change', number];
}

/** Bitcoin Cash chain reads and broadcast (in a browser: public Fulcrum over `wss`). */
export interface BchChainPort {
  getTipHeight(): Promise<number>;
  /** Unspent outputs locked by this locking bytecode (hex, no `0x` needed). */
  getUtxos(lockingBytecodeHex: string): Promise<readonly BchUtxo[]>;
  /** The same for many locking bytecodes at once, keyed by the bytecode as given. */
  getUtxosMany?(
    lockingBytecodeHexes: readonly string[],
  ): Promise<ReadonlyMap<string, readonly BchUtxo[]>>;
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
