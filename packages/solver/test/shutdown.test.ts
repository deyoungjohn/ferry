import { describe, expect, it } from 'vitest';
import { startSolver } from '../src/main.js';
import { loadConfigFromEnv } from '../src/config.js';
import { MockPriceSource } from '../src/pricing/price-source.js';
import type { BchQuorumClient } from '../src/bch/quorum-client.js';

describe('Solver Daemon Lifecycle & Graceful Shutdown', () => {
  it('initializes and stops cleanly without resource leaks', async () => {
    const config = loadConfigFromEnv({
      NETWORK: 'testnet',
      ALLOW_DEV_KEYS: '1',
      DATABASE_PATH: ':memory:',
      BASE_FERRY_HTLC_ADDRESS: '0x8b968625F983420B571C102eC0b57F7e509c916e',
      OPERATOR_TOKEN: 'operator-token-min-32-characters-test',
    });

    const priceSource = new MockPriceSource(
      new Map([
        [
          'usdc',
          {
            usdPrice: 1_000_000n,
            source: 'test',
            asOf: Math.floor(Date.now() / 1000),
          },
        ],
        [
          'pusd',
          {
            usdPrice: 1_000_000n,
            source: 'test',
            asOf: Math.floor(Date.now() / 1000),
          },
        ],
      ]),
    );

    const fakeBchClient = {
      connect: async () => {},
      close: () => {},
      getQuorumStatus: () => ({
        isQuorumHealthy: true,
        quorumTip: 200000,
        liveServers: 2,
        totalServers: 2,
        ageSeconds: 5,
      }),
      broadcast: async () => '0x',
      getHistory: async () => [],
      waitForDoubleSpendProof: async () => false,
    } as unknown as BchQuorumClient;

    const solver = await startSolver({
      config,
      priceSource,
      bchClient: fakeBchClient,
      skipListen: true,
    });

    expect(solver).toBeDefined();
    expect(solver.app).toBeDefined();
    expect(solver.engine).toBeDefined();

    // Verify graceful stop
    await expect(solver.stop()).resolves.toBeUndefined();
  });
});
