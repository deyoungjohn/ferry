import { describe, expect, it } from 'vitest';
import { cashAddressToLockingBytecode } from '@ferry/core';
import { cashAddressOfLocking } from '../lib/bch/address';
import { NETWORK_PROFILE } from '../lib/config';

describe("a swap's fixed recipient", () => {
  it('reads back the token-aware address from the locking script in the terms', () => {
    const address = 'bitcoincash:zplzkjj2qj7u66w3aqggxw4d392elac005qk68ff65';
    const back = cashAddressOfLocking(cashAddressToLockingBytecode(address));
    // The same script, written with this build's network prefix and token-aware.
    expect(back.startsWith(`${NETWORK_PROFILE.bch.prefix}:z`)).toBe(true);
    expect(cashAddressToLockingBytecode(back)).toBe(
      cashAddressToLockingBytecode(address),
    );
  });
});
