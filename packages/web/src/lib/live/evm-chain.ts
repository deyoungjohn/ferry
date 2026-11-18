import { loadChainConfig } from '@ferry/chain-config/browser';
import type { Hex32 } from '@ferry/core';
import { EvmChainAdapter } from '@ferry/chain-evm';
import type { EvmChainPort } from '@ferry/user-flow';

/** EVM reads for one chain, from the bundled mainnet facts and its public RPC endpoints. */
export function createBrowserEvmChain(chainId: number): EvmChainPort {
  const config = loadChainConfig({
    env: { FERRY_NETWORK: 'mainnet' },
    network: 'mainnet',
  }).coreChains.find((chain) => chain.chainId === chainId);
  if (!config) {
    throw new Error(`Chain ${chainId} is not configured in this build.`);
  }
  const adapter = new EvmChainAdapter({ config });
  return {
    buildUserLock: (terms) => adapter.buildUserLock(terms),
    getLock: (lockId: Hex32) => adapter.getLock(lockId),
    waitForReceipt: async (hash) => {
      const receipt = await adapter.client.waitForTransactionReceipt({ hash });
      return { status: receipt.status };
    },
    getBlockTimestamp: async () =>
      Number((await adapter.client.getBlock()).timestamp),
  };
}
