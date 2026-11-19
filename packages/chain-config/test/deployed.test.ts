import { describe, expect, it } from 'vitest';
import {
  PREDICTED_FERRY_HTLC_ADDRESS,
  listDeployedContracts,
  loadChainData,
} from '../src/index.js';

describe('listDeployedContracts', () => {
  it('returns an empty array when deployments are superseded / pending redeploy', () => {
    const deployed = listDeployedContracts(loadChainData());
    expect(deployed).toEqual([]);
  });

  it('lists recorded mainnet deployments when populated', () => {
    const raw = loadChainData() as {
      chains: Record<
        string,
        {
          mainnet: {
            deployment: {
              htlcAddress: string | null;
              deployBlock: number | null;
              evidence: { status: string };
            };
          };
        }
      >;
    };
    const cloned = structuredClone(raw);
    const baseChain = cloned.chains.base!;
    baseChain.mainnet.deployment.htlcAddress = PREDICTED_FERRY_HTLC_ADDRESS;
    baseChain.mainnet.deployment.deployBlock = 58633459;
    baseChain.mainnet.deployment.evidence.status = 'verified';

    const deployed = listDeployedContracts(cloned);
    expect(deployed.length).toBe(1);
    const first = deployed[0]!;
    expect(first.chain).toBe('base');
    expect(first.address).toBe(PREDICTED_FERRY_HTLC_ADDRESS);
    expect(first.deployBlock).toBe(58633459);
    expect(first.verified).toBe(true);
    expect(first.explorerUrl.startsWith('https://')).toBe(true);
  });
});
