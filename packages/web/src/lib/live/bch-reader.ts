import { binToHex, hexToBin, sha256 } from '@bitauth/libauth';
import {
  FulcrumClient,
  type ElectrumFirstUse,
  type ElectrumHistoryItem,
  type ElectrumUtxo,
} from '@ferry/htlc-bch';

export const DEFAULT_MAINNET_FULCRUM = [
  'wss://bch.imaginary.cash:50004',
  'wss://blackie.c3-soft.com:50004',
] as const;

export const BCH_UNAVAILABLE_MESSAGE =
  'Could not reach Bitcoin Cash: the Ferry server did not answer and neither did the public servers. Check your connection and try again.';
export const BCH_BROADCAST_UNCERTAIN_MESSAGE =
  'Could not confirm the Bitcoin Cash broadcast. Check the transaction before trying again.';
const FALLBACK_MS = 60_000;

export interface BchTip {
  readonly height: number;
  readonly hash: string;
  readonly timestamp: number;
}

export interface BchServerClient {
  connect(): Promise<void>;
  close(): void;
  listUnspent(
    scriptHash: string,
    mode: 'include_tokens',
  ): Promise<ElectrumUtxo[]>;
  getHistory?(scriptHash: string): Promise<ElectrumHistoryItem[]>;
  getFirstUse?(scriptHash: string): Promise<ElectrumFirstUse | null>;
  getTransaction?(txid: string): Promise<unknown>;
  broadcast?(txHex: string): Promise<string>;
  getTipHeight?(): Promise<number>;
}

export interface BchReaderOptions {
  readonly solverUrl?: string | undefined;
  readonly fallbackUrls?: readonly string[];
  readonly fetchFn?: typeof fetch;
  readonly createClient?: (url: string) => BchServerClient;
  readonly now?: () => number;
}

export interface BchReader {
  getUtxos(scriptHash: string): Promise<readonly ElectrumUtxo[]>;
  getUtxosMany(
    scriptHashes: readonly string[],
  ): Promise<ReadonlyMap<string, readonly ElectrumUtxo[]>>;
  getHistory(scriptHash: string): Promise<readonly ElectrumHistoryItem[]>;
  getFirstUse(scriptHash: string): Promise<ElectrumFirstUse | null>;
  getTransaction(txid: string): Promise<string>;
  broadcast(txHex: string): Promise<string>;
  getTip(): Promise<BchTip>;
}

class FallbackSignal extends Error {
  constructor(readonly detail: string) {
    super(detail);
  }
}

export class BchAnswerError extends Error {
  constructor(
    message: string,
    readonly detail: string,
  ) {
    super(message);
    this.name = 'BchAnswerError';
  }
}

export class BchReadError extends Error {
  constructor(
    message: string,
    readonly details: string[],
  ) {
    super(message);
    this.name = 'BchReadError';
  }
}

function solverRoot(url: string): string {
  return url.replace(/\/+$/, '');
}

function txidOf(txHex: string): string {
  const clean = txHex.replace(/^0x/, '');
  const bytes = hexToBin(clean);
  return binToHex(sha256.hash(sha256.hash(bytes)).reverse());
}

function earliest(items: readonly ElectrumFirstUse[]): ElectrumFirstUse | null {
  if (items.length === 0) return null;
  return [...items].sort((a, b) => a.block_height - b.block_height)[0]!;
}

function uniqueHistory(
  answers: readonly (readonly ElectrumHistoryItem[])[],
): ElectrumHistoryItem[] {
  const byHash = new Map<string, ElectrumHistoryItem>();
  for (const answer of answers) {
    for (const item of answer) {
      const previous = byHash.get(item.tx_hash);
      if (!previous || item.height > previous.height) {
        byHash.set(item.tx_hash, item);
      }
    }
  }
  return [...byHash.values()];
}

export function createBchReader(options: BchReaderOptions = {}): BchReader {
  const fetchFn = options.fetchFn ?? fetch;
  const fallbackUrls = options.fallbackUrls?.length
    ? options.fallbackUrls
    : DEFAULT_MAINNET_FULCRUM;
  const make =
    options.createClient ?? ((url: string) => new FulcrumClient(url));
  const now = options.now ?? Date.now;
  const clients = new Map<string, Promise<BchServerClient>>();
  let fallbackUntil = 0;

  async function clientFor(url: string): Promise<BchServerClient> {
    const existing = clients.get(url);
    if (existing) return existing;
    const created = (async () => {
      const client = make(url);
      try {
        await client.connect();
        return client;
      } catch (error) {
        client.close();
        throw error;
      }
    })();
    clients.set(url, created);
    try {
      return await created;
    } catch (error) {
      clients.delete(url);
      throw error;
    }
  }

  async function allClients(): Promise<BchServerClient[]> {
    const answers = await Promise.allSettled(fallbackUrls.map(clientFor));
    return answers.flatMap((answer) =>
      answer.status === 'fulfilled' ? [answer.value] : [],
    );
  }

  function plainFailure(details: readonly string[]): BchReadError {
    return new BchReadError(BCH_UNAVAILABLE_MESSAGE, [...details]);
  }

  async function solverRead<T>(
    path: string,
    parse: (body: unknown) => T,
  ): Promise<T> {
    if (!options.solverUrl) {
      throw new FallbackSignal('no solver URL is configured');
    }
    if (now() < fallbackUntil) {
      throw new FallbackSignal('the solver is in its fallback window');
    }
    let response: Response;
    try {
      response = await fetchFn(`${solverRoot(options.solverUrl)}${path}`);
    } catch (error) {
      throw new FallbackSignal(
        error instanceof Error ? error.message : String(error),
      );
    }
    if (response.status >= 500) {
      throw new FallbackSignal(`the Ferry server answered ${response.status}`);
    }
    if (!response.ok) {
      throw new BchAnswerError(
        `The Ferry server could not read Bitcoin Cash (HTTP ${response.status}). Try again later.`,
        `solver ${path} answered ${response.status}`,
      );
    }
    try {
      return parse(await response.json());
    } catch (error) {
      throw new FallbackSignal(
        `the Ferry server sent an invalid answer: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  async function direct<T>(
    action: (clients: readonly BchServerClient[]) => Promise<T>,
  ): Promise<T> {
    const active = await allClients();
    if (active.length === 0) {
      throw plainFailure(fallbackUrls.map((url) => `${url}: did not connect`));
    }
    try {
      return await action(active);
    } catch (error) {
      throw plainFailure([
        error instanceof Error ? error.message : String(error),
      ]);
    }
  }

  async function read<T>(
    path: string,
    parse: (body: unknown) => T,
    action: (clients: readonly BchServerClient[]) => Promise<T>,
  ): Promise<T> {
    try {
      return await solverRead(path, parse);
    } catch (error) {
      if (!(error instanceof FallbackSignal)) throw error;
      fallbackUntil = now() + FALLBACK_MS;
      try {
        return await direct(action);
      } catch (fallbackError) {
        if (fallbackError instanceof BchReadError) {
          fallbackError.details.unshift(error.detail);
        }
        throw fallbackError;
      }
    }
  }

  async function getUtxosMany(
    scriptHashes: readonly string[],
  ): Promise<ReadonlyMap<string, readonly ElectrumUtxo[]>> {
    const result = new Map<string, ElectrumUtxo[]>();
    for (const hash of scriptHashes) result.set(hash, []);
    if (scriptHashes.length === 0) return result;

    const answers = await Promise.all(
      scriptHashes.map(async (scriptHash) => {
        const rows = await read(
          `/v1/bch/utxos/${scriptHash}`,
          (body) => {
            const utxos = (body as { utxos?: ElectrumUtxo[] }).utxos;
            if (!Array.isArray(utxos)) throw new Error('missing utxos');
            return utxos;
          },
          async (clients) => {
            const serverAnswers = await Promise.allSettled(
              clients.map((client) =>
                client.listUnspent(scriptHash, 'include_tokens'),
              ),
            );
            const rows: ElectrumUtxo[] = [];
            for (const answer of serverAnswers) {
              if (answer.status === 'fulfilled') rows.push(...answer.value);
            }
            if (
              serverAnswers.length > 0 &&
              serverAnswers.every((answer) => answer.status === 'rejected')
            ) {
              throw new Error('every public server refused the address');
            }
            return rows;
          },
        );
        return [scriptHash, rows] as const;
      }),
    );

    for (const [scriptHash, rows] of answers) {
      const seen = new Set<string>();
      for (const row of rows) {
        const key = `${row.tx_hash}:${row.tx_pos}`;
        if (seen.has(key)) continue;
        seen.add(key);
        result.get(scriptHash)!.push(row);
      }
    }
    return result;
  }

  const reader: BchReader = {
    async getUtxos(scriptHash) {
      return (await getUtxosMany([scriptHash])).get(scriptHash) ?? [];
    },
    getUtxosMany,
    async getHistory(scriptHash) {
      return read(
        `/v1/bch/history/${scriptHash}`,
        (body) => {
          const history = (body as { history?: ElectrumHistoryItem[] }).history;
          if (!Array.isArray(history)) throw new Error('missing history');
          return history;
        },
        async (clients) => {
          const answers = await Promise.allSettled(
            clients.map((client) =>
              client.getHistory
                ? client.getHistory(scriptHash)
                : Promise.resolve([]),
            ),
          );
          const fulfilled = answers.flatMap((answer) =>
            answer.status === 'fulfilled' ? [answer.value] : [],
          );
          if (answers.length > 0 && fulfilled.length === 0) {
            throw new Error('every public server refused the address history');
          }
          return uniqueHistory(fulfilled);
        },
      );
    },
    async getFirstUse(scriptHash) {
      return read(
        `/v1/bch/first-use/${scriptHash}`,
        (body) => {
          const value = body as {
            txHash?: string | null;
            height?: number | null;
          };
          if (value.txHash === null || value.txHash === undefined) return null;
          return {
            tx_hash: value.txHash,
            block_height: value.height ?? 0,
            block_hash: '',
          };
        },
        async (clients) => {
          const answers = await Promise.allSettled(
            clients.map((client) => {
              if (client.getFirstUse) return client.getFirstUse(scriptHash);
              if (client.getHistory) {
                return client.getHistory(scriptHash).then((history) => {
                  const item = [...history].sort(
                    (a, b) => a.height - b.height,
                  )[0];
                  return item
                    ? {
                        tx_hash: item.tx_hash,
                        block_height: item.height,
                        block_hash: '',
                      }
                    : null;
                });
              }
              return Promise.resolve(null);
            }),
          );
          const fulfilled = answers.flatMap((answer) =>
            answer.status === 'fulfilled' && answer.value ? [answer.value] : [],
          );
          return earliest(fulfilled);
        },
      );
    },
    async getTransaction(txid) {
      return read(
        `/v1/bch/tx/${txid}`,
        (body) => {
          const hex = (body as { hex?: string }).hex;
          if (typeof hex !== 'string') throw new Error('missing transaction');
          return hex;
        },
        async (clients) => {
          const errors: string[] = [];
          for (const client of clients) {
            if (!client.getTransaction) continue;
            try {
              const raw = await client.getTransaction(txid);
              if (typeof raw === 'string') return raw;
            } catch (error) {
              errors.push(
                error instanceof Error ? error.message : String(error),
              );
            }
          }
          throw new Error(
            errors.join('; ') || 'no server returned the transaction',
          );
        },
      );
    },
    async broadcast(txHex) {
      const txid = txidOf(txHex);
      if (!options.solverUrl || now() < fallbackUntil) {
        return directBroadcast(
          txid,
          txHex,
          'the solver could not be used for the broadcast',
        );
      }
      let response: Response;
      try {
        response = await fetchFn(
          `${solverRoot(options.solverUrl)}/v1/bch/broadcast`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ hex: txHex }),
          },
        );
      } catch (error) {
        fallbackUntil = now() + FALLBACK_MS;
        return recoverBeforeRetry(
          txid,
          txHex,
          error instanceof Error ? error.message : String(error),
        );
      }
      if (response.status >= 500) {
        fallbackUntil = now() + FALLBACK_MS;
        return recoverBeforeRetry(txid, txHex, `HTTP ${response.status}`);
      }
      if (!response.ok) {
        let reason = `HTTP ${response.status}`;
        try {
          const body = (await response.json()) as {
            error?: { message?: string };
          };
          if (body.error?.message) reason = body.error.message;
        } catch {
          // Keep the status when the refusal body is not JSON.
        }
        throw new BchAnswerError(
          `The Ferry server refused the Bitcoin Cash transaction: ${reason}`,
          `solver broadcast answered ${response.status}: ${reason}`,
        );
      }
      try {
        const body = (await response.json()) as { txid?: string };
        if (body.txid) return body.txid;
      } catch {
        // Look the transaction up before deciding what happened.
      }
      return recoverBeforeRetry(txid, txHex, 'the answer had no txid');
    },
    async getTip() {
      return read(
        '/v1/bch/tip',
        (body) => {
          const value = body as {
            height?: number;
            hash?: string;
            timestamp?: number;
          };
          if (!Number.isInteger(value.height) || (value.height ?? 0) <= 0) {
            throw new Error('missing tip height');
          }
          return {
            height: value.height!,
            hash: value.hash ?? '',
            timestamp: value.timestamp ?? 0,
          };
        },
        async (clients) => {
          for (const client of clients) {
            if (!client.getTipHeight) continue;
            const height = await client.getTipHeight();
            if (height > 0) return { height, hash: '', timestamp: 0 };
          }
          throw new Error('no public server returned a tip');
        },
      );
    },
  };
  return reader;

  async function recoverBeforeRetry(
    txid: string,
    txHex: string,
    detail: string,
  ): Promise<string> {
    try {
      await reader.getTransaction(txid);
      return txid;
    } catch {
      return directBroadcast(txid, txHex, detail);
    }
  }

  async function directBroadcast(
    txid: string,
    txHex: string,
    detail: string,
  ): Promise<string> {
    const errors: string[] = [];
    for (const url of fallbackUrls) {
      let client: BchServerClient;
      try {
        client = await clientFor(url);
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
        continue;
      }
      if (!client.broadcast) continue;
      try {
        return await client.broadcast(txHex);
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
        try {
          const raw = client.getTransaction
            ? await client.getTransaction(txid)
            : null;
          if (typeof raw === 'string') return txid;
        } catch {
          // The transaction could not be confirmed either.
        }
        throw new BchReadError(BCH_BROADCAST_UNCERTAIN_MESSAGE, [
          ...errors,
          detail,
        ]);
      }
    }
    throw new BchReadError(BCH_UNAVAILABLE_MESSAGE, [...errors, detail]);
  }
}
