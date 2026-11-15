import { describe, expect, it } from 'vitest';
import {
  FERRY_HTLC_DEPLOYED_BYTECODE_HASH,
  FERRY_HTLC_INIT_CODE_HASH,
  ferryHtlcAbi,
} from '../abi.js';

describe('@ferry/htlc-evm ABI and bytecode hashes', () => {
  const functionNames = ferryHtlcAbi
    .filter((entry) => entry.type === 'function')
    .map((entry) => entry.name);

  it('exposes the expected HTLC functions', () => {
    expect(functionNames).toEqual(
      expect.arrayContaining([
        'DOMAIN_SEPARATOR',
        'EIP712_DOMAIN_TYPEHASH',
        'LOCK_INTENT_TYPEHASH',
        'claim',
        'lock',
        'lockId',
        'lockWithIntent',
        'locks',
        'refund',
      ]),
    );
  });

  it('contains no owner, upgrade, or pause functions', () => {
    const forbidden = [
      'owner',
      'transferOwnership',
      'renounceOwnership',
      'upgradeTo',
      'upgradeToAndCall',
      'proxiableUUID',
      'pause',
      'unpause',
      'paused',
      'implementation',
      'admin',
      'changeAdmin',
    ];
    for (const name of forbidden) {
      expect(functionNames).not.toContain(name);
    }
  });

  it('exports 32-byte keccak256 bytecode hashes', () => {
    expect(FERRY_HTLC_DEPLOYED_BYTECODE_HASH).toMatch(/^0x[0-9a-f]{64}$/);
    expect(FERRY_HTLC_INIT_CODE_HASH).toMatch(/^0x[0-9a-f]{64}$/);
  });
});
