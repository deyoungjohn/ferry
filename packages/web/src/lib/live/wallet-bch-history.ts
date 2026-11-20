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

function scriptHashOf(lockingBytecodeHex: string): string {
  return binToHex(
    sha256.hash(hexToBin(lockingBytecodeHex.replace(/^0x/, ''))).reverse(),
  );
}

export async function readBchWalletTransactions(input: {
  addresses: readonly BchHistoryAddress[];
  urls: readonly string[];
  fetchTransaction?: (txid: string) => Promise<string>;
}): Promise<BchFry1Tx[]> {
  const seen = new Set<string>();
  const transactions: BchFry1Tx[] = [];
  const fetchTransaction =
    input.fetchTransaction ??
    (async (txid: string) => {
      let lastError: unknown;
      for (const url of input.urls) {
        const client = new FulcrumClient(url, { timeoutMs: 15_000 });
        try {
          await client.connect();
          return (await client.getTransaction(txid)) as string;
        } catch (error) {
          lastError = error;
        } finally {
          client.close();
        }
      }
      throw lastError instanceof Error
        ? lastError
        : new Error(`No Bitcoin Cash server answered for ${txid}`);
    });

  for (const address of input.addresses) {
    let lastError: unknown;
    let history: Array<{ tx_hash: string }> = [];
    for (const url of input.urls) {
      const client = new FulcrumClient(url, { timeoutMs: 15_000 });
      try {
        await client.connect();
        history = await client.getHistory(
          scriptHashOf(address.lockingBytecodeHex),
        );
        break;
      } catch (error) {
        lastError = error;
      } finally {
        client.close();
      }
    }
    if (history.length === 0 && lastError !== undefined) {
      throw lastError instanceof Error
        ? lastError
        : new Error('No Bitcoin Cash history server answered');
    }
    for (const item of history) {
      if (seen.has(item.tx_hash)) continue;
      seen.add(item.tx_hash);
      const raw = await fetchTransaction(item.tx_hash);
      const transaction = decodeTransaction(hexToBin(raw.replace(/^0x/, '')));
      if (typeof transaction === 'string') continue;
      transactions.push({
        txid: item.tx_hash,
        outputs: transaction.outputs.map((output) => ({
          lockingBytecode: `0x${binToHex(output.lockingBytecode)}`,
        })),
      });
    }
  }
  return transactions;
}

export async function scanBchWalletHistory(input: {
  root: Hex32;
  addresses: readonly BchHistoryAddress[];
  urls: readonly string[];
  network?: 'mainnet' | 'chipnet';
}): Promise<BchWalletSwap[]> {
  const transactions = await readBchWalletTransactions(input);
  return scanBchFry1Transactions({
    root: input.root,
    transactions,
    network: input.network ?? 'mainnet',
  }).swaps;
}
