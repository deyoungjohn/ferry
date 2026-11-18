import { getAddress } from 'viem';
import { CHAIN_IDS, parseChainConfigData, type ChainId } from './schema.js';

export interface DeployedContract {
  chain: ChainId;
  name: string;
  chainId: number;
  explorerUrl: string;
  address: string;
  deployBlock: number | null;
  /** True when the recorded deployment carries verified evidence. */
  verified: boolean;
}

/** Mainnet deployments recorded in the facts data. Browser-safe (no Node imports). */
export function listDeployedContracts(data: unknown): DeployedContract[] {
  const parsed = parseChainConfigData(data);
  const found: DeployedContract[] = [];
  for (const id of CHAIN_IDS) {
    const net = parsed.chains[id].mainnet;
    const address = net.deployment.htlcAddress;
    if (address === null) continue;
    found.push({
      chain: id,
      name: parsed.chains[id].name,
      chainId: net.chainId,
      explorerUrl: net.explorerUrl,
      address: getAddress(address),
      deployBlock: net.deployment.deployBlock,
      verified: net.deployment.evidence.status === 'verified',
    });
  }
  return found;
}
