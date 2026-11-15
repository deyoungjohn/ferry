import { describe, expect, it } from 'vitest';
import {
  binToHex,
  hexToBin,
  lockingBytecodeToCashAddress,
} from '@bitauth/libauth';
import { parseExtendedJson, toBigInt, toUint8Array } from '@wizardconnect/core';
import {
  buildLockTransaction,
  buildWizardConnectSignRequest,
  serializeForRelay,
  stringifyRelayPayload,
} from '../src/index.js';

const HASH_LOCK = new Uint8Array(32).fill(0x12);
const RECIPIENT = new Uint8Array([
  0x76,
  0xa9,
  0x14,
  ...new Uint8Array(20).fill(0xaa),
  0x88,
  0xac,
]);
const REFUND = new Uint8Array([
  0x76,
  0xa9,
  0x14,
  ...new Uint8Array(20).fill(0xbb),
  0x88,
  0xac,
]);
const CHANGE = new Uint8Array([
  0x76,
  0xa9,
  0x14,
  ...new Uint8Array(20).fill(0xcc),
  0x88,
  0xac,
]);
const CHANGE_ADDRESS = (
  lockingBytecodeToCashAddress({
    bytecode: CHANGE,
    prefix: 'bchtest',
    tokenSupport: false,
  }) as { address: string }
).address;
const DISPLAY_CATEGORY =
  'ec335fd3ffa45f80cef7217cf98e8adf562df5a3e33f354f69df2951703586ac';

describe('WizardConnect signing request builder and relay serializer', () => {
  it('serializes BigInt and Uint8Array and round-trips through @wizardconnect/core', () => {
    const sample = {
      amount: 123_456_789_012_345_678n,
      bytes: new Uint8Array([0xde, 0xad, 0xbe, 0xef]),
      nested: [{ fee: 500n }],
    };

    expect(() => JSON.stringify(sample)).toThrow(TypeError);
    const json = stringifyRelayPayload(sample);
    const parsed = parseExtendedJson(json) as {
      amount: bigint;
      bytes: string;
      nested: Array<{ fee: bigint }>;
    };

    expect(parsed.amount).toBe(123_456_789_012_345_678n);
    expect(parsed.nested[0]?.fee).toBe(500n);
    expect(toUint8Array(parsed.bytes)).toEqual(sample.bytes);
    expect(serializeForRelay(undefined)).toBeUndefined();
  });

  it('builds a WizardConnect sign request with per-input paths and round-trips relay sourceOutputs', () => {
    const lockTx = buildLockTransaction({
      params: {
        hashLock: HASH_LOCK,
        recipientLockingBytecode: RECIPIENT,
        refundLockingBytecode: REFUND,
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
          lockingBytecode: REFUND,
          derivationPath: ['receive', 0],
          token: { category: DISPLAY_CATEGORY, amount: 600n },
        },
        {
          txid: '22'.repeat(32),
          vout: 1,
          satoshis: 4000n,
          lockingBytecode: CHANGE,
          derivationPath: ['change', 3],
          token: { category: DISPLAY_CATEGORY, amount: 500n },
        },
      ],
      changeAddress: CHANGE_ADDRESS,
    });

    const request = buildWizardConnectSignRequest({
      lockTx,
      userPrompt: 'Lock 10.00 tPUSD',
    });

    expect(request.inputPaths).toEqual([
      [0, 'receive', 0],
      [1, 'change', 3],
    ]);
    expect(request.transaction.broadcast).toBe(false);
    expect(request.relayTransaction.transaction).toBe(lockTx.unsigned.txHex);

    const relayJson = JSON.stringify(request.relayTransaction);
    const revived = parseExtendedJson(relayJson) as {
      transaction: string;
      sourceOutputs: Array<{
        outpointTransactionHash: string;
        outpointIndex: number;
        unlockingBytecode: string;
        sequenceNumber: number;
        valueSatoshis: bigint;
        lockingBytecode: string;
        token: { category: string; amount: bigint };
      }>;
    };

    expect(revived.sourceOutputs).toHaveLength(2);
    for (let i = 0; i < revived.sourceOutputs.length; i++) {
      const orig = lockTx.unsigned.sourceOutputs[i]!;
      const back = revived.sourceOutputs[i]!;
      expect(toBigInt(back.valueSatoshis)).toBe(orig.valueSatoshis);
      expect(toUint8Array(back.lockingBytecode)).toEqual(orig.lockingBytecode);
      expect(binToHex(toUint8Array(back.outpointTransactionHash))).toBe(
        binToHex(orig.outpointTransactionHash),
      );
      expect(toUint8Array(back.token.category)).toEqual(
        hexToBin(binToHex(orig.token!.category)),
      );
      expect(toBigInt(back.token.amount)).toBe(orig.token!.amount);
    }
  });
});
