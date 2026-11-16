import { describe, expect, it } from 'vitest';
import { createPublicClient, http } from 'viem';
import { loadChainConfig } from '@ferry/chain-config';
import { chainlinkSourceFromConfig } from '../src/index.js';

const runLive = process.env.FERRY_LIVE_TESTS === '1';

describe.skipIf(!runLive)('Chainlink live read', () => {
  it('reads a fresh Base USDC/USD price from the public endpoint', async () => {
    const config = loadChainConfig({ env: {} });
    const base = config.facts.find((item) => item.id === 'base');
    const endpoint = base?.rpcEndpoints.find(
      (item) => item.source === 'public',
    );
    if (!base || !endpoint) throw new Error('Base public endpoint missing');
    const client = createPublicClient({ transport: http(endpoint.url) });
    const source = chainlinkSourceFromConfig(config, 'base', client);
    const reading = await source.getPrice('USDC');
    expect(reading.usdPrice).toBeGreaterThan(0n);
    expect(reading.source).toBe('chainlink:base:usdc/usd');
  });
});
