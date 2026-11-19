import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer } from 'ws';
import { FulcrumClient } from '../src/index.js';

describe('FulcrumClient (mock WebSocket server)', () => {
  let wss: WebSocketServer | null = null;

  afterEach(async () => {
    if (wss) {
      await new Promise<void>((resolve) => wss!.close(() => resolve()));
      wss = null;
    }
  });

  async function startFakeServer(
    handler: (method: string, params: unknown[]) => unknown,
  ): Promise<string> {
    wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    await new Promise<void>((resolve) =>
      wss!.once('listening', () => resolve()),
    );
    wss.on('connection', (socket) => {
      socket.on('message', (raw) => {
        const msg = JSON.parse(raw.toString()) as {
          id: number;
          method: string;
          params: unknown[];
        };
        if (msg.method === 'slow.hang') return;
        const result = handler(msg.method, msg.params);
        socket.send(JSON.stringify({ id: msg.id, result }));
      });
    });
    const addr = wss.address() as { port: number };
    return `ws://127.0.0.1:${addr.port}`;
  }

  it('handles server.version, getHistory, listUnspent, getTransaction, headers.subscribe, and broadcast', async () => {
    const url = await startFakeServer((method, params) => {
      switch (method) {
        case 'server.version':
          return ['Fulcrum 2.1.4', '1.4'];
        case 'blockchain.scripthash.get_history':
          return [{ tx_hash: 'aa'.repeat(32), height: 329336 }];
        case 'blockchain.scripthash.get_first_use':
          return {
            block_hash: 'ee'.repeat(32),
            block_height: 300000,
            tx_hash: 'ff'.repeat(32),
          };
        case 'blockchain.scripthash.get_balance':
          return { confirmed: 50000, unconfirmed: 0 };
        case 'blockchain.scripthash.listunspent':
          expect(params[1]).toBe('include_tokens');
          return [
            {
              height: 329336,
              tx_hash: 'bb'.repeat(32),
              tx_pos: 0,
              value: 3000,
              token_data: { category: 'cc'.repeat(32), amount: '1000' },
            },
          ];
        case 'blockchain.transaction.get':
          return '0200000000';
        case 'blockchain.headers.subscribe':
          return { height: 329336, hex: '00'.repeat(80) };
        case 'blockchain.transaction.broadcast':
          return 'dd'.repeat(32);
        default:
          return null;
      }
    });

    const client = new FulcrumClient(url, { timeoutMs: 2000 });
    await client.connect();
    expect(await client.serverVersion()).toEqual(['Fulcrum 2.1.4', '1.4']);
    expect(await client.getHistory('00'.repeat(32))).toHaveLength(1);
    expect(await client.getFirstUse('00'.repeat(32))).toEqual({
      block_hash: 'ee'.repeat(32),
      block_height: 300000,
      tx_hash: 'ff'.repeat(32),
    });
    expect(await client.getBalance('00'.repeat(32))).toEqual({
      confirmed: 50000,
      unconfirmed: 0,
    });
    expect(await client.listUnspent('00'.repeat(32))).toHaveLength(1);
    expect(await client.getTransaction('aa'.repeat(32))).toBe('0200000000');
    expect(await client.getTipHeight()).toBe(329336);
    expect(client.lastKnownTipHeight()).toBe(329336);
    expect(await client.broadcast('0200000000')).toBe('dd'.repeat(32));
    client.close();
  });

  it('handles JSON-RPC batch responses from servers', async () => {
    wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    await new Promise<void>((resolve) =>
      wss!.once('listening', () => resolve()),
    );
    wss.on('connection', (socket) => {
      socket.on('message', (raw) => {
        const msg = JSON.parse(raw.toString()) as {
          id: number;
          method: string;
        };
        // Reply with array wrapping response
        socket.send(
          JSON.stringify([
            { id: msg.id, result: { confirmed: 12345, unconfirmed: 0 } },
          ]),
        );
      });
    });
    const addr = wss.address() as { port: number };
    const client = new FulcrumClient(`ws://127.0.0.1:${addr.port}`, {
      timeoutMs: 2000,
    });
    await client.connect();
    const balance = await client.getBalance('11'.repeat(32));
    expect(balance.confirmed).toBe(12345);
    client.close();
  });

  it('times out unanswered RPC requests', async () => {
    const url = await startFakeServer(() => null);
    const client = new FulcrumClient(url, { timeoutMs: 50 });
    await client.connect();
    await expect(client.request('slow.hang')).rejects.toThrow(/timed out/);
    client.close();
  });

  const runChipnet = process.env.FERRY_RUN_CHIPNET_TESTS === '1';
  it.skipIf(!runChipnet)('chipnet integration (opt-in)', async () => {
    const client = new FulcrumClient('wss://chipnet.imaginary.cash:50004', {
      timeoutMs: 5000,
    });
    await client.connect();
    const height = await client.getTipHeight();
    expect(height).toBeGreaterThan(0);
    client.close();
  });
});
