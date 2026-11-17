import { describe, expect, it } from 'vitest';
import {
  binToHex,
  decodeTransaction,
  encodeTransaction,
  hexToBin,
  sha256,
  type Transaction,
} from '@bitauth/libauth';
import {
  P2sh32MismatchError,
  assertLockOutputBindsRedeemScript,
  assertP2sh32Matches,
  buildClaimTransaction,
  buildLockTransaction,
  deriveHtlcAddresses,
  encodeHtlcParameters,
  inspectSignedTransaction,
  p2sh32LockingBytecodeFor,
  verifyBchTransactionWithVm,
} from '../src/index.js';
import {
  buildXoLockInvitation,
  deriveXoHtlcRedeemScript,
} from '../xo/index.js';
import { TOKENS } from './support/covenant-mutations.js';

const p2pkh = (fill: number): Uint8Array =>
  new Uint8Array([
    0x76,
    0xa9,
    0x14,
    ...new Uint8Array(20).fill(fill),
    0x88,
    0xac,
  ]);
const USER = p2pkh(0x11);
const SOLVER = p2pkh(0x22);
const SECRET = new Uint8Array(32).fill(0x01);

const hash256 = (bytes: Uint8Array): Uint8Array =>
  sha256.hash(sha256.hash(bytes));

/** Both swap directions: forward pays the user and refunds the solver. */
const directions = {
  forward: { recipient: USER, refund: SOLVER },
  reverse: { recipient: SOLVER, refund: USER },
} as const;

function params(
  token: keyof typeof TOKENS,
  direction: keyof typeof directions,
) {
  return encodeHtlcParameters({
    hashLock: sha256.hash(SECRET),
    recipientLockingBytecode: directions[direction].recipient,
    refundLockingBytecode: directions[direction].refund,
    tokenCategory: TOKENS[token],
    tokenAmount: 1000n,
    refundHeight: 500_000,
    maxFee: 1500n,
  });
}

describe('p2sh32LockingBytecodeFor', () => {
  it('is OP_HASH256 <32-byte hash256 of the redeem script> OP_EQUAL', () => {
    const redeem = new Uint8Array([0x51, 0x52, 0x93, 0x53, 0x87]);
    const locking = p2sh32LockingBytecodeFor(redeem);
    expect(locking).toHaveLength(35);
    expect([locking[0], locking[1], locking[34]]).toEqual([0xaa, 0x20, 0x87]);
    expect(binToHex(locking.slice(2, 34))).toBe(binToHex(hash256(redeem)));
  });

  it('changes when any byte of the redeem script changes', () => {
    const redeem = new Uint8Array(40).fill(0x51);
    const base = binToHex(p2sh32LockingBytecodeFor(redeem));
    for (let i = 0; i < redeem.length; i++) {
      const mutated = new Uint8Array(redeem);
      mutated[i] = (mutated[i] ?? 0) ^ 1;
      expect(binToHex(p2sh32LockingBytecodeFor(mutated))).not.toBe(base);
    }
  });
});

describe('assertP2sh32Matches', () => {
  const redeem = new Uint8Array([0x51, 0x52, 0x93]);
  it('accepts the matching locking bytecode', () => {
    expect(() =>
      assertP2sh32Matches(p2sh32LockingBytecodeFor(redeem), redeem),
    ).not.toThrow();
  });
  it('throws a typed error naming both values when the hash differs', () => {
    const wrong = p2sh32LockingBytecodeFor(redeem);
    wrong[10] = (wrong[10] ?? 0) ^ 0xff;
    try {
      assertP2sh32Matches(wrong, redeem);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(P2sh32MismatchError);
      const typed = error as P2sh32MismatchError;
      expect(typed.code).toBe('P2SH32_MISMATCH');
      expect(typed.expectedLockingBytecode).toBe(
        binToHex(p2sh32LockingBytecodeFor(redeem)),
      );
      expect(typed.actualLockingBytecode).toBe(binToHex(wrong));
      expect(typed.message).toMatch(/redeem script/i);
    }
  });
  it('throws when the locking bytecode is not a P2SH32 template', () => {
    expect(() => assertP2sh32Matches(USER, redeem)).toThrow(
      P2sh32MismatchError,
    );
    expect(() => assertP2sh32Matches(new Uint8Array(0), redeem)).toThrow(
      P2sh32MismatchError,
    );
  });
});

describe.each(['PUSD', 'MUSD'] as const)('lock outputs for %s', (token) => {
  describe.each(['forward', 'reverse'] as const)(
    '%s direction',
    (direction) => {
      const covenant = params(token, direction);

      it('the derived locking bytecode equals the helper applied to the redeem script', () => {
        const derived = deriveHtlcAddresses(covenant, 'mainnet');
        expect(binToHex(derived.lockingBytecode)).toBe(
          binToHex(p2sh32LockingBytecodeFor(derived.redeemScript)),
        );
      });

      it('the XO template derives the same locking bytecode from its own redeem script', () => {
        const invitation = buildXoLockInvitation(covenant, 'mainnet');
        const xoRedeem = deriveXoHtlcRedeemScript(covenant);
        expect(invitation.lockingBytecode).toBe(
          binToHex(p2sh32LockingBytecodeFor(xoRedeem)),
        );
        expect(invitation.lockingBytecode).toBe(
          binToHex(deriveHtlcAddresses(covenant, 'mainnet').lockingBytecode),
        );
      });

      it('the lock transaction output 0 is the helper value, with the category and amount', () => {
        const built = buildLockTransaction({
          params: covenant,
          network: 'mainnet',
          changeAddress: binToHex(USER),
          utxos: [
            {
              txid: '22'.repeat(32),
              vout: 0,
              satoshis: 20_000n,
              lockingBytecode: binToHex(USER),
              token: {
                category: TOKENS[token],
                amount: covenant.tokenAmount,
              },
            },
          ],
        });
        const tx = decodeTransaction(
          hexToBin(built.unsigned.txHex),
        ) as Transaction;
        const redeem = deriveHtlcAddresses(covenant, 'mainnet').redeemScript;
        expect(
          binToHex(tx.outputs[built.htlcOutputIndex]!.lockingBytecode),
        ).toBe(binToHex(p2sh32LockingBytecodeFor(redeem)));
        expect(binToHex(built.htlcLockingBytecode)).toBe(
          binToHex(p2sh32LockingBytecodeFor(redeem)),
        );
      });
    },
  );
});

describe('a wrong lock output hash is caught before signing', () => {
  const covenant = params('PUSD', 'forward');
  const { redeemScript, lockingBytecode } = deriveHtlcAddresses(covenant);

  it('accepts the correct output and rejects a one-bit change anywhere in the hash', () => {
    expect(() =>
      assertLockOutputBindsRedeemScript(lockingBytecode, redeemScript),
    ).not.toThrow();
    for (let i = 2; i < 34; i++) {
      const wrong = new Uint8Array(lockingBytecode);
      wrong[i] = (wrong[i] ?? 0) ^ 1;
      expect(() =>
        assertLockOutputBindsRedeemScript(wrong, redeemScript),
      ).toThrow(P2sh32MismatchError);
    }
  });

  it('rejects an output built for a different redeem script (other parameters)', () => {
    const other = deriveHtlcAddresses({ ...covenant, refundHeight: 500_001 });
    expect(() =>
      assertLockOutputBindsRedeemScript(other.lockingBytecode, redeemScript),
    ).toThrow(P2sh32MismatchError);
  });
});

describe('spend verification checks the redeem script hash', () => {
  const asWalletSource = (
    source: ReturnType<typeof buildClaimTransaction>['sourceOutput'],
  ) => ({
    ...source,
    outpointIndex: 0,
    outpointTransactionHash: new Uint8Array(32).fill(0x11),
    sequenceNumber: 0xfffffffe,
    unlockingBytecode: new Uint8Array(0),
  });
  const covenant = params('PUSD', 'forward');
  const built = buildClaimTransaction({
    params: covenant,
    utxo: { txid: '11'.repeat(32), vout: 0, satoshis: 3000n },
    secret: SECRET,
  });

  it('accepts the genuine spend', () => {
    expect(
      verifyBchTransactionWithVm({
        transaction: built.libauthTx,
        sourceOutputs: [built.sourceOutput],
      }),
    ).toBe(true);
  });

  it('rejects a spend whose redeem script differs in an argument the taken path ignores', () => {
    const tx = decodeTransaction(hexToBin(built.txHex)) as Transaction;
    // Refund payee bytes sit inside the redeem script; claim never reads them.
    const unlocking = new Uint8Array(tx.inputs[0]!.unlockingBytecode);
    unlocking[90] = (unlocking[90] ?? 0) ^ 0xff;
    tx.inputs[0] = { ...tx.inputs[0]!, unlockingBytecode: unlocking };
    const result = verifyBchTransactionWithVm({
      transaction: tx,
      sourceOutputs: [built.sourceOutput],
    });
    expect(typeof result).toBe('string');
    expect(result).toMatch(/redeem script/i);
  });

  it('rejects a spend whose source locking hash is wrong', () => {
    const lock = new Uint8Array(built.sourceOutput.lockingBytecode);
    lock[5] = (lock[5] ?? 0) ^ 1;
    const result = verifyBchTransactionWithVm({
      transaction: built.libauthTx,
      sourceOutputs: [{ ...built.sourceOutput, lockingBytecode: lock }],
    });
    expect(typeof result).toBe('string');
    expect(result).toMatch(/redeem script/i);
  });

  it('rejects a spend whose unlocking script has no redeem script push', () => {
    const tx = decodeTransaction(hexToBin(built.txHex)) as Transaction;
    tx.inputs[0] = { ...tx.inputs[0]!, unlockingBytecode: new Uint8Array(0) };
    const result = verifyBchTransactionWithVm({
      transaction: tx,
      sourceOutputs: [built.sourceOutput],
    });
    expect(typeof result).toBe('string');
  });

  it('inspectSignedTransaction reports the mismatch and names the input', () => {
    const tx = decodeTransaction(hexToBin(built.txHex)) as Transaction;
    const unlocking = new Uint8Array(tx.inputs[0]!.unlockingBytecode);
    unlocking[90] = (unlocking[90] ?? 0) ^ 0xff;
    tx.inputs[0] = { ...tx.inputs[0]!, unlockingBytecode: unlocking };
    const signedHex = binToHex(encodeTransaction(tx));
    const report = inspectSignedTransaction(built.txHex, signedHex, [
      asWalletSource(built.sourceOutput),
    ]);
    expect(report.ok).toBe(false);
    expect(report.failedInput).toBe(0);
    expect(report.problems.join(' ')).toMatch(/redeem script/i);
  });

  it('inspectSignedTransaction accepts the genuine covenant spend', () => {
    const report = inspectSignedTransaction(built.txHex, built.txHex, [
      asWalletSource(built.sourceOutput),
    ]);
    expect(report.ok).toBe(true);
  });
});
