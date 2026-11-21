import {
  hexToBin,
  binToHex,
  encodeLockingBytecodeP2pkh,
  hash160,
  lockingBytecodeToCashAddress,
} from '@bitauth/libauth';
import { NETWORK_PROFILE } from '../config';
import type { BchAddressInfo } from '../wallet/types';

export function addressFromPubkey(pubkey: Uint8Array): BchAddressInfo {
  const locking = encodeLockingBytecodeP2pkh(hash160(pubkey));
  const encoded = lockingBytecodeToCashAddress({
    bytecode: locking,
    prefix: NETWORK_PROFILE.bch.prefix,
    tokenSupport: true,
  });
  if (typeof encoded === 'string') {
    throw new Error(`Could not encode BCH address: ${encoded}`);
  }
  return {
    address: encoded.address,
    lockingBytecode: `0x${binToHex(locking)}`,
    tokenAware: true,
  };
}

/** The token-aware cash address of a locking script (for a swap's fixed recipient). */
export function cashAddressOfLocking(lockingHex: string): string {
  const encoded = lockingBytecodeToCashAddress({
    bytecode: hexToBin(lockingHex.replace(/^0x/i, '')),
    prefix: NETWORK_PROFILE.bch.prefix,
    tokenSupport: true,
  });
  if (typeof encoded === 'string') {
    throw new Error(`Could not read the receiving address: ${encoded}`);
  }
  return encoded.address;
}
