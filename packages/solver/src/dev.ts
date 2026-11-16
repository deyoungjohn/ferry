import { WebSocketServer } from 'ws';
import { privateKeyToAccount } from 'viem/accounts';
import { buildServer } from './api/server.js';
import { SolverDatabase } from './db/database.js';
import { SolverEngine } from './engine/runner.js';
import { BchQuorumClient, BCH_GENESIS_HASHES } from './bch/quorum-client.js';
import { MockPriceSource } from './pricing/price-source.js';
import { loadConfigFromEnv } from './config.js';
import type { EvmChainAdapter } from '@ferry/chain-evm';
import type { BchChainPort, EvmChainPort } from './engine/types.js';

async function main() {
  const devEvmKey =
    '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const;
  const devAccount = privateKeyToAccount(devEvmKey);

  // 1. Start in-process Fake Electrum WebSocket Server
  let electrumPort = 50004;
  const electrumServer = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await new Promise<void>((resolve) =>
    electrumServer.once('listening', resolve),
  );
  const electrumAddr = electrumServer.address();
  if (typeof electrumAddr === 'object' && electrumAddr !== null) {
    electrumPort = electrumAddr.port;
  }

  const tipHeight = 330000;
  electrumServer.on('connection', (ws) => {
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.method === 'server.features') {
          ws.send(
            JSON.stringify({
              id: msg.id,
              jsonrpc: '2.0',
              result: {
                genesis_hash: BCH_GENESIS_HASHES.chipnet,
                server_version: 'FakeElectrum 1.0',
                protocol_min: '1.4',
                protocol_max: '1.6',
              },
            }),
          );
        } else if (msg.method === 'blockchain.headers.subscribe') {
          ws.send(
            JSON.stringify({
              id: msg.id,
              jsonrpc: '2.0',
              result: { height: tipHeight, hex: '00' },
            }),
          );
        } else if (msg.method === 'server.ping') {
          ws.send(JSON.stringify({ id: msg.id, jsonrpc: '2.0', result: null }));
        } else if (msg.method === 'blockchain.scripthash.subscribe') {
          ws.send(JSON.stringify({ id: msg.id, jsonrpc: '2.0', result: null }));
        } else if (msg.method === 'blockchain.scripthash.get_history') {
          ws.send(JSON.stringify({ id: msg.id, jsonrpc: '2.0', result: [] }));
        } else {
          ws.send(JSON.stringify({ id: msg.id, jsonrpc: '2.0', result: null }));
        }
      } catch {
        // ignore
      }
    });
  });

  // 2. Mock BCH Quorum Client & Adapter
  const electrumUrl = `ws://127.0.0.1:${electrumPort}`;
  const bchClient = new BchQuorumClient([electrumUrl, electrumUrl], 'chipnet');
  await bchClient.connect().catch(() => null);

  const bchPort: BchChainPort = {
    getTip: async () => ({ height: tipHeight, hash: '0x' + '00'.repeat(32) }),
    isQuorumHealthy: () => true,
    isQuotingEnabled: () => true,
    broadcast: async () => '0xmock_bch_txid',
    isOnChain: async () => true,
    getScriptHashHistory: async () => [],
  };

  // 3. EVM Chain Adapter (pointing to Anvil or local mock fallback)
  const evmPort: EvmChainPort = {
    getTip: async () => ({ height: 1000, finalized: true }),
    getLock: async () => ({ status: 'none' }),
    isFinal: async () => true,
    broadcast: async () => '0xmock_evm_txid',
    isOnChain: async () => true,
  };

  const evmAdapter: EvmChainAdapter = {
    id: 'base',
    address: devAccount.address,
    getTip: async () => ({ height: 1000, ageSeconds: 1, stale: false }),
    getLock: async () => ({ status: 'absent' as const }),
    isFinal: async () => true,
    relayLock: async () => ({
      chain: 'base' as const,
      txId: '0x' + '11'.repeat(32),
    }),
    claim: async () => ({
      chain: 'base' as const,
      txId: '0x' + '22'.repeat(32),
    }),
    refund: async () => ({
      chain: 'base' as const,
      txId: '0x' + '33'.repeat(32),
    }),
  } as unknown as EvmChainAdapter;

  // 4. Fake Price Source ($1.00 pegs)
  const now = Math.floor(Date.now() / 1000);
  const priceSource = new MockPriceSource(
    new Map([
      ['usdc', { usdPrice: 1_000_000n, source: 'mock-chainlink', asOf: now }],
      ['pusd', { usdPrice: 1_000_000n, source: 'mock-cauldron', asOf: now }],
      ['musd', { usdPrice: 1_000_000n, source: 'mock-cauldron', asOf: now }],
    ]),
  );

  // 5. Ephemeral SQLite Database
  const dbPath =
    process.env.FERRY_DB_PATH || `/tmp/solver-dev-${Date.now()}.db`;
  const db = new SolverDatabase(dbPath);

  // 6. Solver Configuration
  const config = loadConfigFromEnv({
    NETWORK: 'chipnet',
    HOST: '127.0.0.1',
    PORT: '8787',
    ALLOW_DEV_KEYS: '1',
    SOLVER_EVM_PRIVATE_KEY: devEvmKey,
    OPERATOR_TOKEN: 'operator-token-dev-mode-32-chars-long!',
    BCH_ELECTRUM_URLS: `${electrumUrl},${electrumUrl}`,
  });

  // 7. Engine with State-Change Logger (one short line per state change)
  const engine = new SolverEngine(db, bchPort, evmPort, config);

  // Track order statuses to log one short line per state change
  const knownStatuses = new Map<string, string>();
  setInterval(() => {
    try {
      const activeOrders = db.listNonTerminalOrders();
      for (const order of activeOrders) {
        const prev = knownStatuses.get(order.id);
        if (prev !== order.status) {
          knownStatuses.set(order.id, order.status);
          const shortId = order.id.slice(0, 10);
          console.log(
            `[order:${shortId}] ${prev ?? 'INIT'} -> ${order.status}`,
          );
        }
      }
    } catch {
      // ignore
    }
  }, 500);

  // 8. Build Server and Listen
  const app = buildServer({
    config,
    db,
    evmAdapter,
    bchClient,
    engine,
    priceSource,
  });

  const address = await app.listen({ port: 8787, host: '127.0.0.1' });
  console.log(`[solver-dev] Fastify server listening at ${address}`);
  console.log(`[solver-dev] Fake Electrum server listening at ${electrumUrl}`);
  console.log(`[solver-dev] SQLite database: ${dbPath}`);
  console.log(`[solver-dev] Solver EVM Address: ${devAccount.address}`);
  console.log(`[solver-dev] Ready to accept quotes and orders.`);

  const shutdown = async () => {
    console.log('\n[solver-dev] Shutting down...');
    engine.stop();
    await app.close();
    bchClient.close();
    electrumServer.close();
    db.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

void main().catch((err) => {
  console.error('[solver-dev] Fatal error on startup:', err);
  process.exit(1);
});
