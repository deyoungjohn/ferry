import { bytesToHex, hexToBytes } from 'viem';
import { assertHex32 } from './signing.js';
import type { Hex32 } from './terms.js';

/** Convert 32-byte BCH token category from display (RPC) byte order to internal byte order. */
export function categoryDisplayToInternal(display: string): Hex32 {
  const normalized = display.startsWith('0x') ? display : `0x${display}`;
  assertHex32(normalized);
  return bytesToHex(hexToBytes(normalized).reverse());
}

/** Convert 32-byte BCH token category from internal byte order to display (RPC) byte order. */
export function categoryInternalToDisplay(internal: string): Hex32 {
  return categoryDisplayToInternal(internal);
}
