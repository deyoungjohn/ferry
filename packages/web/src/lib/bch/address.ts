import {
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
