import { describe, expect, it } from 'vitest';
import { binToHex, sha256 } from '@bitauth/libauth';
import {
  deriveHtlcAddresses,
  encodeHtlcParameters,
  p2sh32LockingBytecodeFor,
} from '../src/index.js';
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

/**
 * Fixed example for the mainnet PUSD category. The expected values were
 * computed a second way, outside this code base: a double SHA-256 of the
 * redeem script and a from-scratch CashAddr checksum (checked first against
 * the CashAddr specification's published P2PKH vector).
 */
describe('P2SH32 vectors for the mainnet PUSD covenant', () => {
  const params = encodeHtlcParameters({
    hashLock: sha256.hash(new Uint8Array(32).fill(0x01)),
    recipientLockingBytecode: p2pkh(0x11),
    refundLockingBytecode: p2pkh(0x22),
    tokenCategory: TOKENS.PUSD,
    tokenAmount: 1000n,
    refundHeight: 500_000,
    maxFee: 1500n,
  });
  const derived = deriveHtlcAddresses(params, 'mainnet');

  it('hashes the redeem script to the expected locking bytecode', () => {
    const expected =
      'aa207ed19c765b84d95e564da72d22dedafd0c7cb1124f7deab09c8a2d3c77951e3087';
    expect(binToHex(derived.lockingBytecode)).toBe(expected);
    expect(binToHex(p2sh32LockingBytecodeFor(derived.redeemScript))).toBe(
      expected,
    );
  });

  it('encodes the expected plain and token-aware CashAddresses', () => {
    expect(derived.p2sh32Address).toBe(
      'bitcoincash:pdldr8rktwzdjhjkfknj6gk7mt7scl93zf8hm64snj9z60rhj50rq5030c29k',
    );
    expect(derived.tokenAddress).toBe(
      'bitcoincash:rdldr8rktwzdjhjkfknj6gk7mt7scl93zf8hm64snj9z60rhj50rqxudwptua',
    );
  });
});
