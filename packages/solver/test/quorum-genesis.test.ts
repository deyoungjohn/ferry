import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer } from 'ws';
import {
  BCH_GENESIS_HASHES,
  BchQuorumClient,
} from '../src/bch/quorum-client.js';

describe('BchQuorumClient Genesis Hash Verification and Quorum', () => {
  const activeServers: WebSocketServer[] = [];
  const activeClients: BchQuorumClient[] = [];

  afterEach(async () => {
    for (const client of activeClients) {
      client.close();
    }
    activeClients.length = 0;

    for (const wss of activeServers) {
      await new Promise<void>((resolve) => wss.close(() => resolve()));
    }
    activeServers.length = 0;
  });

  function startMockFulcrum(
    genesisHash: string | null,
    tipHeight = 330000,
  ): Promise<string> {
    return new Promise((resolve) => {
      const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' }, () => {
        const address = wss.address();
        const port =
          typeof address === 'object' && address !== null ? address.port : 0;
        resolve(`ws://127.0.0.1:${port}`);
      });
      activeServers.push(wss);

      wss.on('connection', (ws) => {
        ws.on('message', (data) => {
          try {
            const req = JSON.parse(data.toString());
            if (req.method === 'blockchain.headers.subscribe') {
              ws.send(
                JSON.stringify({
                  id: req.id,
                  jsonrpc: '2.0',
                  result: { height: tipHeight, hex: '00' },
                }),
              );
            } else if (req.method === 'server.features') {
              const result: Record<string, unknown> = {
                server_version: 'MockFulcrum 1.0',
                protocol_min: '1.4',
                protocol_max: '1.6',
              };
              if (genesisHash !== null) {
                result.genesis_hash = genesisHash;
              }
              ws.send(
                JSON.stringify({
                  id: req.id,
                  jsonrpc: '2.0',
                  result,
                }),
              );
            } else {
              ws.send(
                JSON.stringify({
                  id: req.id,
                  jsonrpc: '2.0',
                  result: null,
                }),
              );
            }
          } catch {
            // ignore
          }
        });
      });
    });
  }

  it('accepts server when network is chipnet and genesis hash matches chipnet', async () => {
    const url = await startMockFulcrum(BCH_GENESIS_HASHES.chipnet);
    const client = new BchQuorumClient([url], 'chipnet');
    activeClients.push(client);

    await client.connect();
    expect(client.getActiveTransports().length).toBe(1);
    expect(client.getDroppedTransports().length).toBe(0);
    const status = client.getQuorumStatus();
    expect(status.quotingAllowed).toBe(true);
    expect(status.quorumTip).toBe(330000);
  });

  it('drops server when configured for chipnet but server returns mainnet genesis', async () => {
    const chipnetUrl = await startMockFulcrum(BCH_GENESIS_HASHES.chipnet);
    const mainnetUrl = await startMockFulcrum(BCH_GENESIS_HASHES.mainnet);
    const client = new BchQuorumClient([chipnetUrl, mainnetUrl], 'chipnet');
    activeClients.push(client);

    await client.connect();
    expect(client.getActiveTransports().length).toBe(1);
    expect(client.getDroppedTransports().length).toBe(1);
    expect(client.getActiveTransports()[0]?.url).toBe(chipnetUrl);
  });

  it('drops server when server.features omits genesis_hash', async () => {
    const goodUrl = await startMockFulcrum(BCH_GENESIS_HASHES.chipnet);
    const missingUrl = await startMockFulcrum(null);
    const client = new BchQuorumClient([goodUrl, missingUrl], 'chipnet');
    activeClients.push(client);

    await client.connect();
    expect(client.getActiveTransports().length).toBe(1);
    expect(client.getDroppedTransports().length).toBe(1);
    expect(client.getDroppedTransports()[0]?.url).toBe(missingUrl);
  });

  it('refuses mainnet connect if fewer than two servers match mainnet genesis', async () => {
    const mainnetUrl = await startMockFulcrum(BCH_GENESIS_HASHES.mainnet);
    const chipnetUrl = await startMockFulcrum(BCH_GENESIS_HASHES.chipnet);
    const client = new BchQuorumClient([mainnetUrl, chipnetUrl], 'mainnet');
    activeClients.push(client);

    await expect(client.connect()).rejects.toThrow(
      /Genesis hash verification failed: 1 valid server\(s\) remaining out of 2\. Mainnet requires at least two/i,
    );
  });

  it('accepts mainnet connect when at least two servers match mainnet genesis', async () => {
    const s1 = await startMockFulcrum(BCH_GENESIS_HASHES.mainnet, 850000);
    const s2 = await startMockFulcrum(BCH_GENESIS_HASHES.mainnet, 850000);
    const client = new BchQuorumClient([s1, s2], 'mainnet');
    activeClients.push(client);

    await client.connect();
    expect(client.getActiveTransports().length).toBe(2);
    expect(client.getDroppedTransports().length).toBe(0);
    const status = client.getQuorumStatus();
    expect(status.quotingAllowed).toBe(true);
    expect(status.quorumTip).toBe(850000);
  });
});
