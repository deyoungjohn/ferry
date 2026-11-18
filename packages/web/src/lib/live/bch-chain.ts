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
      const rows = await withServer((client) =>
        client.listUnspent(scriptHash, 'include_tokens'),
      );
      return rows.map((row) => ({
        txid: row.tx_hash,
        vout: row.tx_pos,
        satoshis: BigInt(row.value),
        ...(row.token_data
          ? {
              token: {
                category: row.token_data.category,
                amount: BigInt(row.token_data.amount),
              },
            }
          : {}),
      }));
    },
    broadcast(txHex: string): Promise<string> {
      // A broadcast is not retried on another server after one may have taken it.
      const url = urls[0]!;
      const client = make(url);
      return client
        .connect()
        .then(() => client.broadcast(txHex))
        .finally(() => client.close());
    },
  };
}
