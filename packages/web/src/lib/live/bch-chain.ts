import { hexToBin, binToHex, sha256 as libauthSha256 } from '@bitauth/libauth';
import { FulcrumClient } from '@ferry/htlc-bch';
import type { BchChainPort, BchUtxo } from '@ferry/user-flow';
import { readBchTipHeight } from '../solver/tip';

/** The two independent mainnet servers named in the blueprint. */
export const DEFAULT_MAINNET_FULCRUM = [
  'wss://bch.imaginary.cash:50004',
  'wss://blackie.c3-soft.com:50004',
] as const;

type FulcrumLike = Pick<
  FulcrumClient,
  'connect' | 'close' | 'listUnspent' | 'broadcast' | 'getTipHeight'
>;

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
          // An output that also holds an NFT must never be spent by a lock.
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
 * Bitcoin Cash reads and broadcast for the page: public Fulcrum servers over
 * `wss`, tried in order. A server that fails is skipped; if all fail the error
 * says so. The tip prefers the solver's own reading.
 */
export function createBrowserBchChain(
  options: BrowserBchChainOptions = {},
): BchChainPort {
  const urls = options.urls?.length ? options.urls : DEFAULT_MAINNET_FULCRUM;
  const make =
    options.createClient ?? ((url: string) => new FulcrumClient(url));

  async function withServer<T>(
    action: (client: FulcrumLike) => Promise<T>,
  ): Promise<T> {
    const failures: string[] = [];
    for (const url of urls) {
      const client = make(url);
      try {
        await client.connect();
        return await action(client);
      } catch (error) {
        failures.push(error instanceof Error ? error.message : String(error));
      } finally {
        client.close();
      }
    }
    throw new Error(
      `No Bitcoin Cash server answered (${failures.join('; ')}). Nothing was sent.`,
    );
  }

  return {
    async getTipHeight(): Promise<number> {
      try {
        return await readBchTipHeight(options.solverUrl, options.fetchFn);
      } catch {
        return withServer((client) => client.getTipHeight());
      }
    },
    async getUtxos(lockingBytecodeHex: string): Promise<readonly BchUtxo[]> {
      const scriptHash = scriptHashOf(lockingBytecodeHex);
      // Ask every server and merge what they say: one that lags behind answers "nothing"
      // for an output another already shows, and the first answer must not win.
      const fetchFn = options.fetchFn ?? fetch;
      const solverRead = async () => {
        if (!options.solverUrl) return [];
        const res = await fetchFn(
          `${options.solverUrl.replace(/\/+$/, '')}/v1/bch/utxos/${scriptHash}`,
        );
        if (!res.ok) throw new Error(`solver answered ${res.status}`);
        const body = (await res.json()) as {
          utxos?: Awaited<ReturnType<FulcrumLike['listUnspent']>>;
        };
        return body.utxos ?? [];
      };
      const answers = await Promise.allSettled([
        ...(options.solverUrl ? [solverRead()] : []),
        ...urls.map(async (url) => {
          const client = make(url);
          try {
            await client.connect();
            return await client.listUnspent(scriptHash, 'include_tokens');
          } finally {
            client.close();
          }
        }),
      ]);
      const seen = new Set<string>();
      const rows: Awaited<ReturnType<FulcrumLike['listUnspent']>> = [];
      for (const answer of answers) {
        if (answer.status !== 'fulfilled') continue;
        for (const row of answer.value) {
          const key = `${row.tx_hash}:${row.tx_pos}`;
          if (seen.has(key)) continue;
          seen.add(key);
          rows.push(row);
        }
      }
      if (answers.every((answer) => answer.status === 'rejected')) {
        const failures = answers.map((answer) =>
          answer.status === 'rejected'
            ? answer.reason instanceof Error
              ? answer.reason.message
              : String(answer.reason)
            : '',
        );
        throw new Error(
          `No Bitcoin Cash server answered (${failures.join('; ')}).`,
        );
      }
      return rows.map(rowToUtxo);
    },
    async getUtxosMany(
      lockingBytecodeHexes: readonly string[],
    ): Promise<ReadonlyMap<string, readonly BchUtxo[]>> {
      // One connection per server for all addresses; every server is asked and the answers are
      // merged, as for a single address.
      const result = new Map<string, BchUtxo[]>();
      for (const hex of lockingBytecodeHexes) result.set(hex, []);
      const seen = new Set<string>();
      const answers = await Promise.allSettled(
        urls.map(async (url) => {
          const client = make(url);
          try {
            await client.connect();
            return await Promise.all(
              lockingBytecodeHexes.map(
                async (hex) =>
                  [
                    hex,
                    await client.listUnspent(
                      scriptHashOf(hex),
                      'include_tokens',
                    ),
                  ] as const,
              ),
            );
          } finally {
            client.close();
          }
        }),
      );
      if (answers.every((answer) => answer.status === 'rejected')) {
        throw new Error('No Bitcoin Cash server answered.');
      }
      for (const answer of answers) {
        if (answer.status !== 'fulfilled') continue;
        for (const [hex, rows] of answer.value) {
          for (const row of rows) {
            const key = `${hex}:${row.tx_hash}:${row.tx_pos}`;
            if (seen.has(key)) continue;
            seen.add(key);
            result.get(hex)!.push(rowToUtxo(row));
          }
        }
      }
      for (const utxos of result.values()) {
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
      }
      return result;
    },
    async broadcast(txHex: string): Promise<string> {
      // Servers are tried only until one CONNECTS. After a send has gone out on one server it
      // is never repeated on another, because the first may have accepted it.
      const failures: string[] = [];
      for (const url of urls) {
        const client = make(url);
        try {
          await client.connect();
        } catch (error) {
          failures.push(error instanceof Error ? error.message : String(error));
          client.close();
          continue;
        }
        try {
          return await client.broadcast(txHex);
        } finally {
          client.close();
        }
      }
      throw new Error(
        `No Bitcoin Cash server answered (${failures.join('; ')}). Nothing was sent.`,
      );
    },
  };
}
