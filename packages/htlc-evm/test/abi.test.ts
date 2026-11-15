import { describe, expect, it } from 'vitest';
import {
  LOCK_INTENT_TYPEHASH,
  evmLockId,
  lockIntentDomainSeparator,
  lockIntentTypedData,
} from '@ferry/core';
import { CROSS_CHECK_VECTORS } from '@ferry/core/vectors';
import { hashTypedData, hexToBytes, sha256 } from 'viem';
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

  it('matches @ferry/core/vectors cross-check vectors and ABI signatures', () => {
    expect(sha256(hexToBytes(CROSS_CHECK_VECTORS.secret))).toBe(
      CROSS_CHECK_VECTORS.hashLock,
    );

    const { sender, hashLock, expectedLockId } = CROSS_CHECK_VECTORS.evmLockId;
    expect(evmLockId(sender, hashLock)).toBe(expectedLockId);

    const { domain, message, expectedTypehash, expectedDomainSeparator } =
      CROSS_CHECK_VECTORS.lockIntent;
    expect(LOCK_INTENT_TYPEHASH).toBe(expectedTypehash);
    expect(lockIntentDomainSeparator(domain)).toBe(expectedDomainSeparator);

    const typedData = lockIntentTypedData(domain, message);
    expect(hashTypedData(typedData)).toMatch(/^0x[0-9a-f]{64}$/);

    const lockWithIntentFn = ferryHtlcAbi.find(
      (entry) => entry.type === 'function' && entry.name === 'lockWithIntent',
    );
    expect(lockWithIntentFn).toBeDefined();
    expect(lockWithIntentFn?.inputs.map((input) => input.name)).toEqual(
      expect.arrayContaining([
        'token',
        'recipient',
        'amount',
        'hashLock',
        'deadline',
        'intentDeadline',
      ]),
    );
  });
});
