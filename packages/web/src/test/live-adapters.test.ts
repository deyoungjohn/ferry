import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MAINNET_FULCRUM,
  createBrowserBchChain,
  scriptHashOf,
} from '../lib/live/bch-chain';
import { createLocalRecoveryStore } from '../lib/live/recovery-store';
import { bchSignerFromWallet, evmSignerFromWallet } from '../lib/live/ports';
import type { BchWallet, EvmWallet } from '../lib/wallet/types';

/** The message of a rejection, read by hand (the shared-worker runner breaks toThrow). */
async function rejection(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error('expected the promise to reject');
}

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => void map.delete(k),
    setItem: (k, v) => void map.set(k, v),
  };
}

describe('script hash', () => {
  it('is the reversed SHA-256 of the locking bytecode', () => {
    const locking = `76a914${'00'.repeat(20)}88ac`;
    const expected = createHash('sha256')
      .update(Buffer.from(locking, 'hex'))
      .digest()
      .reverse()
      .toString('hex');
    expect(scriptHashOf(locking)).toBe(expected);
    expect(scriptHashOf(`0x${locking}`)).toBe(expected);
  });
});

describe('browser Bitcoin Cash chain', () => {
  const row = {
    tx_hash: 'aa'.repeat(32),
    tx_pos: 1,
    value: 1000,
    height: 5,
    token_data: { category: 'bb'.repeat(32), amount: '250' },
  };

  function fake(behaviour: Record<string, 'fail' | 'ok'>, log: string[]) {
    return (url: string) => ({
      connect: async () => {
        log.push(`connect ${url}`);
        if (behaviour[url] === 'fail') throw new Error(`down ${url}`);
      },
      close: () => undefined,
      listUnspent: async () => [row],
      broadcast: async () => 'txid-from-' + url,
      getTipHeight: async () => 900,
    });
  }

  it('reads funding outputs and keeps the token data', async () => {
    const chain = createBrowserBchChain({
      urls: ['wss://a'],
      createClient: fake({}, []),
    });
    const utxos = await chain.getUtxos(`76a914${'11'.repeat(20)}88ac`);
    expect(utxos).toEqual([
      {
        txid: row.tx_hash,
        vout: 1,
        satoshis: 1000n,
        token: { category: row.token_data.category, amount: 250n },
      },
    ]);
  });

  it('skips a server that is down and says so when all are', async () => {
    const log: string[] = [];
    const chain = createBrowserBchChain({
      urls: ['wss://a', 'wss://b'],
      createClient: fake({ 'wss://a': 'fail' }, log),
    });
    await chain.getUtxos('76a914' + '22'.repeat(20) + '88ac');
    expect(log).toEqual(['connect wss://a', 'connect wss://b']);

    const dead = createBrowserBchChain({
      urls: ['wss://a'],
      createClient: fake({ 'wss://a': 'fail' }, []),
    });
    expect(await rejection(dead.getUtxos('00'))).toMatch(/Nothing was sent/);
  });

  it('broadcasts on the next server when the first cannot connect', async () => {
    const log: string[] = [];
    const chain = createBrowserBchChain({
      urls: ['wss://a', 'wss://b'],
      createClient: fake({ 'wss://a': 'fail' }, log),
    });
    expect(await chain.broadcast('00')).toBe('txid-from-wss://b');
    expect(log).toEqual(['connect wss://a', 'connect wss://b']);
  });

  it('never repeats a send on another server after one went out', async () => {
    const log: string[] = [];
    const chain = createBrowserBchChain({
      urls: ['wss://a', 'wss://b'],
      createClient: (url: string) => ({
        connect: async () => {
          log.push(`connect ${url}`);
        },
        close: () => undefined,
        listUnspent: async () => [],
        broadcast: async () => {
          log.push(`send ${url}`);
          throw new Error('timeout after send');
        },
        getTipHeight: async () => 1,
      }),
    });
    expect(await rejection(chain.broadcast('00'))).toMatch(
      /timeout after send/,
    );
    expect(log).toEqual(['connect wss://a', 'send wss://a']);
  });

  it('keeps the NFT of an output so a lock never spends it', async () => {
    const nftRow = {
      ...row,
      token_data: {
        category: 'bb'.repeat(32),
        amount: '0',
        nft: { capability: 'none', commitment: '01' },
      },
    };
    const chain = createBrowserBchChain({
      urls: ['wss://a'],
      createClient: (url: string) => ({
        ...fake({}, [])(url),
        listUnspent: async () => [nftRow],
      }),
    });
    const [utxo] = await chain.getUtxos('76a914' + '33'.repeat(20) + '88ac');
    expect(utxo?.nft).toEqual({ capability: 'none', commitment: '01' });
  });

  it('prefers the solver tip and falls back to the server', async () => {
    const chain = createBrowserBchChain({
      urls: ['wss://a'],
      solverUrl: 'https://solver.test',
      fetchFn: (async (url: string) =>
        String(url).includes('/v1/health')
          ? new Response(JSON.stringify({ tips: { bchHeight: 1234 } }))
          : new Response('', { status: 500 })) as unknown as typeof fetch,
      createClient: fake({}, []),
    });
    expect(await chain.getTipHeight()).toBe(1234);
  });
});

describe('local recovery store', () => {
  it('saves, loads and lists by order', async () => {
    const store = createLocalRecoveryStore(memoryStorage());
    const id = `0x${'ab'.repeat(32)}` as const;
    await store.save(id, '{"x":1}');
    expect(await store.load(id)).toBe('{"x":1}');
    expect(await store.list()).toEqual([id]);
    expect(await store.load(`0x${'cd'.repeat(32)}`)).toBeNull();
  });

  it('refuses to pretend it saved when there is no storage', async () => {
    const store = createLocalRecoveryStore(null);
    expect(await rejection(store.save(`0x${'ab'.repeat(32)}`, '{}'))).toMatch(
      /cannot keep/,
    );
  });
});

describe('wallet ports', () => {
  it('say plainly when the wallet cannot send or sign', async () => {
    const evm = { address: '0x' + '1'.repeat(40), chainId: 8453 } as EvmWallet;
    const signer = evmSignerFromWallet(evm);
    expect(await signer.getChainId()).toBe(8453);
    expect(
      await rejection(
        signer.sendTransaction({
          to: '0x00',
          data: '0x',
          chainId: 8453,
        }),
      ),
    ).toMatch(/cannot send/);
    const bch = bchSignerFromWallet({} as BchWallet);
    expect(await rejection(bch.signTransaction({} as never))).toMatch(
      /cannot sign a lock/,
    );
  });
});

describe('security policy', () => {
  it('allows every host the live swap path connects to', () => {
    const caddy = fs.readFileSync(
      path.resolve(__dirname, '../../../../deploy/Caddyfile'),
      'utf8',
    );
    const connectSrc = /connect-src ([^;]+);/.exec(caddy)?.[1] ?? '';
    for (const url of DEFAULT_MAINNET_FULCRUM) {
      expect(connectSrc).toContain(url);
    }
    const chains = JSON.parse(
      fs.readFileSync(
        path.resolve(__dirname, '../../../chain-config/src/data/chains.json'),
        'utf8',
      ),
    ) as {
      chains: Record<
        string,
        { mainnet: { rpcUrls: Array<{ url: string } | string> } }
      >;
    };
    for (const key of ['base', 'ethereum', 'arbitrum', 'bnb']) {
      const urls = (chains.chains[key]?.mainnet.rpcUrls ?? []).map((u) =>
        typeof u === 'string' ? u : u.url,
      );
      const origins = urls.map((u) => new URL(u).origin);
      expect(
        origins.some((o) => connectSrc.includes(o)),
        `${key} has at least one RPC host allowed`,
      ).toBe(true);
    }
  });
});
