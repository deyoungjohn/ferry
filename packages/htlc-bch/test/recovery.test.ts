import { describe, expect, it } from 'vitest';
import { binToHex, hexToBin, sha256 } from '@bitauth/libauth';
import { buildRecoveryFile, orderId, type RecoveryTerms } from '@ferry/core';
import {
  buildBchRecoveryTransaction,
  deriveHtlcAddresses,
  encodeHtlcParameters,
} from '../src/index.js';

const SECRET =
  '0x0101010101010101010101010101010101010101010101010101010101010101' as const;
const HASH_LOCK =
  `0x${binToHex(sha256.hash(hexToBin(SECRET.slice(2))))}` as const;

function makeTerms(direction: 'EVM_TO_BCH' | 'BCH_TO_EVM'): RecoveryTerms {
  return {
    version: 1,
    direction,
    bchToken: 'PUSD',
    bchTokenCategory:
      '0xec335fd3ffa45f80cef7217cf98e8adf562df5a3e33f354f69df2951703586ac',
    bchTokenAmount: 1000n,
    evmAmount: 10050000n,
    evmToken: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    evmChainId: 8453,
    evmHtlc: '0x5A0C062f4B7b8fF2263530e12bc15De9C836a641',
    userEvmAddress: '0x87Ea46fe296C1810eF234A8e8D782A2122deFaDd',
    userBchLockingBytecode:
      '0x76a914111111111111111111111111111111111111111188ac',
    solverEvmAddress: '0xC9ec91859Bdb598dC2eeE715934D8231478f7A70',
    solverBchLockingBytecode:
      '0x76a914222222222222222222222222222222222222222288ac',
    hashLock: HASH_LOCK,
    evmDeadline: 1794850000,
    bchRefundHeight: 500_000,
    bchCarrySats: 3000n,
    bchMaxFee: 1500n,
    quoteId: 'q-bch-rec-001',
    quoteExpiry: 1794764200,
    pricing: {
      refs: [
        {
          asset: 'PUSD',
          usdPrice: '0.998',
          source: 'cauldron',
          asOf: 1794764140,
        },
        {
          asset: 'USDC',
          usdPrice: '1.000',
          source: 'chainlink:base:usdc-usd',
          asOf: 1794764140,
        },
      ],
      spreadBps: 40,
      fixedFeeBase: 20n,
      rounding: 'floor',
    },
  };
}

async function makeFile(
  direction: 'EVM_TO_BCH' | 'BCH_TO_EVM',
  withSecret = true,
) {
  const terms = makeTerms(direction);
  const id = orderId(terms);
  const solverSignature = `0x${'ab'.repeat(65)}` as const;
  const params = encodeHtlcParameters(terms);
  const addrs = deriveHtlcAddresses(params, 'chipnet');
  const toHex = (bytes: Uint8Array) =>
    `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}` as `0x${string}`;

  return buildRecoveryFile({
    orderId: id,
    terms,
    solverSignature,
    ...(withSecret ? { secret: SECRET } : {}),
    createdAt: 1794764150,
    contracts: {
      evm: {
        chainId: 8453,
        htlcAddress: terms.evmHtlc,
        tokenAddress: terms.evmToken,
      },
      bch: {
        network: 'chipnet',
        htlcAddress: addrs.p2sh32Address,
        tokenAddress: addrs.tokenAddress,
        redeemScript: toHex(addrs.redeemScript),
        lockingBytecode: toHex(addrs.lockingBytecode),
      },
    },
  });
}

describe('BCH recovery transactions from RecoveryFile', () => {
  it('builds and VM-verifies user BCH claim for EVM_TO_BCH', async () => {
    const file = await makeFile('EVM_TO_BCH', true);
    const built = buildBchRecoveryTransaction({
      file,
      utxos: [
        {
          txid: 'aa'.repeat(32),
          vout: 0,
          satoshis: 3000n,
          lockingBytecode: file.contracts.bch.lockingBytecode,
        },
      ],
    });
    expect(built.action).toBe('claim');
    expect(built.txHex).toMatch(/^[0-9a-f]+$/);
    expect(built.txid).toMatch(/^[0-9a-f]{64}$/);
  });

  it('builds and VM-verifies user BCH refund for BCH_TO_EVM', async () => {
    const file = await makeFile('BCH_TO_EVM', false);
    const built = buildBchRecoveryTransaction({
      file,
      utxos: [
        {
          txid: 'bb'.repeat(32),
          vout: 1,
          satoshis: 3000n,
          lockingBytecode: file.contracts.bch.lockingBytecode,
        },
      ],
      locktime: file.terms.bchRefundHeight,
    });
    expect(built.action).toBe('refund');
    expect(built.txHex).toMatch(/^[0-9a-f]+$/);
  });

  it('rejects missing secret for EVM_TO_BCH claim or tampered contract lockingBytecode', async () => {
    const fileNoSecret = await makeFile('EVM_TO_BCH', false);
    expect(() =>
      buildBchRecoveryTransaction({
        file: fileNoSecret,
        utxos: [{ txid: 'aa'.repeat(32), vout: 0, satoshis: 3000n }],
      }),
    ).toThrow(/secret/i);

    const fileTampered = await makeFile('BCH_TO_EVM', false);
    fileTampered.contracts.bch.lockingBytecode = `0xaa20${'ff'.repeat(32)}87`;
    expect(() =>
      buildBchRecoveryTransaction({
        file: fileTampered,
        utxos: [{ txid: 'bb'.repeat(32), vout: 0, satoshis: 3000n }],
      }),
    ).toThrow(/lockingBytecode/i);
  });
});
