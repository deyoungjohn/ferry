import { describe, expect, it } from 'vitest';
import {
  binToHex,
  decodeTransaction,
  encodeTransaction,
  hexToBin,
  ripemd160,
  secp256k1,
  sha256,
  type Transaction,
} from '@bitauth/libauth';
import { TransactionBuilder } from 'cashscript';
import {
  buildClaimTransaction,
  buildRefundTransaction,
  buildReleaseTransaction,
  deriveHtlcAddresses,
  displayHexToInternalHex,
  encodeHtlcParameters,
  getHtlcContract,
  verifyBchTransactionWithVm,
  verifyHtlcAddressMatch,
} from '../src/index.js';

const SECRET = new Uint8Array(32).fill(0x01);
const HASH_LOCK = sha256.hash(SECRET);
const RECIPIENT_BYTECODE = new Uint8Array([
  0x76,
  0xa9,
  0x14,
  ...new Uint8Array(20).fill(0x11),
  0x88,
  0xac,
]);
const REFUND_BYTECODE = new Uint8Array([
  0x76,
  0xa9,
  0x14,
  ...new Uint8Array(20).fill(0x22),
  0x88,
  0xac,
]);
const OTHER_BYTECODE = new Uint8Array([
  0x76,
  0xa9,
  0x14,
  ...new Uint8Array(20).fill(0x33),
  0x88,
  0xac,
]);
const DISPLAY_CATEGORY =
  'ec335fd3ffa45f80cef7217cf98e8adf562df5a3e33f354f69df2951703586ac';

const BASE_UTXO = {
  txid: '11'.repeat(32),
  vout: 0,
  satoshis: 3000n,
};

function baseParams() {
  return encodeHtlcParameters({
    hashLock: HASH_LOCK,
    recipientLockingBytecode: RECIPIENT_BYTECODE,
    refundLockingBytecode: REFUND_BYTECODE,
    tokenCategory: DISPLAY_CATEGORY,
    tokenAmount: 1000n,
    refundHeight: 500_000,
    maxFee: 1500n,
  });
}

describe('FerryHTLC Libauth VM suite (BCH-U-01 .. BCH-U-13)', () => {
  it('BCH-U-07: category byte-order mismatch makes a display-order instance unspendable', () => {
    const paramsInternal = baseParams();
    const paramsDisplayWrong = encodeHtlcParameters({
      hashLock: HASH_LOCK,
      recipientLockingBytecode: RECIPIENT_BYTECODE,
      refundLockingBytecode: REFUND_BYTECODE,
      tokenCategory: DISPLAY_CATEGORY,
      tokenCategoryIsInternal: true, // WRONG: treating display order as internal
      tokenAmount: 1000n,
      refundHeight: 500_000,
      maxFee: 1500n,
    });

    expect(binToHex(paramsInternal.tokenCategory)).toBe(
      displayHexToInternalHex(DISPLAY_CATEGORY),
    );
    const derivedGood = deriveHtlcAddresses(paramsInternal);
    const derivedBad = deriveHtlcAddresses(paramsDisplayWrong);
    expect(derivedGood.tokenAddress).not.toBe(derivedBad.tokenAddress);

    expect(
      verifyHtlcAddressMatch(
        {
          hashLock: HASH_LOCK,
          recipientLockingBytecode: RECIPIENT_BYTECODE,
          refundLockingBytecode: REFUND_BYTECODE,
          tokenCategory: DISPLAY_CATEGORY,
          tokenAmount: 1000n,
          refundHeight: 500_000,
          maxFee: 1500n,
        },
        derivedGood.tokenAddress,
      ).matches,
    ).toBe(true);
    expect(
      verifyHtlcAddressMatch(
        {
          hashLock: HASH_LOCK,
          recipientLockingBytecode: RECIPIENT_BYTECODE,
          refundLockingBytecode: REFUND_BYTECODE,
          tokenCategory: DISPLAY_CATEGORY,
          tokenAmount: 1000n,
          refundHeight: 500_000,
          maxFee: 1500n,
        },
        derivedBad.tokenAddress,
      ).matches,
    ).toBe(false);

    // Building a claim against the wrong-order contract funded with display category fails in VM
    const wrongContract = getHtlcContract(paramsDisplayWrong);
    const wrongUtxo = {
      txid: BASE_UTXO.txid,
      vout: BASE_UTXO.vout,
      satoshis: BigInt(BASE_UTXO.satoshis),
      lockingBytecode: wrongContract.lockingBytecode,
      token: {
        category: DISPLAY_CATEGORY,
        amount: paramsDisplayWrong.tokenAmount,
      },
    };
    const wrongBuilder = new TransactionBuilder({
      provider: wrongContract.provider,
    });
    wrongBuilder.addInput(wrongUtxo, wrongContract.unlock.claim(SECRET));
    wrongBuilder.addOutput({
      to: RECIPIENT_BYTECODE,
      amount: BigInt(BASE_UTXO.satoshis) - 500n,
      token: {
        category: DISPLAY_CATEGORY,
        amount: paramsDisplayWrong.tokenAmount,
      },
    });
    const wrongTxHex = wrongBuilder.build();
    const wrongVmResult = verifyBchTransactionWithVm({
      transaction: wrongTxHex,
      sourceOutputs: [
        {
          lockingBytecode: hexToBin(wrongContract.lockingBytecode),
          valueSatoshis: BigInt(BASE_UTXO.satoshis),
          token: {
            category: hexToBin(DISPLAY_CATEGORY),
            amount: paramsDisplayWrong.tokenAmount,
          },
        },
      ],
    });
    expect(wrongVmResult).not.toBe(true);
  });

  it('rejects a UTXO whose lockingBytecode belongs to a different covenant', () => {
    const params = baseParams();
    const otherParams = {
      ...params,
      refundHeight: params.refundHeight + 10,
    };
    const otherContract = getHtlcContract(otherParams);
    const mismatchedUtxo = {
      ...BASE_UTXO,
      lockingBytecode: otherContract.lockingBytecode,
    };

    expect(() =>
      buildClaimTransaction({
        params,
        utxo: mismatchedUtxo,
        secret: SECRET,
      }),
    ).toThrow(/lockingBytecode/i);

    expect(() =>
      buildRefundTransaction({
        params,
        utxo: mismatchedUtxo,
      }),
    ).toThrow(/lockingBytecode/i);
  });

  it('BCH-U-01: claim with correct 32-byte secret and output succeeds', () => {
    const built = buildClaimTransaction({
      params: baseParams(),
      utxo: BASE_UTXO,
      secret: SECRET,
    });
    expect(built.txid).toMatch(/^[0-9a-f]{64}$/);
    expect(
      verifyBchTransactionWithVm({
        transaction: built.libauthTx,
        sourceOutputs: [built.sourceOutput],
      }),
    ).toBe(true);
  });

  it('BCH-U-02: claim rejects wrong or zero secret before building and in VM', () => {
    const params = baseParams();
    expect(() =>
      buildClaimTransaction({
        params,
        utxo: BASE_UTXO,
        secret: new Uint8Array(32).fill(0x02),
      }),
    ).toThrow(/Invalid claim secret/);

    expect(() =>
      buildClaimTransaction({
        params,
        utxo: BASE_UTXO,
        secret: new Uint8Array(32),
      }),
    ).toThrow(/Invalid claim secret/);

    // Also test VM directly with a wrong 32-byte secret
    const valid = buildClaimTransaction({
      params,
      utxo: BASE_UTXO,
      secret: SECRET,
    });
    const tx = decodeTransaction(hexToBin(valid.txHex)) as Transaction;
    const unlocking = new Uint8Array(tx.inputs[0]!.unlockingBytecode);
    unlocking[1] = (unlocking[1] ?? 0) ^ 0xff; // flip first byte of pushed 32-byte secret
    tx.inputs[0] = { ...tx.inputs[0]!, unlockingBytecode: unlocking };
    const vmRes = verifyBchTransactionWithVm({
      transaction: tx,
      sourceOutputs: [valid.sourceOutput],
    });
    expect(typeof vmRes).toBe('string');
  });

  it('BCH-U-03: claim rejects a 33-byte secret whose sha256 matches a crafted lock', () => {
    const secret33 = new Uint8Array(33).fill(0x07);
    const hash33 = sha256.hash(secret33);
    const params = encodeHtlcParameters({
      hashLock: hash33,
      recipientLockingBytecode: RECIPIENT_BYTECODE,
      refundLockingBytecode: REFUND_BYTECODE,
      tokenCategory: DISPLAY_CATEGORY,
      tokenAmount: 1000n,
      refundHeight: 500_000,
      maxFee: 1500n,
    });
    expect(() =>
      buildClaimTransaction({ params, utxo: BASE_UTXO, secret: secret33 }),
    ).toThrow(/Invalid claim secret/);
  });

  it('BCH-U-04: claim to a different locking bytecode is rejected by VM', () => {
    const built = buildClaimTransaction({
      params: baseParams(),
      utxo: BASE_UTXO,
      secret: SECRET,
    });
    const tx = decodeTransaction(hexToBin(built.txHex)) as Transaction;
    tx.outputs[0] = { ...tx.outputs[0]!, lockingBytecode: OTHER_BYTECODE };
    expect(
      verifyBchTransactionWithVm({
        transaction: tx,
        sourceOutputs: [built.sourceOutput],
      }),
    ).not.toBe(true);
  });

  it('BCH-U-05: claim with tokenAmount - 1 to recipient (+1 elsewhere) is rejected by VM', () => {
    const built = buildClaimTransaction({
      params: baseParams(),
      utxo: BASE_UTXO,
      secret: SECRET,
    });
    const tx = decodeTransaction(hexToBin(built.txHex)) as Transaction;
    tx.outputs[0] = {
      ...tx.outputs[0]!,
      token: { category: hexToBin(DISPLAY_CATEGORY), amount: 999n },
    };
    tx.outputs.push({
      lockingBytecode: OTHER_BYTECODE,
      valueSatoshis: 600n,
      token: { category: hexToBin(DISPLAY_CATEGORY), amount: 1n },
    });
    expect(
      verifyBchTransactionWithVm({
        transaction: tx,
        sourceOutputs: [built.sourceOutput],
      }),
    ).not.toBe(true);
  });

  it('BCH-U-06: claim burning more than maxFee is rejected by builder and VM', () => {
    const params = baseParams();
    expect(() =>
      buildClaimTransaction({
        params,
        utxo: BASE_UTXO,
        secret: SECRET,
        feeSats: 1501n,
      }),
    ).toThrow(/exceeds maxFee/);

    const built = buildClaimTransaction({
      params,
      utxo: BASE_UTXO,
      secret: SECRET,
    });
    const tx = decodeTransaction(hexToBin(built.txHex)) as Transaction;
    tx.outputs[0] = { ...tx.outputs[0]!, valueSatoshis: 1499n };
    expect(
      verifyBchTransactionWithVm({
        transaction: tx,
        sourceOutputs: [built.sourceOutput],
      }),
    ).not.toBe(true);
  });

  it('BCH-U-08 & BCH-U-09: refund enforces nLockTime >= refundHeight', () => {
    const params = baseParams();
    expect(() =>
      buildRefundTransaction({
        params,
        utxo: BASE_UTXO,
        locktime: params.refundHeight - 1,
      }),
    ).toThrow(/below refundHeight/);

    const built = buildRefundTransaction({ params, utxo: BASE_UTXO });
    expect(
      verifyBchTransactionWithVm({
        transaction: built.libauthTx,
        sourceOutputs: [built.sourceOutput],
      }),
    ).toBe(true);

    const tx = decodeTransaction(hexToBin(built.txHex)) as Transaction;
    tx.locktime = params.refundHeight - 1;
    expect(
      verifyBchTransactionWithVm({
        transaction: tx,
        sourceOutputs: [built.sourceOutput],
      }),
    ).not.toBe(true);
  });

  it('BCH-U-10: refund to claim recipient is rejected by VM', () => {
    const built = buildRefundTransaction({
      params: baseParams(),
      utxo: BASE_UTXO,
    });
    const tx = decodeTransaction(hexToBin(built.txHex)) as Transaction;
    tx.outputs[0] = { ...tx.outputs[0]!, lockingBytecode: RECIPIENT_BYTECODE };
    expect(
      verifyBchTransactionWithVm({
        transaction: tx,
        sourceOutputs: [built.sourceOutput],
      }),
    ).not.toBe(true);
  });

  it('BCH-U-11: claim after refundHeight is accepted by VM (documented race)', () => {
    const params = baseParams();
    const built = buildClaimTransaction({
      params,
      utxo: BASE_UTXO,
      secret: SECRET,
    });
    const tx = decodeTransaction(hexToBin(built.txHex)) as Transaction;
    tx.locktime = params.refundHeight + 10;
    expect(
      verifyBchTransactionWithVm({
        transaction: tx,
        sourceOutputs: [built.sourceOutput],
      }),
    ).toBe(true);
  });

  it('BCH-U-12: extra input added (fee bump attempt) is rejected by VM', () => {
    const built = buildClaimTransaction({
      params: baseParams(),
      utxo: BASE_UTXO,
      secret: SECRET,
    });
    const tx = decodeTransaction(hexToBin(built.txHex)) as Transaction;
    tx.inputs.push({
      outpointIndex: 1,
      outpointTransactionHash: new Uint8Array(32).fill(0x99),
      sequenceNumber: 0xffffffff,
      unlockingBytecode: new Uint8Array(0),
    });
    const extraSource = {
      lockingBytecode: OTHER_BYTECODE,
      valueSatoshis: 1000n,
    };
    const encoded = binToHex(encodeTransaction(tx));
    expect(
      verifyBchTransactionWithVm({
        transaction: encoded,
        sourceOutputs: [built.sourceOutput, extraSource],
      }),
    ).not.toBe(true);
  });

  it('BCH-U-13: NFT or capability token in place of fungible token is rejected by VM', () => {
    const built = buildClaimTransaction({
      params: baseParams(),
      utxo: BASE_UTXO,
      secret: SECRET,
    });
    const nftData = {
      capability: 'mutable' as const,
      commitment: new Uint8Array([0x11, 0x22]),
    };
    const tx = decodeTransaction(hexToBin(built.txHex)) as Transaction;
    tx.outputs[0] = {
      ...tx.outputs[0]!,
      token: {
        ...tx.outputs[0]!.token!,
        nft: nftData,
      },
    };
    const nftSource = {
      ...built.sourceOutput,
      token: {
        ...built.sourceOutput.token,
        nft: nftData,
      },
    };
    expect(
      verifyBchTransactionWithVm({
        transaction: tx,
        sourceOutputs: [nftSource],
      }),
    ).not.toBe(true);
  });

  describe('Early release tests (BCH-U-14 .. BCH-U-20)', () => {
    const RECIPIENT_PRIV = new Uint8Array(32).fill(0x55);
    const RECIPIENT_PUB = secp256k1.derivePublicKeyCompressed(
      RECIPIENT_PRIV,
    ) as Uint8Array;
    const RECIPIENT_PKH = ripemd160.hash(sha256.hash(RECIPIENT_PUB));
    const REAL_RECIPIENT_LOCKING = new Uint8Array([
      0x76,
      0xa9,
      0x14,
      ...RECIPIENT_PKH,
      0x88,
      0xac,
    ]);

    const OTHER_PRIV = new Uint8Array(32).fill(0x77);

    function releaseParams() {
      return encodeHtlcParameters({
        hashLock: HASH_LOCK,
        recipientLockingBytecode: REAL_RECIPIENT_LOCKING,
        refundLockingBytecode: REFUND_BYTECODE,
        tokenCategory: DISPLAY_CATEGORY,
        tokenAmount: 1000n,
        refundHeight: 500_000,
        maxFee: 1500n,
      });
    }

    it('BCH-U-14: early release spend signed by recipient verifies cleanly in Libauth VM', () => {
      const built = buildReleaseTransaction({
        params: releaseParams(),
        utxo: BASE_UTXO,
        recipientPrivateKey: RECIPIENT_PRIV,
      });

      const verified = verifyBchTransactionWithVm({
        transaction: built.libauthTx,
        sourceOutputs: [built.sourceOutput],
      });
      expect(verified).toBe(true);

      // Verify the output pays to refundLockingBytecode
      expect(built.libauthTx.outputs[0]?.lockingBytecode).toEqual(
        REFUND_BYTECODE,
      );
      expect(built.libauthTx.outputs[0]?.token?.amount).toBe(1000n);
    });

    it('BCH-U-15: early release spend with unauthorized key is rejected', () => {
      expect(() =>
        buildReleaseTransaction({
          params: releaseParams(),
          utxo: BASE_UTXO,
          recipientPrivateKey: OTHER_PRIV,
        }),
      ).toThrow(/Recipient private key does not match/);
    });

    it('BCH-U-16: early release spend redirected to non-refund output is rejected by VM', () => {
      const built = buildReleaseTransaction({
        params: releaseParams(),
        utxo: BASE_UTXO,
        recipientPrivateKey: RECIPIENT_PRIV,
      });
      const tx = decodeTransaction(hexToBin(built.txHex)) as Transaction;
      tx.outputs[0] = {
        ...tx.outputs[0]!,
        lockingBytecode: OTHER_BYTECODE,
      };
      expect(
        verifyBchTransactionWithVm({
          transaction: tx,
          sourceOutputs: [built.sourceOutput],
        }),
      ).not.toBe(true);
    });

    it('BCH-U-17: early release spend tampering with token amount or category is rejected by VM', () => {
      const built = buildReleaseTransaction({
        params: releaseParams(),
        utxo: BASE_UTXO,
        recipientPrivateKey: RECIPIENT_PRIV,
      });
      const txAmount = decodeTransaction(hexToBin(built.txHex)) as Transaction;
      txAmount.outputs[0] = {
        ...txAmount.outputs[0]!,
        token: {
          ...txAmount.outputs[0]!.token!,
          amount: 500n, // Less tokens refunded!
        },
      };
      expect(
        verifyBchTransactionWithVm({
          transaction: txAmount,
          sourceOutputs: [built.sourceOutput],
        }),
      ).not.toBe(true);

      const txCat = decodeTransaction(hexToBin(built.txHex)) as Transaction;
      txCat.outputs[0] = {
        ...txCat.outputs[0]!,
        token: {
          ...txCat.outputs[0]!.token!,
          category: new Uint8Array(32).fill(0x88),
        },
      };
      expect(
        verifyBchTransactionWithVm({
          transaction: txCat,
          sourceOutputs: [built.sourceOutput],
        }),
      ).not.toBe(true);
    });

    it('BCH-U-18: early release spend with fee exceeding maxFee is rejected by VM', () => {
      const built = buildReleaseTransaction({
        params: releaseParams(),
        utxo: BASE_UTXO,
        recipientPrivateKey: RECIPIENT_PRIV,
      });
      const tx = decodeTransaction(hexToBin(built.txHex)) as Transaction;
      // Burning more fee than maxFee allowed
      tx.outputs[0] = {
        ...tx.outputs[0]!,
        valueSatoshis: BASE_UTXO.satoshis - 2000n, // maxFee is 1500n
      };
      expect(
        verifyBchTransactionWithVm({
          transaction: tx,
          sourceOutputs: [built.sourceOutput],
        }),
      ).not.toBe(true);
    });

    it('BCH-U-19: early release spend with extra input or output is rejected by VM', () => {
      const built = buildReleaseTransaction({
        params: releaseParams(),
        utxo: BASE_UTXO,
        recipientPrivateKey: RECIPIENT_PRIV,
      });
      const txOut = decodeTransaction(hexToBin(built.txHex)) as Transaction;
      txOut.outputs.push({
        lockingBytecode: OTHER_BYTECODE,
        valueSatoshis: 546n,
      });
      expect(
        verifyBchTransactionWithVm({
          transaction: txOut,
          sourceOutputs: [built.sourceOutput],
        }),
      ).not.toBe(true);

      const txIn = decodeTransaction(hexToBin(built.txHex)) as Transaction;
      txIn.inputs.push({
        outpointIndex: 1,
        outpointTransactionHash: new Uint8Array(32).fill(0x99),
        sequenceNumber: 0xffffffff,
        unlockingBytecode: new Uint8Array(0),
      });
      expect(
        verifyBchTransactionWithVm({
          transaction: txIn,
          sourceOutputs: [
            built.sourceOutput,
            { lockingBytecode: OTHER_BYTECODE, valueSatoshis: 1000n },
          ],
        }),
      ).not.toBe(true);
    });

    it('BCH-U-20: legacy covenant (v1) lock can still be refunded cleanly via useLegacyArtifact', () => {
      const legacyParams = baseParams();
      const legacyAddresses = deriveHtlcAddresses(legacyParams, 'chipnet', {
        useLegacyArtifact: true,
      });
      const builtRefund = buildRefundTransaction({
        params: legacyParams,
        utxo: BASE_UTXO,
        useLegacyArtifact: true,
      });
      const verifiedRefund = verifyBchTransactionWithVm({
        transaction: builtRefund.libauthTx,
        sourceOutputs: [builtRefund.sourceOutput],
      });
      expect(verifiedRefund).toBe(true);
      expect(builtRefund.sourceOutput.lockingBytecode).toEqual(
        legacyAddresses.lockingBytecode,
      );
    });
  });
});
