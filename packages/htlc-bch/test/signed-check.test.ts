import { describe, expect, it } from 'vitest';
import {
  binToHex,
  decodeTransaction,
  encodeTransaction,
  hexToBin,
  lockingBytecodeToCashAddress,
  ripemd160,
  secp256k1,
  sha256,
} from '@bitauth/libauth';
import {
  MockNetworkProvider,
  SignatureTemplate,
  TransactionBuilder,
} from 'cashscript';
import {
  WalletSignedTransactionError,
  assertSignedTransactionValid,
  buildLockTransaction,
  inspectSignedTransaction,
} from '../src/index.js';

const PRIVKEY = new Uint8Array(32).fill(0x21);
const PUBKEY = secp256k1.derivePublicKeyCompressed(PRIVKEY) as Uint8Array;
const PKH = ripemd160.hash(sha256.hash(PUBKEY));
const USER_LOCKING_BYTECODE = new Uint8Array([
  0x76,
  0xa9,
  0x14,
  ...PKH,
  0x88,
  0xac,
]);
const USER_ADDRESS = (
  lockingBytecodeToCashAddress({
    bytecode: USER_LOCKING_BYTECODE,
    prefix: 'bchtest',
    tokenSupport: false,
  }) as { address: string }
).address;
const HASH_LOCK = new Uint8Array(32).fill(0x33);
const DISPLAY_CATEGORY =
  'ec335fd3ffa45f80cef7217cf98e8adf562df5a3e33f354f69df2951703586ac';

function buildSampleLock() {
  return buildLockTransaction({
    params: {
      hashLock: HASH_LOCK,
      recipientLockingBytecode: USER_LOCKING_BYTECODE,
      refundLockingBytecode: USER_LOCKING_BYTECODE,
      tokenCategory: DISPLAY_CATEGORY,
      tokenAmount: 1000n,
      refundHeight: 500_000,
      maxFee: 1500n,
    },
    utxos: [
      {
        txid: '11'.repeat(32),
        vout: 0,
        satoshis: 3000n,
        lockingBytecode: USER_LOCKING_BYTECODE,
        derivationPath: ['receive', 0],
        token: { category: DISPLAY_CATEGORY, amount: 600n },
      },
      {
        txid: '22'.repeat(32),
        vout: 1,
        satoshis: 4000n,
        lockingBytecode: USER_LOCKING_BYTECODE,
        derivationPath: ['receive', 1],
        token: { category: DISPLAY_CATEGORY, amount: 500n },
      },
    ],
    changeAddress: USER_ADDRESS,
  });
}

function signLockTx(
  lockTx: ReturnType<typeof buildSampleLock>,
  signerKey: Uint8Array,
  signInputIndices: number[],
): string {
  const provider = new MockNetworkProvider();
  const sigTemplate = new SignatureTemplate(signerKey);
  const builder = new TransactionBuilder({ provider });

  lockTx.unsigned.transaction.inputs.forEach((input, idx) => {
    const src = lockTx.unsigned.sourceOutputs[idx]!;
    const utxo = {
      txid: binToHex(Uint8Array.from(input.outpointTransactionHash).reverse()),
      vout: input.outpointIndex,
      satoshis: src.valueSatoshis,
      lockingBytecode: binToHex(src.lockingBytecode),
      ...(src.token
        ? {
            token: {
              category: binToHex(src.token.category),
              amount: src.token.amount,
            },
          }
        : {}),
    };
    const unlocker = signInputIndices.includes(idx)
      ? sigTemplate.unlockP2PKH()
      : {
          generateLockingBytecode: () => USER_LOCKING_BYTECODE,
          generateUnlockingBytecode: () => new Uint8Array(),
        };
    builder.addInput(utxo, unlocker);
  });

  lockTx.unsigned.transaction.outputs.forEach((output) => {
    builder.addOutput({
      to: output.lockingBytecode,
      amount: output.valueSatoshis,
      ...(output.token
        ? {
            token: {
              category: binToHex(output.token.category),
              amount: output.token.amount,
            },
          }
        : {}),
    });
  });

  return builder.build();
}

describe('signed-transaction check', () => {
  it('accepts a validly signed 2-input lock transaction', () => {
    const lockTx = buildSampleLock();
    const signedHex = signLockTx(lockTx, PRIVKEY, [0, 1]);
    const report = assertSignedTransactionValid(
      lockTx.unsigned.txHex,
      signedHex,
      lockTx.unsigned.sourceOutputs,
    );
    expect(report.ok).toBe(true);
    expect(report.failedInput).toBeNull();
  });

  it('names the first unsigned input when a wallet leaves an input unsigned', () => {
    const lockTx = buildSampleLock();
    const partiallySignedHex = signLockTx(lockTx, PRIVKEY, [0]);

    const report = inspectSignedTransaction(
      lockTx.unsigned.txHex,
      partiallySignedHex,
      lockTx.unsigned.sourceOutputs,
    );
    expect(report.ok).toBe(false);
    expect(report.failedInput).toBe(1);
    expect(report.problems[0]).toMatch(/Input 1 is not signed/i);
    expect(() =>
      assertSignedTransactionValid(
        lockTx.unsigned.txHex,
        partiallySignedHex,
        lockTx.unsigned.sourceOutputs,
      ),
    ).toThrow(WalletSignedTransactionError);
  });

  it('rejects altered outputs and invalid signatures', () => {
    const lockTx = buildSampleLock();
    const signedHex = signLockTx(lockTx, PRIVKEY, [0, 1]);
    const decoded = decodeTransaction(hexToBin(signedHex));
    if (typeof decoded === 'string') throw new Error(decoded);

    // Alter output 0 value
    const altered = {
      ...decoded,
      outputs: decoded.outputs.map((out, idx) =>
        idx === 0 ? { ...out, valueSatoshis: out.valueSatoshis - 10n } : out,
      ),
    };
    const alteredHex = binToHex(encodeTransaction(altered));
    const alteredReport = inspectSignedTransaction(
      lockTx.unsigned.txHex,
      alteredHex,
      lockTx.unsigned.sourceOutputs,
    );
    expect(alteredReport.ok).toBe(false);
    expect(alteredReport.problems[0]).toMatch(/Output 0 was altered/i);

    // Corrupt a signature byte in input 0 to fail VM verification
    const badSigUnlocking = Uint8Array.from(
      decoded.inputs[0]!.unlockingBytecode,
    );
    badSigUnlocking[10] = (badSigUnlocking[10]! ^ 0xff) & 0xff;
    const badSigTx = {
      ...decoded,
      inputs: decoded.inputs.map((inp, idx) =>
        idx === 0 ? { ...inp, unlockingBytecode: badSigUnlocking } : inp,
      ),
    };
    const wrongSignedHex = binToHex(encodeTransaction(badSigTx));
    const wrongReport = inspectSignedTransaction(
      lockTx.unsigned.txHex,
      wrongSignedHex,
      lockTx.unsigned.sourceOutputs,
    );
    expect(wrongReport.ok).toBe(false);
    expect(wrongReport.problems[0]).toMatch(/Script check failed/i);
  });
});
