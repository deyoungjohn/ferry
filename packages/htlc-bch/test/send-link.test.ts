import { describe, expect, it } from 'vitest';
import {
  lockingBytecodeToCashAddress,
  ripemd160,
  secp256k1,
  sha256,
} from '@bitauth/libauth';
import { SEND_LINK_WINDOWS_SECONDS } from '@ferry/core';
import {
  buildClaimTransaction,
  buildRefundTransaction,
  buildSendLinkBchLock,
} from '../src/index.js';

const SENDER_PRIV = new Uint8Array(32).fill(0x41);
const SENDER_PKH = ripemd160.hash(
  sha256.hash(secp256k1.derivePublicKeyCompressed(SENDER_PRIV) as Uint8Array),
);
const SENDER_LOCKING = new Uint8Array([
  0x76,
  0xa9,
  0x14,
  ...SENDER_PKH,
  0x88,
  0xac,
]);
const SENDER_ADDRESS_RES = lockingBytecodeToCashAddress({
  bytecode: SENDER_LOCKING,
  prefix: 'bchtest',
  tokenSupport: false,
});
if (typeof SENDER_ADDRESS_RES === 'string') {
  throw new Error(SENDER_ADDRESS_RES);
}
const SENDER_ADDRESS = SENDER_ADDRESS_RES.address;

const SOLVER_PRIV = new Uint8Array(32).fill(0x42);
const SOLVER_PKH = ripemd160.hash(
  sha256.hash(secp256k1.derivePublicKeyCompressed(SOLVER_PRIV) as Uint8Array),
);
const SOLVER_LOCKING = new Uint8Array([
  0x76,
  0xa9,
  0x14,
  ...SOLVER_PKH,
  0x88,
  0xac,
]);

const SECRET = new Uint8Array(32).fill(0x55);
const HASH_LOCK = sha256.hash(SECRET);
const DISPLAY_CATEGORY =
  'ec335fd3ffa45f80cef7217cf98e8adf562df5a3e33f354f69df2951703586ac';

describe('send-link BCH recipient-bound lock builder (24h, 3d, 7d)', () => {
  it.each([
    ['24h', SEND_LINK_WINDOWS_SECONDS['24h']],
    ['3d', SEND_LINK_WINDOWS_SECONDS['3d']],
    ['7d', SEND_LINK_WINDOWS_SECONDS['7d']],
  ] as const)(
    'plans window %s and builds a BCH lock claimable by solver and refundable by sender',
    (_label, windowSeconds) => {
      const start = { unixSeconds: 1_794_764_200, bchTipHeight: 500_000 };
      const built = buildSendLinkBchLock({
        windowSeconds,
        start,
        senderLockingBytecode: SENDER_LOCKING,
        solverLockingBytecode: SOLVER_LOCKING,
        hashLock: HASH_LOCK,
        tokenCategory: DISPLAY_CATEGORY,
        tokenAmount: 1000n,
        maxFee: 1500n,
        carrySats: 3000n,
        utxos: [
          {
            txid: '11'.repeat(32),
            vout: 0,
            satoshis: 5000n,
            lockingBytecode: SENDER_LOCKING,
            derivationPath: ['receive', 0],
            token: { category: DISPLAY_CATEGORY, amount: 1000n },
          },
        ],
        changeAddress: SENDER_ADDRESS,
      });

      expect(built.plan.ok).toBe(true);
      if (!built.plan.ok) return;
      expect(built.plan.evmDeadlineSeconds).toBe(
        start.unixSeconds + windowSeconds,
      );
      expect(built.plan.bchRefundHeight).toBeGreaterThan(start.bchTipHeight);
      expect(built.lockTx.unsigned.txHex).toMatch(/^[0-9a-f]+$/);

      const htlcUtxo = {
        txid: built.lockTx.unsigned.txid,
        vout: 0,
        satoshis: 3000n,
      };
      const claimTx = buildClaimTransaction({
        params: built.params,
        utxo: htlcUtxo,
        secret: SECRET,
      });
      expect(claimTx.txHex).toMatch(/^[0-9a-f]+$/);

      const refundTx = buildRefundTransaction({
        params: built.params,
        utxo: htlcUtxo,
        locktime: built.plan.bchRefundHeight,
      });
      expect(refundTx.txHex).toMatch(/^[0-9a-f]+$/);
    },
  );
});
