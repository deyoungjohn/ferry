import { hexToBin, binToHex, sha256 as libauthSha256 } from '@bitauth/libauth';
import type { BchChainPort, BchUtxo } from '@ferry/user-flow';
import {
  DEFAULT_MAINNET_FULCRUM,
  createBchReader,
  type BchServerClient,
} from './bch-reader';

export { DEFAULT_MAINNET_FULCRUM };

type FulcrumLike = BchServerClient;

export interface BrowserBchChainOptions {
  readonly urls?: readonly string[];
  readonly solverUrl?: string | undefined;
  readonly fetchFn?: typeof fetch;
  readonly createClient?: (url: string) => FulcrumLike;
}

/** The Electrum script hash of a locking bytecode: SHA-256, byte-reversed, in hex. */
export function scriptHashOf(lockingBytecodeHex: string): string {
  const clean = lockingBytecodeHex.replace(/^0x/, '');
  return binToHex(libauthSha256.hash(hexToBin(clean)).reverse());
}

type UtxoRow = Awaited<ReturnType<FulcrumLike['listUnspent']>>[number];

function rowToUtxo(row: UtxoRow): BchUtxo {
  return {
    txid: row.tx_hash,
    vout: row.tx_pos,
    satoshis: BigInt(row.value),
    ...(row.token_data
      ? {
          token: {
            category: row.token_data.category,
            amount: BigInt(row.token_data.amount),
          },
          ...(row.token_data.nft
            ? {
                nft: {
                  ...(row.token_data.nft.capability
                    ? { capability: row.token_data.nft.capability }
                    : {}),
                  ...(row.token_data.nft.commitment !== undefined
                    ? { commitment: row.token_data.nft.commitment }
                    : {}),
                },
              }
            : {}),
        }
      : {}),
  };
}

/**
 * Bitcoin Cash reads and broadcast for the page: the solver first over HTTPS,
 * then the public Fulcrum servers over `wss` only when the solver is unreachable.
 */
export function createBrowserBchChain(
  options: BrowserBchChainOptions = {},
): BchChainPort {
  const reader = createBchReader({
    solverUrl: options.solverUrl,
    fallbackUrls:
      options.urls && options.urls.length > 0
        ? options.urls
        : DEFAULT_MAINNET_FULCRUM,
    ...(options.fetchFn ? { fetchFn: options.fetchFn } : {}),
    ...(options.createClient ? { createClient: options.createClient } : {}),
  });

  function toUtxos(rows: readonly UtxoRow[]): BchUtxo[] {
    return rows.map(rowToUtxo);
  }

  return {
    async getTipHeight(): Promise<number> {
      return (await reader.getTip()).height;
    },
    async getUtxos(lockingBytecodeHex: string): Promise<readonly BchUtxo[]> {
      return toUtxos(await reader.getUtxos(scriptHashOf(lockingBytecodeHex)));
    },
    async getUtxosMany(
      lockingBytecodeHexes: readonly string[],
    ): Promise<ReadonlyMap<string, readonly BchUtxo[]>> {
      const rows = await reader.getUtxosMany(
        lockingBytecodeHexes.map(scriptHashOf),
      );
      const result = new Map<string, BchUtxo[]>();
      for (const hex of lockingBytecodeHexes) {
        const utxos = toUtxos(rows.get(scriptHashOf(hex)) ?? []);
        utxos.sort((a, b) => {
          if (a.token && b.token && a.token.category === b.token.category) {
            if (b.token.amount !== a.token.amount) {
              return b.token.amount > a.token.amount ? 1 : -1;
            }
          }
          if (b.satoshis !== a.satoshis) {
            return b.satoshis > a.satoshis ? 1 : -1;
          }
          return a.txid.localeCompare(b.txid);
        });
        result.set(hex, utxos);
      }
      return result;
    },
    async broadcast(txHex: string): Promise<string> {
      return reader.broadcast(txHex);
    },
  };
}
