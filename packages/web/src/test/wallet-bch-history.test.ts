import { describe, expect, it } from 'vitest';
import { binToHex, decodeTransaction, hexToBin } from '@bitauth/libauth';
import { deriveRecoveryRoot, swapTagAt } from '@ferry/core';
import { encodeTermsOutput } from '@ferry/htlc-bch';
import {
  readBchWalletTransactions,
  scanBchWalletHistory,
} from '../lib/live/wallet-bch-history';
import type { BchServerClient } from '../lib/live/bch-reader';

const ROOT = deriveRecoveryRoot(`0x${'22'.repeat(64)}`);
const TAG = swapTagAt(ROOT, 0);
const TERMS = encodeTermsOutput({
  tag: TAG,
  token: 'PUSD',
  tokenAmount: 500n,
  refundHeight: 800_000,
  maxFee: 1500,
  recipientLockingBytecode: '0x76a914',
  refundLockingBytecode: '0x76a914',
});

function rawTransaction(script: Uint8Array): string {
  const bytes = new Uint8Array(4 + 1 + 1 + 8 + 1 + script.length + 4);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 1, true);
  bytes[4] = 0; // no inputs
  bytes[5] = 1; // one output
  view.setBigUint64(6, 0n, true);
  bytes[14] = script.length;
  bytes.set(script, 15);
  view.setUint32(15 + script.length, 0, true);
  return `0x${binToHex(bytes)}`;
}

function fakeClient(): BchServerClient {
  const raw = rawTransaction(TERMS);
  return {
    async connect() {},
    close() {},
    async listUnspent() {
      return [];
    },
    async getHistory() {
      return [{ tx_hash: 'aa'.repeat(32), height: 1 }];
    },
    async getTransaction() {
      return raw;
    },
    async broadcast() {
      return 'aa'.repeat(32);
    },
    async getTipHeight() {
      return 1;
    },
  };
}

describe('BCH wallet history scan', () => {
  it('finds a used address with history even when it has no UTXO now', async () => {
    const swaps = await scanBchWalletHistory({
      root: ROOT,
      addresses: [{ lockingBytecodeHex: '0x76a914' }],
      urls: ['fake'],
      createClient: fakeClient,
      network: 'mainnet',
    });
    expect(swaps).toHaveLength(1);
    expect(swaps[0]?.index).toBe(0);
    expect(swaps[0]?.terms.token).toBe('PUSD');
    expect(swaps[0]?.terms.tag).toBe(TAG);
  });

  it('reads transactions with one injected connection and exposes progress', async () => {
    let connects = 0;
    const progress: string[] = [];
    const transactions = await readBchWalletTransactions({
      root: ROOT,
      addresses: [{ lockingBytecodeHex: '0x76a914' }],
      urls: ['fake'],
      createClient: () => {
        connects += 1;
        return fakeClient();
      },
      onProgress: ({ message }) => progress.push(message),
    });
    expect(connects).toBe(1);
    expect(transactions).toHaveLength(1);
    expect(progress.some((line) => line.includes('address history'))).toBe(
      true,
    );
  });

  it('decodes the fixture transaction', () => {
    const decoded = decodeTransaction(hexToBin(rawTransaction(TERMS).slice(2)));
    expect(typeof decoded).not.toBe('string');
  });
});
