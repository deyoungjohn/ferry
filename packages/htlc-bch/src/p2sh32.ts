import {
  binToHex,
  decodeAuthenticationInstructions,
  sha256,
  type Transaction,
} from '@bitauth/libauth';

/** OP_HASH256 <32 bytes> OP_EQUAL: the standard pay-to-script-hash-32 template. */
const OP_HASH256 = 0xaa;
const OP_EQUAL = 0x87;
const HASH_LENGTH = 32;
const P2SH32_LENGTH = HASH_LENGTH + 3;

export type P2sh32MismatchCode = 'P2SH32_MISMATCH';

/**
 * A locking bytecode does not commit to the redeem script it is meant to hold.
 * Funds locked this way could not be spent, so callers must stop before signing.
 */
export class P2sh32MismatchError extends Error {
  readonly code: P2sh32MismatchCode = 'P2SH32_MISMATCH';
  readonly expectedLockingBytecode: string;
  readonly actualLockingBytecode: string;

  constructor(
    message: string,
    expectedLockingBytecode: string,
    actualLockingBytecode: string,
  ) {
    super(message);
    this.name = 'P2sh32MismatchError';
    this.expectedLockingBytecode = expectedLockingBytecode;
    this.actualLockingBytecode = actualLockingBytecode;
  }
}

/** The P2SH32 locking bytecode that commits to `redeemBytecode`. */
export function p2sh32LockingBytecodeFor(
  redeemBytecode: Uint8Array,
): Uint8Array {
  const hash = sha256.hash(sha256.hash(redeemBytecode));
  const locking = new Uint8Array(P2SH32_LENGTH);
  locking[0] = OP_HASH256;
  locking[1] = HASH_LENGTH;
  locking.set(hash, 2);
  locking[P2SH32_LENGTH - 1] = OP_EQUAL;
  return locking;
}

export function isP2sh32LockingBytecode(lockingBytecode: Uint8Array): boolean {
  return (
    lockingBytecode.length === P2SH32_LENGTH &&
    lockingBytecode[0] === OP_HASH256 &&
    lockingBytecode[1] === HASH_LENGTH &&
    lockingBytecode[P2SH32_LENGTH - 1] === OP_EQUAL
  );
}

/** Throws a P2sh32MismatchError unless `lockingBytecode` is the P2SH32 commitment to `redeemBytecode`. */
export function assertP2sh32Matches(
  lockingBytecode: Uint8Array,
  redeemBytecode: Uint8Array,
): void {
  const expected = p2sh32LockingBytecodeFor(redeemBytecode);
  const expectedHex = binToHex(expected);
  const actualHex = binToHex(lockingBytecode);
  if (!isP2sh32LockingBytecode(lockingBytecode)) {
    throw new P2sh32MismatchError(
      `The locking bytecode is not a P2SH32 template, so it cannot commit to the redeem script (expected ${expectedHex}, got ${actualHex}).`,
      expectedHex,
      actualHex,
    );
  }
  if (expectedHex !== actualHex) {
    throw new P2sh32MismatchError(
      `The locking bytecode does not commit to the redeem script (expected ${expectedHex}, got ${actualHex}).`,
      expectedHex,
      actualHex,
    );
  }
}

/** Guard for a lock output: call it with the redeem script the output must hold, before signing. */
export function assertLockOutputBindsRedeemScript(
  outputLockingBytecode: Uint8Array,
  redeemBytecode: Uint8Array,
): void {
  assertP2sh32Matches(outputLockingBytecode, redeemBytecode);
}

/** The redeem script of a P2SH unlocking script: its last data push, or null. */
export function redeemScriptFromUnlockingBytecode(
  unlockingBytecode: Uint8Array,
): Uint8Array | null {
  const instructions = decodeAuthenticationInstructions(unlockingBytecode);
  const last = instructions[instructions.length - 1];
  return last !== undefined && 'data' in last ? last.data : null;
}

/**
 * The libauth VM runs the redeem script of a P2SH32 input but never compares
 * its hash with the locking script; the network does. Check it here so a spend
 * with the wrong redeem script is rejected locally. Returns a message for the
 * first offending input, or null.
 */
export function findP2sh32Mismatch(
  transaction: Transaction,
  sourceLockingBytecodes: readonly (Uint8Array | undefined)[],
): { inputIndex: number; message: string } | null {
  for (const [inputIndex, input] of transaction.inputs.entries()) {
    const lockingBytecode = sourceLockingBytecodes[inputIndex];
    if (
      lockingBytecode === undefined ||
      !isP2sh32LockingBytecode(lockingBytecode)
    ) {
      continue;
    }
    const redeem = redeemScriptFromUnlockingBytecode(input.unlockingBytecode);
    if (redeem === null) {
      return {
        inputIndex,
        message: `Input ${inputIndex} spends a P2SH32 output but its unlocking script has no redeem script.`,
      };
    }
    try {
      assertP2sh32Matches(lockingBytecode, redeem);
    } catch (error) {
      if (error instanceof P2sh32MismatchError) {
        return {
          inputIndex,
          message: `Input ${inputIndex}: the redeem script does not match the output being spent (expected ${error.expectedLockingBytecode}, got ${error.actualLockingBytecode}).`,
        };
      }
      throw error;
    }
  }
  return null;
}
