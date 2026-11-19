/** Block explorers for a transaction, so anyone can check a swap on the chain itself. */
const EVM_EXPLORERS: Record<number, string> = {
  8453: 'https://basescan.org',
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
