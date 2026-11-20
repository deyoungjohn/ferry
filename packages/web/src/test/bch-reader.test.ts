import { describe, expect, it } from 'vitest';
import {
  BCH_UNAVAILABLE_MESSAGE,
  createBchReader,
  type BchServerClient,
} from '../lib/live/bch-reader';
import { scanFundingAddresses } from '../lib/wallet/funding-scan';
import { addressFromPubkey } from '../lib/bch/address';

const ROW = {
  tx_hash: 'aa'.repeat(32),
  tx_pos: 0,
  value: 1000,
  height: 800_000,
};

function client(options: {
  log: string[];
  url: string;
  failConnect?: boolean;
  failTransaction?: boolean;
  onBroadcast?: (txHex: string) => Promise<string>;
}): BchServerClient {
  return {
    async connect() {
      options.log.push(`connect ${options.url}`);
      if (options.failConnect) throw new Error('WebSocket error');
    },
    close() {
      options.log.push(`close ${options.url}`);
    },
    async listUnspent() {
      return [ROW];
    },
    async getHistory() {
      return [{ tx_hash: ROW.tx_hash, height: ROW.height }];
    },
    async getFirstUse() {
      return {
        tx_hash: ROW.tx_hash,
        block_height: ROW.height,
        block_hash: '',
      };
    },
    async getTransaction() {
      if (options.failTransaction) throw new Error('not found');
      return '00';
    },
    async broadcast(txHex: string) {
      return options.onBroadcast ? options.onBroadcast(txHex) : `txid-${txHex}`;
    },
    async getTipHeight() {
      return 900;
    },
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe('Bitcoin Cash reader through the solver', () => {
  it('uses the solver and opens no direct connection while it answers', async () => {
    const log: string[] = [];
    const calls: string[] = [];
    const reader = createBchReader({
      solverUrl: 'https://solver.test',
      fallbackUrls: ['wss://a'],
      fetchFn: (async (input: RequestInfo | URL) => {
        calls.push(String(input));
        if (String(input).includes('/utxos/')) return json({ utxos: [ROW] });
        return json({ height: 1234, hash: '00', timestamp: 1 });
      }) as typeof fetch,
      createClient: (url) => client({ log, url }),
    });

    expect(await reader.getUtxos('11'.repeat(32))).toHaveLength(1);
    expect(await reader.getTip()).toEqual({
      height: 1234,
      hash: '00',
      timestamp: 1,
    });
    expect(log).toEqual([]);
    expect(calls).toHaveLength(2);
  });

  it('falls back once, keeps the fallback for a minute, then tries the solver again', async () => {
    let now = 1_000;
    let fetches = 0;
    const log: string[] = [];
    const reader = createBchReader({
      solverUrl: 'https://solver.test',
      fallbackUrls: ['wss://a'],
      now: () => now,
      fetchFn: (async () => {
        fetches += 1;
        throw new TypeError('Failed to fetch');
      }) as typeof fetch,
      createClient: (url) => client({ log, url }),
    });

    await reader.getUtxos('11'.repeat(32));
    await reader.getUtxos('22'.repeat(32));
    expect(fetches).toBe(1);
    expect(log.filter((line) => line.startsWith('connect'))).toEqual([
      'connect wss://a',
    ]);

    now += 61_000;
    await reader.getUtxos('33'.repeat(32));
    expect(fetches).toBe(2);
    expect(log.filter((line) => line.startsWith('connect'))).toEqual([
      'connect wss://a',
    ]);
  });

  it('does not fall back when the solver returns a 4xx answer', async () => {
    const log: string[] = [];
    const reader = createBchReader({
      solverUrl: 'https://solver.test',
      fallbackUrls: ['wss://a'],
      fetchFn: (async () => json({ error: {} }, 404)) as typeof fetch,
      createClient: (url) => client({ log, url }),
    });
    let failed = false;
    try {
      await reader.getUtxos('11'.repeat(32));
    } catch {
      failed = true;
    }
    expect(failed).toBe(true);
    expect(log).toEqual([]);
  });

  it('says plainly when the solver and every public server fail', async () => {
    const log: string[] = [];
    const reader = createBchReader({
      solverUrl: 'https://solver.test',
      fallbackUrls: ['wss://a', 'wss://b'],
      fetchFn: (async () => {
        throw new TypeError('Failed to fetch');
      }) as typeof fetch,
      createClient: (url) => client({ log, url, failConnect: true }),
    });
    try {
      await reader.getUtxos('11'.repeat(32));
      throw new Error('expected a failure');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      const message = (error as Error).message;
      expect(message).toBe(BCH_UNAVAILABLE_MESSAGE);
      expect(message).not.toMatch(/WebSocket|Failed to fetch/);
      expect((error as { details?: string[] }).details?.length).toBe(3);
    }
  });

  it('opens one connection per public server across many addresses', async () => {
    const log: string[] = [];
    const reader = createBchReader({
      fallbackUrls: ['wss://a', 'wss://b'],
      createClient: (url) => client({ log, url }),
    });
    await reader.getUtxosMany(['11'.repeat(32), '22'.repeat(32)]);
    await reader.getUtxosMany(['33'.repeat(32)]);
    expect(log.filter((line) => line.startsWith('connect'))).toEqual([
      'connect wss://a',
      'connect wss://b',
    ]);
  });

  it('looks a transaction up before retrying a broadcast with an uncertain answer', async () => {
    const log: string[] = [];
    let broadcasts = 0;
    const calls: string[] = [];
    const reader = createBchReader({
      solverUrl: 'https://solver.test',
      fallbackUrls: ['wss://a'],
      fetchFn: (async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push(`${init?.method ?? 'GET'} ${String(input)}`);
        if (init?.method === 'POST') throw new TypeError('connection lost');
        if (String(input).includes('/v1/bch/tx/')) return json({ hex: '00' });
        return json({ utxos: [] });
      }) as typeof fetch,
      createClient: (url) =>
        client({
          log,
          url,
          onBroadcast: async () => {
            broadcasts += 1;
            return 'retried';
          },
        }),
    });

    await expect(reader.broadcast('00')).resolves.toMatch(/^[0-9a-f]{64}$/);
    expect(broadcasts).toBe(0);
    expect(calls.some((line) => line.startsWith('POST '))).toBe(true);
  });

  it('retries a broadcast on a public server after a 5xx and does not send twice', async () => {
    let now = 0;
    let sends = 0;
    const log: string[] = [];
    const reader = createBchReader({
      solverUrl: 'https://solver.test',
      fallbackUrls: ['wss://a', 'wss://b'],
      now: () => now,
      fetchFn: (async (input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === 'POST') return json({}, 503);
        if (String(input).includes('/v1/bch/tx/')) return json({}, 404);
        return json({ utxos: [] });
      }) as typeof fetch,
      createClient: (url) =>
        client({
          log,
          url,
          failTransaction: true,
          onBroadcast: async () => {
            sends += 1;
            return 'sent-once';
          },
        }),
    });
    now = 0;
    await expect(reader.broadcast('00')).resolves.toBe('sent-once');
    expect(sends).toBe(1);
    expect(log.filter((line) => line.startsWith('connect'))).toEqual([
      'connect wss://a',
      'connect wss://b',
    ]);
  });

  it('keeps a 2,000-address funding scan to two reads per address', async () => {
    let historyReads = 0;
    let utxoReads = 0;
    const hashes = new Set<string>();
    const reader = {
      async getHistory(scriptHash: string) {
        historyReads += 1;
        hashes.add(scriptHash);
        return [{ tx_hash: 'aa'.repeat(32), height: 1 }];
      },
      async getUtxosMany(requested: readonly string[]) {
        utxoReads += requested.length;
        return new Map(requested.map((hash) => [hash, []]));
      },
      async getFirstUse() {
        return null;
      },
      async getTransaction() {
        return '';
      },
      async broadcast() {
        return '';
      },
      async getTip() {
        return { height: 1, hash: '', timestamp: 0 };
      },
      async getUtxos(scriptHash: string) {
        return (await this.getUtxosMany([scriptHash])).get(scriptHash) ?? [];
      },
    };
    const result = await scanFundingAddresses({
      getPubkey: (child, index) => {
        const bytes = new Uint8Array(33);
        bytes[0] = 2;
        bytes[1] = child;
        new DataView(bytes.buffer).setUint32(2, Number(index), false);
        return bytes;
      },
      reader,
      gapLimit: 2000,
      maxAddresses: 2000,
      batchSize: 50,
    });
    expect(result.searched).toBe(2000);
    expect(historyReads).toBe(2000);
    expect(utxoReads).toBe(2000);
    expect(hashes.size).toBe(2000);
  });
});

describe('funding address derivation fixture', () => {
  it('keeps the script-hash helper stable for the tests above', () => {
    const pub = new Uint8Array(33);
    pub[0] = 2;
    expect(addressFromPubkey(pub).lockingBytecode).toMatch(/^0x/);
  });
});
