import {
  MockNetworkProvider,
  Network,
  TransactionBuilder,
  type NetworkProvider,
} from 'cashscript';
import {
  binToHex,
  createVirtualMachineBCH,
  decodeTransaction,
  hexToBin,
  sha256,
  type Output,
  type Transaction,
} from '@bitauth/libauth';
import { assertValidSecret } from '@ferry/core';
import { internalToDisplayCategory } from './byte-order.js';
import { getHtlcContract } from './contract.js';
import type { BchHtlcParameters, CashAddressNetwork } from './types.js';

function computeTxId(txHex: string): string {
  const raw = hexToBin(txHex);
  const hash = sha256.hash(sha256.hash(raw));
  const reversed = new Uint8Array(hash.length);
  for (let i = 0; i < hash.length; i++) {
    reversed[i] = hash[hash.length - 1 - i]!;
  }
  return binToHex(reversed);
}

function normalizeLockingBytecodeHex(lockingBytecode: string): string {
  return lockingBytecode.replace(/^0x/i, '').toLowerCase();
}

function resolveValidatedUtxoLockingBytecode(
  provided: string | undefined,
  derived: string,
): string {
  const derivedNormalized = normalizeLockingBytecodeHex(derived);
  if (provided !== undefined) {
    const providedNormalized = normalizeLockingBytecodeHex(provided);
    if (providedNormalized !== derivedNormalized) {
      throw new Error(
        `UTXO lockingBytecode (${providedNormalized}) does not match HTLC contract lockingBytecode (${derivedNormalized})`,
      );
    }
    return providedNormalized;
  }
  return derivedNormalized;
}

export interface HtlcUtxo {
  txid: string;
  vout: number;
  satoshis: bigint | number;
  lockingBytecode?: string;
}

export interface BuildClaimTxOptions {
  params: BchHtlcParameters;
  utxo: HtlcUtxo;
  secret: Uint8Array | string;
  feeSats?: bigint | number;
  network?: CashAddressNetwork;
  provider?: NetworkProvider;
}

export interface BuildRefundTxOptions {
  params: BchHtlcParameters;
  utxo: HtlcUtxo;
  feeSats?: bigint | number;
  network?: CashAddressNetwork;
  provider?: NetworkProvider;
  locktime?: number;
}

export interface HtlcSourceOutput extends Output {
  token: {
    category: Uint8Array;
    amount: bigint;
  };
}

export type VmSourceOutput = Omit<Output, 'token'> & {
  token?: Output['token'] | undefined;
};

export interface BuiltTransaction {
  txHex: string;
  txid: string;
  libauthTx: Transaction;
  sourceOutput: HtlcSourceOutput;
  builder: TransactionBuilder;
}

/**
 * Verify a Libauth transaction (or raw tx hex) against its source outputs
 * using the Libauth BCH VM. Returns true or a descriptive error string.
 */
export function verifyBchTransactionWithVm(params: {
  transaction: Transaction | string;
  sourceOutputs: VmSourceOutput[];
}): true | string {
  let tx: Transaction;
  if (typeof params.transaction === 'string') {
    const decoded = decodeTransaction(hexToBin(params.transaction));
    if (typeof decoded === 'string') {
      return `Failed to decode transaction hex: ${decoded}`;
    }
    tx = decoded;
  } else {
    tx = params.transaction;
  }
  const vm = createVirtualMachineBCH();
  return vm.verify({
    transaction: tx,
    sourceOutputs: params.sourceOutputs as Output[],
  });
}

/**
 * Build a claim transaction for FerryHTLC.claim(secret).
 * Validates that secret is 32 bytes and sha256(secret) === params.hashLock before building,
 * validates utxo.lockingBytecode if provided, and verifies the resulting transaction
 * in the Libauth VM against the UTXO source output.
 */
export function buildClaimTransaction(
  options: BuildClaimTxOptions,
): BuiltTransaction {
  const secretHex =
    typeof options.secret === 'string'
      ? options.secret
      : `0x${binToHex(options.secret)}`;
  const hashLockHex = `0x${binToHex(options.params.hashLock)}`;
  assertValidSecret(secretHex, hashLockHex, 'claim secret');

  const secretBytes =
    typeof options.secret === 'string'
      ? hexToBin(
          options.secret.startsWith('0x')
            ? options.secret.slice(2)
            : options.secret,
        )
      : options.secret;

  let provider = options.provider;
  if (!provider) {
    const mock = new MockNetworkProvider();
    mock.network =
      options.network === 'mainnet' ? Network.MAINNET : Network.CHIPNET;
    provider = mock;
  }

  const contract = getHtlcContract(options.params, {
    provider,
    ...(options.network !== undefined ? { network: options.network } : {}),
  });
  const fee = BigInt(options.feeSats ?? 500n);
  if (fee > options.params.maxFee) {
    throw new Error(`Fee ${fee} exceeds maxFee ${options.params.maxFee}`);
  }

  const utxoSatoshis = BigInt(options.utxo.satoshis);
  if (utxoSatoshis < fee) {
    throw new Error(
      `UTXO satoshis ${utxoSatoshis} insufficient for fee ${fee}`,
    );
  }

  const utxoLockingBytecode = resolveValidatedUtxoLockingBytecode(
    options.utxo.lockingBytecode,
    contract.lockingBytecode,
  );
  const outputAmount = utxoSatoshis - fee;
  const displayCategory = internalToDisplayCategory(
    options.params.tokenCategory,
  );

  const utxo = {
    txid: options.utxo.txid,
    vout: options.utxo.vout,
    satoshis: utxoSatoshis,
    lockingBytecode: utxoLockingBytecode,
    token: {
      category: displayCategory,
      amount: options.params.tokenAmount,
    },
  };

  const builder = new TransactionBuilder({ provider });
  builder.addInput(utxo, contract.unlock.claim(secretBytes));
  builder.addOutput({
    to: options.params.recipientLockingBytecode,
    amount: outputAmount,
    token: {
      category: displayCategory,
      amount: options.params.tokenAmount,
    },
  });

  const txHex = builder.build();
  const decodedTx = decodeTransaction(hexToBin(txHex));
  if (typeof decodedTx === 'string') {
    throw new Error(`Failed to decode built claim transaction: ${decodedTx}`);
  }
  const txid = computeTxId(txHex);

  const sourceOutput: HtlcSourceOutput = {
    lockingBytecode: hexToBin(utxo.lockingBytecode),
    valueSatoshis: utxoSatoshis,
    token: {
      category: hexToBin(displayCategory),
      amount: options.params.tokenAmount,
    },
  };

  const vmResult = verifyBchTransactionWithVm({
    transaction: decodedTx,
    sourceOutputs: [sourceOutput],
  });
  if (vmResult !== true) {
    throw new Error(`BCH claim script VM verification failed: ${vmResult}`);
  }

  return {
    txHex,
    txid,
    libauthTx: decodedTx,
    sourceOutput,
    builder,
  };
}

/**
 * Build a refund transaction for FerryHTLC.refund().
 * Sets nLockTime >= refundHeight and input sequence 0xfffffffe,
 * validates utxo.lockingBytecode if provided, and verifies the resulting transaction
 * in the Libauth VM against the UTXO source output.
 */
export function buildRefundTransaction(
  options: BuildRefundTxOptions,
): BuiltTransaction {
  const locktime = options.locktime ?? options.params.refundHeight;
  if (locktime < options.params.refundHeight) {
    throw new Error(
      `Refund locktime ${locktime} is below refundHeight ${options.params.refundHeight}`,
    );
  }

  let provider = options.provider;
  if (!provider) {
    const mock = new MockNetworkProvider();
    mock.network =
      options.network === 'mainnet' ? Network.MAINNET : Network.CHIPNET;
    provider = mock;
  }

  const contract = getHtlcContract(options.params, {
    provider,
    ...(options.network !== undefined ? { network: options.network } : {}),
  });
  const fee = BigInt(options.feeSats ?? 500n);
  if (fee > options.params.maxFee) {
    throw new Error(`Fee ${fee} exceeds maxFee ${options.params.maxFee}`);
  }

  const utxoSatoshis = BigInt(options.utxo.satoshis);
  if (utxoSatoshis < fee) {
    throw new Error(
      `UTXO satoshis ${utxoSatoshis} insufficient for fee ${fee}`,
    );
  }

  const utxoLockingBytecode = resolveValidatedUtxoLockingBytecode(
    options.utxo.lockingBytecode,
    contract.lockingBytecode,
  );
  const outputAmount = utxoSatoshis - fee;
  const displayCategory = internalToDisplayCategory(
    options.params.tokenCategory,
  );

  const utxo = {
    txid: options.utxo.txid,
    vout: options.utxo.vout,
    satoshis: utxoSatoshis,
    lockingBytecode: utxoLockingBytecode,
    token: {
      category: displayCategory,
      amount: options.params.tokenAmount,
    },
  };

  const builder = new TransactionBuilder({ provider });
  builder.addInput(utxo, contract.unlock.refund(), { sequence: 0xfffffffe });
  builder.setLocktime(locktime);
  builder.addOutput({
    to: options.params.refundLockingBytecode,
    amount: outputAmount,
    token: {
      category: displayCategory,
      amount: options.params.tokenAmount,
    },
  });

  const txHex = builder.build();
  const decodedTx = decodeTransaction(hexToBin(txHex));
  if (typeof decodedTx === 'string') {
    throw new Error(`Failed to decode built refund transaction: ${decodedTx}`);
  }
  const txid = computeTxId(txHex);

  const sourceOutput: HtlcSourceOutput = {
    lockingBytecode: hexToBin(utxo.lockingBytecode),
    valueSatoshis: utxoSatoshis,
    token: {
      category: hexToBin(displayCategory),
      amount: options.params.tokenAmount,
    },
  };

  const vmResult = verifyBchTransactionWithVm({
    transaction: decodedTx,
    sourceOutputs: [sourceOutput],
  });
  if (vmResult !== true) {
    throw new Error(`BCH refund script VM verification failed: ${vmResult}`);
  }

  return {
    txHex,
    txid,
    libauthTx: decodedTx,
    sourceOutput,
    builder,
  };
}
