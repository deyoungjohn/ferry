import { describe, expect, it } from 'vitest';
import type { ElectrumTransport } from '../src/bch/transport.js';
import { BchQuorumClient } from '../src/bch/quorum-client.js';

function createMockTransport(opts: {
  url: string;
  connected?: boolean;
  tipHeight?: number;
  tipTimestamp?: number;
  lastConfirmedAt?: number;
}): ElectrumTransport {
  return {
    url: opts.url,
    connect: async () => {},
    close: () => {},
    isConnected: () => opts.connected ?? true,
    request: async <T>() => null as T,
    getGenesisHash: () =>
      '000000001dd410c49a788668ce26751718cc797474d3152a5fc073dd44fd9f7b',
    fetchFeatures: async () => ({
      genesis_hash:
        '000000001dd410c49a788668ce26751718cc797474d3152a5fc073dd44fd9f7b',
    }),
    getTip: () => ({
      height: opts.tipHeight ?? 330000,
      timestamp: opts.tipTimestamp ?? Date.now(),
    }),
    getLastConfirmedAt: () => opts.lastConfirmedAt ?? Date.now(),
    ping: async () => true,
  };
}

describe('BchQuorumClient Liveness vs Block Age', () => {
  it('allows quoting on testnet when chain is slow (6.5 hours old block) but node is live', () => {
    const now = Date.now();
    const t1 = createMockTransport({
      url: 'wss://node1',
      tipHeight: 329556,
      tipTimestamp: now - 23492 * 1000, // 23492s ago
      lastConfirmedAt: now - 5 * 1000, // 5s ago
    });
    const t2 = createMockTransport({
      url: 'wss://node2',
      tipHeight: 329556,
      tipTimestamp: now - 23492 * 1000,
      lastConfirmedAt: now - 4 * 1000, // 4s ago
    });

    const client = new BchQuorumClient([t1, t2], {
      network: 'testnet',
      tipMaxAgeBchSeconds: 7200,
    });

    const status = client.getQuorumStatus();
    expect(status.quotingAllowed).toBe(true);
    expect(status.quotingState).toBe('HEALTHY');
    expect(status.isLivenessHealthy).toBe(true);
    expect(status.ageSeconds).toBeGreaterThanOrEqual(23492);
  });

  it('stops quoting on testnet when node stops answering (liveness timeout > 60s)', () => {
    const now = Date.now();
    const t1 = createMockTransport({
      url: 'wss://node1',
      tipHeight: 329556,
      tipTimestamp: now - 120 * 1000,
      lastConfirmedAt: now - 95 * 1000, // 95s ago (> 60s)
    });

    const client = new BchQuorumClient([t1], {
      network: 'testnet',
      tipMaxAgeBchSeconds: 7200,
    });

    const status = client.getQuorumStatus();
    expect(status.quotingAllowed).toBe(false);
    expect(status.quotingState).toBe('STALE_LIVENESS');
    expect(status.isLivenessHealthy).toBe(false);
  });

  it('stops quoting on mainnet when block gap exceeds tipMaxAgeBchSeconds even if node is live', () => {
    const now = Date.now();
    const t1 = createMockTransport({
      url: 'wss://main1',
      tipHeight: 850000,
      tipTimestamp: now - 7500 * 1000, // > 7200s gap
      lastConfirmedAt: now - 2 * 1000, // live
    });
    const t2 = createMockTransport({
      url: 'wss://main2',
      tipHeight: 850000,
      tipTimestamp: now - 7500 * 1000,
      lastConfirmedAt: now - 3 * 1000, // live
    });

    const client = new BchQuorumClient([t1, t2], {
      network: 'mainnet',
      tipMaxAgeBchSeconds: 7200,
    });

    const status = client.getQuorumStatus();
    expect(status.quotingAllowed).toBe(false);
    expect(status.quotingState).toBe('STALE_BLOCK_AGE');
  });

  it('stops quoting when fewer than two healthy servers remain on mainnet', () => {
    const now = Date.now();
    const t1 = createMockTransport({
      url: 'wss://main1',
      connected: true,
      tipHeight: 850000,
      tipTimestamp: now - 600 * 1000,
      lastConfirmedAt: now - 2 * 1000,
    });
    const t2 = createMockTransport({
      url: 'wss://main2',
      connected: false, // disconnected!
      tipHeight: 850000,
      tipTimestamp: now - 600 * 1000,
      lastConfirmedAt: now - 2 * 1000,
    });

    const client = new BchQuorumClient([t1, t2], {
      network: 'mainnet',
      tipMaxAgeBchSeconds: 7200,
    });

    const status = client.getQuorumStatus();
    expect(status.healthyServersCount).toBe(1);
    expect(status.quotingAllowed).toBe(false);
    expect(status.quotingState).toBe('INSUFFICIENT_SERVERS');
  });

  it('stops quoting when servers have a split tip (divergence > 1 block)', () => {
    const now = Date.now();
    const t1 = createMockTransport({
      url: 'wss://node1',
      tipHeight: 330000,
      tipTimestamp: now - 60 * 1000,
      lastConfirmedAt: now - 2 * 1000,
    });
    const t2 = createMockTransport({
      url: 'wss://node2',
      tipHeight: 330005, // 5 blocks ahead
      tipTimestamp: now - 60 * 1000,
      lastConfirmedAt: now - 2 * 1000,
    });

    const client = new BchQuorumClient([t1, t2], {
      network: 'testnet',
    });

    const status = client.getQuorumStatus();
    expect(status.isQuorumHealthy).toBe(false);
    expect(status.quotingAllowed).toBe(false);
    expect(status.quotingState).toBe('SPLIT_TIP');
  });
});
