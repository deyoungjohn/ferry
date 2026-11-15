import { describe, expect, it } from 'vitest';
import {
  binToHex,
  lockingBytecodeToCashAddress,
  ripemd160,
  secp256k1,
  sha256,
} from '@bitauth/libauth';
import {
  buildLockTransaction,
  encodeHtlcParameters,
  selectLockInputs,
  verifySignedLockTransaction,
} from '../src/index.js';

const PRIV_KEY = new Uint8Array(32).fill(0x42);
const PUB_KEY = secp256k1.derivePublicKeyCompressed(PRIV_KEY) as Uint8Array;
const PKH = ripemd160.hash(sha256.hash(PUB_KEY));
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

const DISPLAY_CATEGORY =
  'ec335fd3ffa45f80cef7217cf98e8adf562df5a3e33f354f69df2951703586ac';

describe('lock builder, per-input derivation paths, and local VM verification', () => {
  const params = encodeHtlcParameters({
    hashLock: sha256.hash(new Uint8Array(32).fill(0x01)),
    recipientLockingBytecode: USER_LOCKING_BYTECODE,
    refundLockingBytecode: USER_LOCKING_BYTECODE,
    tokenCategory: DISPLAY_CATEGORY,
    tokenAmount: 500n,
    refundHeight: 500_000,
    maxFee: 1500n,
  });

  const utxos = [
    {
      txid: 'aa'.repeat(32),
      vout: 0,
      satoshis: 1000n,
      derivationPath: ['receive', 3] as ['receive', number],
      token: { category: DISPLAY_CATEGORY, amount: 800n },
    },
    {
      txid: 'bb'.repeat(32),
      vout: 1,
      satoshis: 5000n,
      derivationPath: ['change', 7] as ['change', number],
    },
    {
      txid: 'cc'.repeat(32),
      vout: 0,
      satoshis: 9000n,
      token: {
        category: DISPLAY_CATEGORY,
        amount: 1000n,
        nft: { capability: 'minting', commitment: '00' },
      },
    },
  ];

  it('selects fungible token + BCH UTXOs, ignores NFTs, and builds signed lock tx passing VM', () => {
    const selected = selectLockInputs({
      utxos,
      tokenCategory: DISPLAY_CATEGORY,
      tokenAmount: 500n,
      userAddress: USER_ADDRESS,
    });
    expect(selected.tokenInputs).toHaveLength(1);
    expect(selected.bchInputs).toHaveLength(1);
    expect(selected.tokenChangeAmount).toBe(300n);

    const res = buildLockTransaction({
      params,
      utxos,
      changeAddress: USER_ADDRESS,
      privateKey: PRIV_KEY,
    });

    expect(res.unsigned.derivationPaths).toEqual([
      [0, 'receive', 3],
      [1, 'change', 7],
    ]);
    expect(res.unsigned.wcSignRequest.derivationPaths).toEqual([
      [0, 'receive', 3],
      [1, 'change', 7],
    ]);
    expect(res.signed).toBeDefined();
    expect(res.htlcTokenAddress.startsWith('bchtest:r')).toBe(true);
    expect(res.tokenChangeAmount).toBe(300n);
    expect(res.bchChangeSats).toBeGreaterThan(0n);
  });

  it('verifySignedLockTransaction rejects unsigned transactions', () => {
    const res = buildLockTransaction({
      params,
      utxos,
      changeAddress: USER_ADDRESS,
    });
    expect(() =>
      verifySignedLockTransaction(
        res.unsigned.txHex,
        res.unsigned.sourceOutputs,
      ),
    ).toThrow(/unsigned/);
  });

  it('absorbs sub-dust BCH change into fee', () => {
    const exactUtxos = [
      {
        txid: 'dd'.repeat(32),
        vout: 0,
        satoshis: 4800n,
        token: { category: DISPLAY_CATEGORY, amount: 500n },
      },
    ];
    const res = buildLockTransaction({
      params,
      utxos: exactUtxos,
      changeAddress: USER_ADDRESS,
      feeSats: 1500n,
      bchCarrySats: 3000n,
      privateKey: PRIV_KEY,
    });
    // Remaining 300 sats < 546 dust -> absorbed into fee
    expect(res.bchChangeSats).toBe(0n);
    expect(res.feeSats).toBe(1800n);
    expect(binToHex(res.htlcLockingBytecode).length).toBeGreaterThan(0);
  });
});
