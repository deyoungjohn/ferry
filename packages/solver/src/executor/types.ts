export interface ChainInput {
  txid: string;
  vout: number;
}

export interface ChainPort {
  broadcast(txHex: string): Promise<string>;
  isOnChain(txid: string): Promise<boolean>;
  isInputSpent?(input: ChainInput): Promise<boolean>;
  findAlternativeSpend?(input: ChainInput): Promise<string | null>;
  checkTxAcrossQuorum?(txid: string): Promise<{
    found: boolean;
    totalConnected: number;
  }>;
}

export type SecretValidator = (
  secret: string,
  hashLock: string,
) => boolean | void;

export type BroadcastErrorClass =
  'DEFINITIVE_REJECTION' | 'AMBIGUOUS' | 'UNKNOWN_OUTCOME';

export interface BuiltTransaction {
  txid: string;
  txHex: string;
  inputs?: ChainInput[] | undefined;
}

export interface ExecuteOrAdoptParams {
  orderId: string;
  actionType: 'SOLVER_LOCK' | 'SOLVER_CLAIM' | 'SOLVER_REFUND' | string;
  buildTx: () => Promise<BuiltTransaction>;
  secret?: string | undefined;
  hashLock?: string | undefined;
  verifyTx?:
    ((txHex: string) => Promise<true | string> | true | string) | undefined;
  staleTimeoutSeconds?: number | undefined;
  faultBeforeBroadcast?: (() => void) | undefined;
  faultAfterBroadcast?: (() => void) | undefined;
}

export interface ExecuteOrAdoptResult {
  txid: string;
  txHex: string;
  adopted: boolean;
}
