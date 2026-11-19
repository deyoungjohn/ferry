import { loadChainConfig, type ChainId } from '@ferry/chain-config';

export const FORK_CHAINS: readonly ChainId[] = [
  'base',
  'ethereum',
  'arbitrum',
  'arc',
  'bnb',
  'robinhood',
];

export const RPC_ENV: Record<ChainId, string> = {
  base: 'RPC_URL_BASE',
  ethereum: 'RPC_URL_ETHEREUM',
  arbitrum: 'RPC_URL_ARBITRUM',
  arc: 'RPC_URL_ARC',
  bnb: 'RPC_URL_BNB',
  robinhood: 'RPC_URL_ROBINHOOD',
};

export function chainConfig() {
  return loadChainConfig({ network: 'mainnet' });
}

export function rpcFor(chain: ChainId): string | null {
  const value = process.env[RPC_ENV[chain]!]?.split(',')[0]?.trim();
  return value === undefined || value === '' ? null : value;
}
