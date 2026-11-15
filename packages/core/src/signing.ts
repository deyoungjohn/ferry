import { isAddress, verifyMessage } from 'viem';
import type { Hex, Hex32 } from './terms.js';

export interface OrderSigner {
  signMessage(args: { message: { raw: Hex32 } }): Promise<Hex>;
}

export function assertHex32(value: string): asserts value is Hex32 {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new TypeError('Expected 32-byte 0x-prefixed hex value');
  }
}

/** EIP-191 personal-sign over the 32 raw bytes of orderId. */
export async function signOrderId(
  id: Hex32,
  signer: OrderSigner,
): Promise<Hex> {
  assertHex32(id);
  return signer.signMessage({ message: { raw: id } });
}

/** Verify EIP-191 signature over the 32 raw bytes of orderId. */
export async function verifyOrderSignature(
  id: Hex32,
  signature: Hex,
  address: string,
): Promise<boolean> {
  assertHex32(id);
  if (!isAddress(address)) return false;
  try {
    return await verifyMessage({
      address,
      message: { raw: id },
      signature,
    });
  } catch {
    return false;
  }
}
