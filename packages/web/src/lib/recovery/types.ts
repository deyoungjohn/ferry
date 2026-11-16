import type { Hex, Hex32, OrderTerms } from '@ferry/core';

export interface RecoveryContracts {
  readonly evm: {
    readonly chainId: number;
    readonly address: string;
    readonly codeHash: string;
    readonly bytecode?: string;
  };
  readonly bch: {
    readonly network: 'chipnet' | 'mainnet';
    readonly htlcAddress: string;
    readonly tokenAddress: string;
    readonly redeemScript?: Hex;
    readonly lockingBytecode?: Hex;
  };
}

export interface RecoveryFile {
  readonly version: 1;
  readonly solverKind?: 'mock' | 'live';
  readonly orderId: Hex32;
  readonly terms: OrderTerms;
  readonly secret: Hex32;
  readonly createdAt: number;
  readonly contracts: RecoveryContracts;
}

export interface RecoverySnapshot {
  readonly file: RecoveryFile;
  readonly bchLockStatus: 'unfunded' | 'funded' | 'spent' | 'refunded';
  readonly evmLockStatus: 'unfunded' | 'funded' | 'spent' | 'refunded';
  readonly bchCanRefund: boolean;
  readonly evmCanRefund: boolean;
  readonly canClaim: boolean;
  readonly bchBlocksRemaining?: number;
  readonly evmSecondsRemaining?: number;
}

export interface RecoveryPort {
  validateFile(rawJson: string): RecoveryFile;
  loadSnapshot(file: RecoveryFile): Promise<RecoverySnapshot>;
  executeClaim(snapshot: RecoverySnapshot): Promise<string>;
  executeRefund(snapshot: RecoverySnapshot): Promise<string>;
}
