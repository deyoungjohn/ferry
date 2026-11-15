import { binToHex, hexToBin } from '@bitauth/libauth';
import {
  categoryDisplayToInternal,
  categoryInternalToDisplay,
} from '@ferry/core';

export { categoryDisplayToInternal, categoryInternalToDisplay };

export function displayHexToInternalHex(displayHex: string): string {
  const normalized = displayHex.startsWith('0x')
    ? displayHex
    : `0x${displayHex}`;
  return categoryDisplayToInternal(normalized).slice(2);
}

export function internalHexToDisplayHex(internalHex: string): string {
  const normalized = internalHex.startsWith('0x')
    ? internalHex
    : `0x${internalHex}`;
  return categoryInternalToDisplay(normalized).slice(2);
}

export function displayToInternalCategory(displayHex: string): Uint8Array {
  return hexToBin(displayHexToInternalHex(displayHex));
}

export function internalToDisplayCategory(internalBytes: Uint8Array): string {
  if (internalBytes.length !== 32) {
    throw new Error(
      `Invalid internal category length: expected 32 bytes, got ${internalBytes.length}`,
    );
  }
  return internalHexToDisplayHex(binToHex(internalBytes));
}
