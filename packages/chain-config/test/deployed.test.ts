import { describe, expect, it } from 'vitest';
import {
  PREDICTED_FERRY_HTLC_ADDRESS,
  listDeployedContracts,
  loadChainData,
} from '../src/index.js';

describe('listDeployedContracts', () => {
  it('lists the recorded mainnet deployments only', () => {
    const deployed = listDeployedContracts(loadChainData());
    expect(deployed.length).toBeGreaterThanOrEqual(1);
    for (const item of deployed) {
      expect(item.address).toBe(PREDICTED_FERRY_HTLC_ADDRESS);
      expect(item.explorerUrl.startsWith('https://')).toBe(true);
    }
    expect(deployed.some((item) => item.chain === 'base')).toBe(true);
  });
});
