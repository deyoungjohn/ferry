import { describe, expect, it } from 'vitest';
import { binToHex, hexToBin, sha256 } from '@bitauth/libauth';
import {
  buildClaimTransaction,
  buildRefundTransaction,
  deriveHtlcAddresses,
  encodeHtlcParameters,
  parseHtlcRedeemScript,
  parseHtlcSpendInput,
} from '../src/index.js';

const SECRET = new Uint8Array(32).fill(0x01);
const HASH_LOCK = sha256.hash(SECRET);
const RECIPIENT = new Uint8Array([
  0x76,
  0xa9,
  0x14,
  ...new Uint8Array(20).fill(0x11),
  0x88,
  0xac,
]);
const REFUND = new Uint8Array([
  0x76,
  0xa9,
  0x14,
  ...new Uint8Array(20).fill(0x22),
  0x88,
  0xac,
]);
const DISPLAY_CATEGORY =
  'ec335fd3ffa45f80cef7217cf98e8adf562df5a3e33f354f69df2951703586ac';

describe('redeem-script parser and spend-input parser', () => {
  it('round-trips small and boundary integer amounts (1, 16, 17, 127, 128, 255, 65535) and refundHeight=5', () => {
    const amounts = [1n, 16n, 17n, 127n, 128n, 255n, 65535n];
    for (const tokenAmount of amounts) {
      const params = encodeHtlcParameters({
        hashLock: HASH_LOCK,
        recipientLockingBytecode: RECIPIENT,
        refundLockingBytecode: REFUND,
        tokenCategory: DISPLAY_CATEGORY,
        tokenAmount,
        refundHeight: 5,
        maxFee: 1500n,
      });
      const derived = deriveHtlcAddresses(params);
      const parsed = parseHtlcRedeemScript(derived.redeemScript);
      expect(parsed).not.toBeNull();
      expect(parsed?.tokenAmount).toBe(tokenAmount);
      expect(parsed?.refundHeight).toBe(5);
      expect(parsed?.maxFee).toBe(1500n);
      expect(binToHex(parsed!.hashLock)).toBe(binToHex(params.hashLock));
      expect(binToHex(parsed!.tokenCategory)).toBe(
        binToHex(params.tokenCategory),
      );
    }
  });

  it('rejects a foreign script or mutated redeem script', () => {
    expect(parseHtlcRedeemScript(RECIPIENT)).toBeNull();
    const params = encodeHtlcParameters({
      hashLock: HASH_LOCK,
      recipientLockingBytecode: RECIPIENT,
      refundLockingBytecode: REFUND,
      tokenCategory: DISPLAY_CATEGORY,
      tokenAmount: 100n,
      refundHeight: 500_000,
      maxFee: 1500n,
    });
    const derived = deriveHtlcAddresses(params);
    const mutated = new Uint8Array(derived.redeemScript);
    const lastIdx = mutated.length - 1;
    mutated[lastIdx] = (mutated[lastIdx] ?? 0) ^ 0xff;
    expect(parseHtlcRedeemScript(mutated)).toBeNull();
  });

  it('parses claim and refund spend inputs from real builders', () => {
    const params = encodeHtlcParameters({
      hashLock: HASH_LOCK,
      recipientLockingBytecode: RECIPIENT,
      refundLockingBytecode: REFUND,
      tokenCategory: DISPLAY_CATEGORY,
      tokenAmount: 255n,
      refundHeight: 5,
      maxFee: 1500n,
    });
    const utxo = { txid: '11'.repeat(32), vout: 0, satoshis: 3000n };

    const claim = buildClaimTransaction({ params, utxo, secret: SECRET });
    const claimTx = claim.libauthTx as {
      inputs: Array<{ unlockingBytecode: Uint8Array }>;
    };
    const claimInfo = parseHtlcSpendInput(claimTx.inputs[0]!.unlockingBytecode);
    expect(claimInfo).not.toBeNull();
    expect(claimInfo?.path).toBe('claim');
    expect(binToHex(claimInfo!.secret!)).toBe(binToHex(SECRET));
    expect(claimInfo?.params.tokenAmount).toBe(255n);

    const refund = buildRefundTransaction({ params, utxo });
    const refundTx = refund.libauthTx as {
      inputs: Array<{ unlockingBytecode: Uint8Array }>;
    };
    const refundInfo = parseHtlcSpendInput(
      refundTx.inputs[0]!.unlockingBytecode,
    );
    expect(refundInfo).not.toBeNull();
    expect(refundInfo?.path).toBe('refund');
    expect(refundInfo?.secret).toBeNull();
    expect(binToHex(refundInfo!.lockingBytecode)).toBe(
      binToHex(
        hexToBin(
          claim.sourceOutput.lockingBytecode
            ? binToHex(claim.sourceOutput.lockingBytecode)
            : '',
        ),
      ),
    );
  });
});
