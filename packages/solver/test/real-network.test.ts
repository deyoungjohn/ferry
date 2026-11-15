import { describe, expect, it } from 'vitest';
import { BchQuorumClient } from '../src/bch/quorum-client.js';

const shouldRun =
  process.env.RUN_BCH_NETWORK_TESTS === '1' ||
  process.env.RUN_BCH_NETWORK_TESTS === 'true';

describe.skipIf(!shouldRun)('Opt-in Real Network Fulcrum Tests', () => {
  it('connects to real chipnet Fulcrum endpoint and fetches tip and features', async () => {
    const client = new BchQuorumClient(
      ['wss://chipnet.imaginary.cash:50004'],
      'chipnet',
    );
    try {
      await client.connect();
      const status = client.getQuorumStatus();
      expect(status.quorumTip).toBeGreaterThan(0);
      expect(status.quotingAllowed).toBe(true);
    } finally {
      client.close();
    }
  });
});
