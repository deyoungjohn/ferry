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
} from '@bitauth/libauth';
import { assertValidSecret } from '@ferry/core';
import { internalToDisplayCategory } from './byte-order.js';
import { getHtlcContract } from './contract.js';
import type { BchHtlcParameters, CashAddressNetwork } from './types.js';

interface TransactionBuilderWithLibauth {
  buildLibauthTransaction(): unknown;
}

function computeTxId(txHex: string): string {
  const raw = hexToBin(txHex);
  const hash = sha256.hash(sha256.hash(raw));
  const reversed = new Uint8Array(hash.length);
  for (let i = 0; i < hash.length; i++) {
    reversed[i] = hash[hash.length - 1 - i]!;
  }
  return binToHex(reversed);
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
  overrideDisplayCategory?: string;
}

export interface BuildRefundTxOptions {
  params: BchHtlcParameters;
  utxo: HtlcUtxo;
  feeSats?: bigint | number;
  network?: CashAddressNetwork;
  provider?: NetworkProvider;
  overrideDisplayCategory?: string;
  locktime?: number;
}

export interface BuiltTransaction {
  txHex: string;
  txid: string;
  libauthTx: unknown;
  sourceOutput: {
    lockingBytecode: Uint8Array;
    valueSatoshis: bigint;
    token: {
      category: Uint8Array;
      amount: bigint;
    };
  };
  builder: TransactionBuilder;
}

/**
 * Verify a Libauth transaction (or raw tx hex) against its source outputs
 * using the Libauth BCH VM. Returns true or a descriptive error string.
 */
export function verifyBchTransactionWithVm(params: {
  transaction: unknown;
  sourceOutputs: unknown[];
}): true | string {
  let tx = params.transaction;
  if (typeof tx === 'string') {
    const decoded = decodeTransaction(hexToBin(tx));
    if (typeof decoded === 'string') {
      return `Failed to decode transaction hex: ${decoded}`;
    }
    tx = decoded;
  }
  const vm = createVirtualMachineBCH();
  type VerifyParams = Parameters<typeof vm.verify>[0];
  return vm.verify({
    transaction: tx as VerifyParams['transaction'],
    sourceOutputs: params.sourceOutputs as VerifyParams['sourceOutputs'],
  });
}

/**
 * Build a claim transaction for FerryHTLC.claim(secret).
 * Validates that secret is 32 bytes and sha256(secret) === params.hashLock before building,
 * and verifies the resulting transaction in the Libauth VM against its source output.
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

  const outputAmount = utxoSatoshis - fee;
  const displayCategory =
    options.overrideDisplayCategory ??
    internalToDisplayCategory(options.params.tokenCategory);

  const utxo = {
    txid: options.utxo.txid,
    vout: options.utxo.vout,
    satoshis: utxoSatoshis,
    lockingBytecode: options.utxo.lockingBytecode ?? contract.lockingBytecode,
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
  const libauthTx = (
    builder as unknown as TransactionBuilderWithLibauth
  ).buildLibauthTransaction();
  const txid = computeTxId(txHex);

  const sourceOutput = {
    lockingBytecode: hexToBin(contract.lockingBytecode),
    valueSatoshis: utxoSatoshis,
    token: {
      category: hexToBin(displayCategory),
      amount: options.params.tokenAmount,
    },
  };

  const vmResult = verifyBchTransactionWithVm({
    transaction: libauthTx,
    sourceOutputs: [sourceOutput],
  });
  if (vmResult !== true) {
    throw new Error(`BCH claim script VM verification failed: ${vmResult}`);
  }

  return {
    txHex,
    txid,
    libauthTx,
    sourceOutput,
    builder,
  };
}

/**
 * Build a refund transaction for FerryHTLC.refund().
 * Sets nLockTime >= refundHeight and input sequence 0xfffffffe,
 * and verifies the resulting transaction in the Libauth VM against its source output.
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

  const outputAmount = utxoSatoshis - fee;
  const displayCategory =
    options.overrideDisplayCategory ??
    internalToDisplayCategory(options.params.tokenCategory);

  const utxo = {
    txid: options.utxo.txid,
    vout: options.utxo.vout,
    satoshis: utxoSatoshis,
    lockingBytecode: options.utxo.lockingBytecode ?? contract.lockingBytecode,
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
  const libauthTx = (
    builder as unknown as TransactionBuilderWithLibauth
  ).buildLibauthTransaction();
  const txid = computeTxId(txHex);

  const sourceOutput = {
    lockingBytecode: hexToBin(contract.lockingBytecode),
    valueSatoshis: utxoSatoshis,
    token: {
      category: hexToBin(displayCategory),
      amount: options.params.tokenAmount,
    },
  };

  const vmResult = verifyBchTransactionWithVm({
    transaction: libauthTx,
    sourceOutputs: [sourceOutput],
  });
  if (vmResult !== true) {
    throw new Error(`BCH refund script VM verification failed: ${vmResult}`);
  }

  return {
    txHex,
    txid,
    libauthTx,
    sourceOutput,
    builder,
  };
}
