import chainsData from '../../../chain-config/src/data/chains.json';

/** Block explorers for a transaction, so anyone can check a swap on the chain itself. */
interface TokenRow {
  symbol?: string;
  address?: string | null;
  decimals?: number;
}
interface NetworkRow {
  chainId: number;
  explorerUrl: string;
  tokens?: TokenRow[];
}
interface ChainRow {
  name: string;
  mainnet?: NetworkRow;
  testnet?: NetworkRow;
}

const TOKENS_BY_ADDRESS: Record<string, { symbol: string; decimals: number }> =
  {};

/** Every chain in the recorded facts, by chain id: its name and explorer. */
const CHAINS_BY_ID: Record<number, { name: string; explorer: string }> = {};
for (const row of Object.values(
  (chainsData as unknown as { chains: Record<string, ChainRow> }).chains,
)) {
  for (const net of [row.mainnet, row.testnet]) {
    if (!net) continue;
    for (const token of net.tokens ?? []) {
      if (token.symbol && token.address) {
        TOKENS_BY_ADDRESS[`${net.chainId}:${token.address.toLowerCase()}`] = {
          symbol: token.symbol,
          decimals: token.decimals ?? 6,
        };
      }
    }
    CHAINS_BY_ID[net.chainId] = {
      name: net === row.testnet ? `${row.name} testnet` : row.name,
      explorer: net.explorerUrl.replace(/\/$/, ''),
    };
  }
}

/** The name of the explorer site ("Arbiscan") for a chain id. */
const EXPLORER_NAMES: Record<number, string> = {
  1: 'Etherscan',
  8453: 'Basescan',
  42161: 'Arbiscan',
  56: 'BscScan',
  5042: 'Arc Explorer',
  4663: 'Blockscout',
};

const BCH_EXPLORER = 'https://bchexplorer.info';

function bare(hash: string): string {
  return hash.replace(/^0x/i, '');
}

/** The explorer page of an EVM transaction, or null when the chain has no known explorer. */
export function evmTxUrl(chainId: number, hash: string): string | null {
  const base = CHAINS_BY_ID[chainId]?.explorer;
  return base ? `${base}/tx/0x${bare(hash)}` : null;
}

/** "Arbiscan" for a chain id; "Explorer" when the chain has no special name. */
export function evmExplorerName(chainId: number): string {
  return EXPLORER_NAMES[chainId] ?? 'Explorer';
}

/** The explorer page of a Bitcoin Cash transaction. */
export function bchTxUrl(hash: string): string {
  return `${BCH_EXPLORER}/tx/${bare(hash)}`;
}

/** "Chain 8453" or "Bitcoin Cash" as the label shown beside an amount: a chain name for EVM, nothing for Bitcoin Cash. */
export function chainLabel(chain: string): string | null {
  if (/bitcoin cash/i.test(chain)) return null;
  const id = Number(/\d+/.exec(chain)?.[0] ?? 0);
  return CHAINS_BY_ID[id]?.name ?? (id ? `Chain ${id}` : chain);
}

/** The symbol and decimals of an EVM token the facts know ("USDT", 6), or null. */
export function evmTokenInfo(
  chainId: number,
  address: string,
): { symbol: string; decimals: number } | null {
  return TOKENS_BY_ADDRESS[`${chainId}:${address.toLowerCase()}`] ?? null;
}
