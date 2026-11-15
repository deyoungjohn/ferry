import { describe, expect, it } from 'vitest';
import * as libauth from '@bitauth/libauth';
import { compileCashAssemblyString, parseTemplate } from '@xo-cash/utils';
import {
  ferryHtlcTemplate,
  getParsedFerryHtlcTemplate,
  serializeFerryHtlcTemplate,
} from '../xo/index.js';
import {
  artifact,
  displayHexToInternalHex,
  encodeHtlcParameters,
  getHtlcContract,
} from '../src/index.js';

describe('XO Template: ferry-htlc (BCH-E-01)', () => {
  it('parses and serializes cleanly with serializeTemplate', () => {
    const parsed = getParsedFerryHtlcTemplate();
    expect(parsed.name).toBe('Ferry HTLC');
    expect(parsed.actions.lock).toBeDefined();
    expect(parsed.actions.claim).toBeDefined();
    expect(parsed.actions.refund).toBeDefined();

    const serialized = serializeFerryHtlcTemplate();
    expect(typeof serialized).toBe('string');
    const reparsed = parseTemplate(serialized);
    expect(reparsed.name).toBe('Ferry HTLC');
  });

  it('BCH-E-01: XO locking bytecode is byte-identical to CashScript artifact locking bytecode', () => {
    const secret = new Uint8Array(32).fill(0x01);
    const hashLock = libauth.sha256.hash(secret);
    const recipientBytecode = new Uint8Array([
      0x76,
      0xa9,
      0x14,
      ...new Uint8Array(20).fill(0x11),
      0x88,
      0xac,
    ]);
    const refundBytecode = new Uint8Array([
      0x76,
      0xa9,
      0x14,
      ...new Uint8Array(20).fill(0x22),
      0x88,
      0xac,
    ]);
    const displayCatHex =
      'ec335fd3ffa45f80cef7217cf98e8adf562df5a3e33f354f69df2951703586ac';
    const internalCatHex = displayHexToInternalHex(displayCatHex);

    const params = encodeHtlcParameters({
      hashLock,
      recipientLockingBytecode: recipientBytecode,
      refundLockingBytecode: refundBytecode,
      tokenCategory: displayCatHex,
      tokenAmount: 1000n,
      refundHeight: 500_000,
      maxFee: 1500n,
    });

    const cashScriptContract = getHtlcContract(params);
    const cashScriptRedeemHex = cashScriptContract.bytecode;

    const fixedBytecode = artifact.bytecode.replace(
      '20 OP_NUMEQUALVERIFY',
      '<32> OP_NUMEQUALVERIFY',
    );
    const xoScript =
      `<1500> <500000> <1000> <0x${internalCatHex}> <0x${libauth.binToHex(refundBytecode)}> <0x${libauth.binToHex(recipientBytecode)}> <0x${libauth.binToHex(hashLock)}> ` +
      fixedBytecode;

    const xoRedeemHex = compileCashAssemblyString({
      cashAssemblyText: xoScript,
      variables: {},
      evaluationDecodeMode: 'hex',
    });

    expect(xoRedeemHex).toBe(cashScriptRedeemHex);

    const xoRedeemBytes = libauth.hexToBin(xoRedeemHex);
    const xoHash256 = libauth.sha256.hash(libauth.sha256.hash(xoRedeemBytes));
    const xoLockingHex = libauth.binToHex(
      new Uint8Array([0xaa, 0x20, ...xoHash256, 0x87]),
    );
    expect(xoLockingHex).toBe(cashScriptContract.lockingBytecode);

    // Also verify the template's own htlcLockingBytecode script matches
    const tplRedeemHex = compileCashAssemblyString({
      cashAssemblyText: 'htlcLockingBytecode',
      templateScripts: ferryHtlcTemplate.scripts,
      variables: {
        hashLock,
        recipientLockingBytecode: recipientBytecode,
        refundLockingBytecode: refundBytecode,
        tokenCategory: libauth.hexToBin(internalCatHex),
        tokenAmount: 1000,
        refundHeight: 500000,
        maxFee: 1500,
      },
      evaluationDecodeMode: 'hex',
    });
    expect(tplRedeemHex).toBe(cashScriptRedeemHex);
  });
});
