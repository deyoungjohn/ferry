/** Block explorers for a transaction, so anyone can check a swap on the chain itself. */
const EVM_EXPLORERS: Record<number, string> = {
  1: 'https://etherscan.io',
  56: 'https://bscscan.com',
  4663: 'https://robinhoodchain.blockscout.com',
  5042: 'https://explorer.arc.io',
  8453: 'https://basescan.org',
  42161: 'https://arbiscan.io',
  84532: 'https://sepolia.basescan.org',
};

const BCH_EXPLORER = 'https://bchexplorer.info';

function bare(hash: string): string {
  return hash.replace(/^0x/i, '');
}

/** The explorer page of an EVM transaction, or null when the chain has no known explorer. */
export function evmTxUrl(chainId: number, hash: string): string | null {
  const base = EVM_EXPLORERS[chainId];
  return base ? `${base}/tx/0x${bare(hash)}` : null;
}

/** The explorer page of a Bitcoin Cash transaction. */
export function bchTxUrl(hash: string): string {
  return `${BCH_EXPLORER}/tx/${bare(hash)}`;
}

const EVM_CHAIN_NAMES: Record<number, string> = {
  1: 'Ethereum',
  56: 'BNB Chain',
  4663: 'Robinhood Chain',
  5042: 'Arc',
  8453: 'Base',
  42161: 'Arbitrum',
  84532: 'Base Sepolia',
};

/** "Chain 8453" or "Bitcoin Cash" as the label shown beside an amount: a chain name for EVM, nothing for Bitcoin Cash. */
export function chainLabel(chain: string): string | null {
  if (/bitcoin cash/i.test(chain)) return null;
  const id = Number(/\d+/.exec(chain)?.[0] ?? 0);
  return EVM_CHAIN_NAMES[id] ?? (id ? `Chain ${id}` : chain);
}
