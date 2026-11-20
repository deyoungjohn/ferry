import { binToHex } from '@bitauth/libauth';
import { RecoveryFileSchema, type RecoveryFile } from '@ferry/core';
import {
  deriveHtlcAddresses,
  deriveLegacyHtlcAddresses,
  encodeHtlcParameters,
} from './contract.js';
import {
  buildClaimTransaction,
  buildRefundTransaction,
  type BuiltTransaction,
  type HtlcUtxo,
} from './spends.js';

export interface BuildBchRecoveryTxOptions {
  file: RecoveryFile;
  utxos: readonly HtlcUtxo[];
  feeSats?: bigint | number;
  locktime?: number;
}

export interface BchRecoveryTransactionResult {
  action: 'claim' | 'refund';
  txHex: string;
  txid: string;
  built: BuiltTransaction;
}

function normalizeHex(value: string): string {
  return value.replace(/^0x/i, '').toLowerCase();
}

/**
 * Build and Libauth-VM-verify the user's own BCH recovery transaction
 * (claim for EVM_TO_BCH, refund for BCH_TO_EVM) from a RecoveryFile and live UTXOs.
 */
export function buildBchRecoveryTransaction(
  options: BuildBchRecoveryTxOptions,
): BchRecoveryTransactionResult {
  const file = RecoveryFileSchema.parse(options.file);
  const params = encodeHtlcParameters(file.terms);
  const derivedCurrent = deriveHtlcAddresses(
    params,
    file.contracts.bch.network,
  );
  const derivedCurrentHex = binToHex(derivedCurrent.lockingBytecode);
  const fileLockingHex = normalizeHex(file.contracts.bch.lockingBytecode);

  let useLegacyArtifact = false;
  let derivedLockingHex = derivedCurrentHex;

  if (derivedCurrentHex !== fileLockingHex) {
    const derivedLegacy = deriveLegacyHtlcAddresses(
      params,
      file.contracts.bch.network,
    );
    const derivedLegacyHex = binToHex(derivedLegacy.lockingBytecode);
    if (derivedLegacyHex === fileLockingHex) {
      useLegacyArtifact = true;
      derivedLockingHex = derivedLegacyHex;
    } else {
      throw new Error(
        `Recovery file BCH lockingBytecode (${fileLockingHex}) does not match derived contract (${derivedCurrentHex}) or legacy contract (${derivedLegacyHex})`,
      );
    }
  }

  const matchingUtxo = options.utxos.find(
    (utxo) =>
      utxo.lockingBytecode === undefined ||
      normalizeHex(utxo.lockingBytecode) === derivedLockingHex,
  );
  if (!matchingUtxo) {
    throw new Error(
      `No UTXO matching BCH HTLC lockingBytecode (${derivedLockingHex}) was provided`,
    );
  }

  if (file.terms.direction === 'EVM_TO_BCH') {
    if (!file.secret) {
      throw new Error(
        'Cannot build BCH claim transaction without the swap secret',
      );
    }
    const built = buildClaimTransaction({
      params,
      utxo: matchingUtxo,
      secret: file.secret,
      network: file.contracts.bch.network,
      useLegacyArtifact,
      ...(options.feeSats !== undefined ? { feeSats: options.feeSats } : {}),
    });
    return {
      action: 'claim',
      txHex: built.txHex,
      txid: built.txid,
      built,
    };
  }

  const built = buildRefundTransaction({
    params,
    utxo: matchingUtxo,
    network: file.contracts.bch.network,
    useLegacyArtifact,
    ...(options.feeSats !== undefined ? { feeSats: options.feeSats } : {}),
    ...(options.locktime !== undefined ? { locktime: options.locktime } : {}),
  });
  return {
    action: 'refund',
    txHex: built.txHex,
    txid: built.txid,
    built,
  };
}
