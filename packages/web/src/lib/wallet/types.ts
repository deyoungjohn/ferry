import type { Address, Hex, TypedDataDefinition } from 'viem';
import type { WizardConnectSignRequest } from '@ferry/htlc-bch';

export type WalletStatus =
  'disconnected' | 'connecting' | 'connected' | 'offline' | 'unavailable';

export interface BchAddressInfo {
  readonly address: string;
  readonly lockingBytecode: `0x${string}`;
  readonly tokenAware: boolean;
}

export interface BchUtxo {
  readonly txid: string;
  readonly vout: number;
  readonly satoshis: bigint;
  readonly lockingBytecode: `0x${string}`;
  readonly token?: {
    readonly category: string;
    readonly amount: bigint;
  };
}

export interface BchSourceOutput {
  readonly outpointIndex: number;
  readonly outpointTransactionHash: Uint8Array;
  readonly sequenceNumber: number;
  readonly unlockingBytecode: Uint8Array;
  readonly valueSatoshis: bigint;
  readonly lockingBytecode: Uint8Array;
  readonly token?: {
    readonly category: Uint8Array;
    readonly amount: bigint;
  };
}

export interface BchSignTransactionRequest {
  readonly transaction: string;
  readonly sourceOutputs: readonly BchSourceOutput[];
  readonly broadcast?: boolean;
  readonly userPrompt?: string;
}

export interface BchSignedTransaction {
  readonly txHex: string;
  readonly txid: string;
}

export interface EvmWallet {
  readonly status: WalletStatus;
  readonly address: Address | null;
  readonly chainId?: number | undefined;
  readonly error: string | null;
  readonly pendingRequest: string | null;
  readonly promptHelp?: string | null;
  connect(): void;
  disconnect(): Promise<void>;
  cancelPendingRequest?(): void;
  signTypedData(params: TypedDataDefinition): Promise<Hex>;
  /** Sends a transaction from the wallet (approve, lock, refund). Absent when the wallet cannot. */
  sendTransaction?(transaction: {
    readonly to: Hex;
    readonly data: Hex;
    readonly value?: bigint;
    readonly chainId: number;
  }): Promise<Hex>;
  readTokenBalance(owner: Address): Promise<bigint>;
  refundLock(id: Hex): Promise<Hex>;
  claimLock(id: Hex, secret: Hex): Promise<Hex>;
}

export interface BchWalletConnectOptions {
  readonly fresh?: boolean;
  readonly simulatePrefixMismatch?: boolean;
  readonly address?: string;
}

export interface BchWallet {
  readonly status: WalletStatus;
  readonly address: BchAddressInfo | null;
  readonly error: string | null;
  readonly walletName: string | null;
  readonly pairing?: boolean;
  readonly pendingRequest: string | null;
  readonly promptHelp?: string | null;
  connect(options?: BchWalletConnectOptions): void;
  disconnect(): Promise<void>;
  cancelPendingRequest(): void;
  setAddress(address: BchAddressInfo): void;
  forget?(): void;
  listUtxos(): Promise<readonly BchUtxo[]>;
  signTransaction(
    request: BchSignTransactionRequest,
  ): Promise<BchSignedTransaction>;
  /** Signs a covenant lock request in the WizardConnect shape and returns the signed transaction hex. */
  signWizardRequest?(request: WizardConnectSignRequest): Promise<string>;
  broadcastTransaction(txHex: string): Promise<string>;
  transactionExists(txid: string): Promise<boolean>;
}

export interface WalletSet {
  readonly evm: EvmWallet;
  readonly bch: BchWallet;
  readonly usingMocks: boolean;
}
