import {
  binToHex,
  decodeTransaction,
  hexToBin,
  sha256,
} from '@bitauth/libauth';
import { FulcrumClient } from '@ferry/htlc-bch';
import {
  scanBchFry1Transactions,
  type BchFry1Tx,
  type BchWalletSwap,
} from '@ferry/recover-cli/wallet-scan';
import type { Hex32 } from '@ferry/core';

export interface BchHistoryAddress {
  lockingBytecodeHex: string;
}

export interface BchHistoryClient {
  connect(): Promise<void>;
  close(): void;
  getHistory(scriptHash: string): Promise<Array<{ tx_hash: string }>>;
  getTransaction(txid: string): Promise<unknown>;
}

export interface BchHistoryOptions {
  root: Hex32;
  addresses: readonly BchHistoryAddress[];
  urls: readonly string[];
  network?: 'mainnet' | 'chipnet';
  createClient?: (url: string) => BchHistoryClient;
  batchSize?: number;
  maxTransactions?: number;
  onProgress?: (progress: { message: string; scanned: number }) => void;
}

function scriptHashOf(lockingBytecodeHex: string): string {
  return binToHex(
    sha256.hash(hexToBin(lockingBytecodeHex.replace(/^0x/, ''))).reverse(),
  );
}

export async function readBchWalletTransactions(
  input: BchHistoryOptions,
): Promise<BchFry1Tx[]> {
  const createClient =
    input.createClient ?? ((url: string) => new FulcrumClient(url));
  const batchSize = Math.max(1, input.batchSize ?? 8);
  const maxTransactions = input.maxTransactions ?? 400;
  const seen = new Set<string>();
  const txids: string[] = [];
  let client: BchHistoryClient | null = null;
  const failures: string[] = [];

  for (const url of input.urls) {
    const candidate = createClient(url);
    try {
      await candidate.connect();
      client = candidate;
      break;
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
      candidate.close();
    }
  }
  if (!client) {
    throw new Error(
      `No Bitcoin Cash server answered (${failures.join('; ')}).`,
    );
  }

  try {
    for (const [index, address] of input.addresses.entries()) {
      input.onProgress?.({
        message: `Reading Bitcoin Cash address history (${index + 1}/${input.addresses.length})…`,
        scanned: index + 1,
      });
      const history = await client.getHistory(
        scriptHashOf(address.lockingBytecodeHex),
      );
      for (const item of history) {
        if (seen.has(item.tx_hash)) continue;
        if (txids.length >= maxTransactions) break;
        seen.add(item.tx_hash);
        txids.push(item.tx_hash);
      }
      if (txids.length >= maxTransactions) break;
    }

    const transactions: BchFry1Tx[] = [];
    for (let start = 0; start < txids.length; start += batchSize) {
      const batch = txids.slice(start, start + batchSize);
      const raws = await Promise.all(
        batch.map((txid) => client!.getTransaction(txid)),
      );
      for (const [offset, rawValue] of raws.entries()) {
        const txid = batch[offset]!;
        if (typeof rawValue !== 'string') continue;
        const transaction = decodeTransaction(
          hexToBin(rawValue.replace(/^0x/, '')),
        );
        if (typeof transaction === 'string') continue;
        transactions.push({
          txid,
          outputs: transaction.outputs.map((output) => ({
            lockingBytecode: `0x${binToHex(output.lockingBytecode)}`,
          })),
        });
      }
      input.onProgress?.({
        message: `Reading Bitcoin Cash transactions (${Math.min(
          start + batchSize,
          txids.length,
        )}/${txids.length})…`,
        scanned: txids.length,
      });
    }
    return transactions;
  } finally {
    client.close();
  }
}

export async function scanBchWalletHistory(
  input: BchHistoryOptions,
): Promise<BchWalletSwap[]> {
  const transactions = await readBchWalletTransactions(input);
  return scanBchFry1Transactions({
    root: input.root,
    transactions,
    network: input.network ?? 'mainnet',
  }).swaps;
}
