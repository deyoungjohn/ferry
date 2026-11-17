import {
  binToHex,
  hexToBin,
  lockingBytecodeToCashAddress,
} from '@bitauth/libauth';
import {
  compileCashAssemblyString,
  parseTemplate,
  serializeTemplate,
} from '@xo-cash/utils';
import type { XOTemplate } from '@xo-cash/types';
import { ferryHtlcTemplate } from './ferry-htlc.template.js';
import { p2sh32LockingBytecodeFor } from '../src/p2sh32.js';
import type { BchHtlcParameters, CashAddressNetwork } from '../src/types.js';

export { ferryHtlcTemplate };

export function getParsedFerryHtlcTemplate() {
  return parseTemplate(ferryHtlcTemplate);
}

export function serializeFerryHtlcTemplate() {
  return serializeTemplate(ferryHtlcTemplate);
}

export function deriveXoHtlcRedeemScript(
  params: BchHtlcParameters,
): Uint8Array {
  const redeemHex = compileCashAssemblyString({
    cashAssemblyText: 'htlcLockingBytecode',
    templateScripts: ferryHtlcTemplate.scripts,
    variables: {
      hashLock: params.hashLock,
      recipientLockingBytecode: params.recipientLockingBytecode,
      refundLockingBytecode: params.refundLockingBytecode,
      tokenCategory: params.tokenCategory,
      tokenAmount: Number(params.tokenAmount),
      refundHeight: params.refundHeight,
      maxFee: Number(params.maxFee),
    },
    evaluationDecodeMode: 'hex',
  });
  return hexToBin(redeemHex);
}

export function deriveXoHtlcLockingBytecode(params: BchHtlcParameters): string {
  const redeemBytes = deriveXoHtlcRedeemScript(params);
  return binToHex(p2sh32LockingBytecodeFor(redeemBytes));
}

export interface XoLockInvitation {
  template: XOTemplate;
  action: 'lock';
  network: CashAddressNetwork;
  lockAddress: string;
  tokenAddress: string;
  lockingBytecode: string;
  redeemScript: string;
  variables: {
    hashLock: string;
    recipientLockingBytecode: string;
    refundLockingBytecode: string;
    tokenCategory: string;
    tokenAmount: string;
    refundHeight: number;
    maxFee: string;
  };
}

export function buildXoLockInvitation(
  params: BchHtlcParameters,
  network: CashAddressNetwork = 'chipnet',
): XoLockInvitation {
  const redeemBytes = deriveXoHtlcRedeemScript(params);
  const lockingHex = deriveXoHtlcLockingBytecode(params);
  const lockingBytes = hexToBin(lockingHex);
  const prefix = network === 'mainnet' ? 'bitcoincash' : 'bchtest';

  const standard = lockingBytecodeToCashAddress({
    bytecode: lockingBytes,
    prefix,
    tokenSupport: false,
  });
  const tokenAware = lockingBytecodeToCashAddress({
    bytecode: lockingBytes,
    prefix,
    tokenSupport: true,
  });
  if (typeof standard === 'string' || typeof tokenAware === 'string') {
    throw new Error('Failed to encode XO HTLC CashAddr');
  }

  return {
    template: ferryHtlcTemplate,
    action: 'lock',
    network,
    lockAddress: standard.address,
    tokenAddress: tokenAware.address,
    lockingBytecode: lockingHex,
    redeemScript: binToHex(redeemBytes),
    variables: {
      hashLock: binToHex(params.hashLock),
      recipientLockingBytecode: binToHex(params.recipientLockingBytecode),
      refundLockingBytecode: binToHex(params.refundLockingBytecode),
      tokenCategory: binToHex(params.tokenCategory),
      tokenAmount: params.tokenAmount.toString(),
      refundHeight: params.refundHeight,
      maxFee: params.maxFee.toString(),
    },
  };
}
