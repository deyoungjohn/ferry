import { describe, expect, it } from 'vitest';
import {
  LOCK_INTENT_TYPEHASH,
  categoryDisplayToInternal,
  categoryInternalToDisplay,
  evmLockId,
  lockIntentDomainSeparator,
  lockIntentTypedData,
} from '../src/index.js';
import { CROSS_CHECK_VECTORS } from '../src/vectors.js';

describe('EVM helpers, category byte order, and cross-check vectors', () => {
  it('computes evmLockId matching cross-check vector', () => {
    const id = evmLockId(
      CROSS_CHECK_VECTORS.evmLockId.sender,
      CROSS_CHECK_VECTORS.evmLockId.hashLock,
    );
    expect(id).toBe(CROSS_CHECK_VECTORS.evmLockId.expectedLockId);
  });

  it('computes LockIntent typehash, typedData, and domain separator matching vectors', () => {
    expect(LOCK_INTENT_TYPEHASH).toBe(
      CROSS_CHECK_VECTORS.lockIntent.expectedTypehash,
    );
    const sep = lockIntentDomainSeparator(
      CROSS_CHECK_VECTORS.lockIntent.domain,
    );
    expect(sep).toBe(CROSS_CHECK_VECTORS.lockIntent.expectedDomainSeparator);

    const typed = lockIntentTypedData(
      CROSS_CHECK_VECTORS.lockIntent.domain,
      CROSS_CHECK_VECTORS.lockIntent.message,
    );
    expect(typed.primaryType).toBe('LockIntent');
    expect(typed.domain.name).toBe('FerryHTLC');
    expect(typed.domain.version).toBe('1');

    expect(() =>
      evmLockId('not-an-address', CROSS_CHECK_VECTORS.hashLock),
    ).toThrow(TypeError);
    expect(() =>
      lockIntentDomainSeparator({
        chainId: 0,
        verifyingContract:
          CROSS_CHECK_VECTORS.lockIntent.domain.verifyingContract,
      }),
    ).toThrow(RangeError);
    expect(() =>
      lockIntentTypedData(CROSS_CHECK_VECTORS.lockIntent.domain, {
        ...CROSS_CHECK_VECTORS.lockIntent.message,
        amount: 0n,
      }),
    ).toThrow(RangeError);
  });

  it('reverses BCH token category between display and internal byte order', () => {
    const internal = categoryDisplayToInternal(
      CROSS_CHECK_VECTORS.bchCategory.displayHex,
    );
    expect(internal).toBe(CROSS_CHECK_VECTORS.bchCategory.internalHex);
    expect(categoryInternalToDisplay(internal)).toBe(
      CROSS_CHECK_VECTORS.bchCategory.displayHex,
    );
  });
});
