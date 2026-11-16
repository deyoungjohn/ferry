/**
 * Chain display configuration for Ferry Web UI.
 *
 * NOTE: This file contains ONLY UI display attributes (names, token symbols,
 * display ordering, and enabled flags). It carries NO chain facts (no RPC URLs,
 * no token contract addresses, no HTLC addresses, no Electrum endpoints).
 * Once @ferry/chain-config lands, chain facts will be imported from there.
 * Out-of-scope networks are excluded.
 */

export interface SupportedTokenDisplay {
  readonly symbol: string;
  readonly name: string;
  readonly decimals: number;
}

export interface ChainDisplay {
  readonly id: string | number;
  readonly name: string;
  readonly shortName?: string;
  readonly type: 'evm';
  readonly tokenSymbols: readonly string[];
  readonly enabled: boolean;
  readonly order: number;
}

export interface BchChainDisplay {
  readonly name: string;
  readonly network: 'chipnet' | 'mainnet';
  readonly prefix: 'bchtest' | 'bitcoincash';
  readonly tokenSymbols: readonly string[];
  readonly enabled: boolean;
}

export interface NetworkProfile {
  readonly kind: 'testnet' | 'mainnet';
  readonly label: string;
  readonly isMainnet: boolean;
  readonly isConfigured: boolean;
  readonly farChains: readonly ChainDisplay[];
  readonly bch: BchChainDisplay;
  readonly limits: {
    readonly minUsdMicros: bigint;
    readonly maxUsdMicros: bigint;
    readonly fastLaneMaxUsdMicros: bigint;
  };
}

export const TESTNET_CHAINS: readonly ChainDisplay[] = [
  {
    id: 84532,
    name: 'Base Sepolia',
    shortName: 'Base',
    type: 'evm',
    tokenSymbols: ['USDC'],
    enabled: true,
    order: 1,
  },
  {
    id: 11155111,
    name: 'Ethereum Sepolia',
    shortName: 'Ethereum',
    type: 'evm',
    tokenSymbols: ['USDC'],
    enabled: true,
    order: 2,
  },
  {
    id: 421614,
    name: 'Arbitrum Sepolia',
    shortName: 'Arbitrum',
    type: 'evm',
    tokenSymbols: ['USDC'],
    enabled: true,
    order: 3,
  },
  {
    id: 97,
    name: 'BNB Smart Chain Testnet',
    shortName: 'BSC',
    type: 'evm',
    tokenSymbols: ['USDT'],
    enabled: true,
    order: 4,
  },
];

export const TESTNET_BCH: BchChainDisplay = {
  name: 'Bitcoin Cash Chipnet',
  network: 'chipnet',
  prefix: 'bchtest',
  tokenSymbols: ['tPUSD', 'tMUSD'],
  enabled: true,
};

export const TESTNET_PROFILE: NetworkProfile = {
  kind: 'testnet',
  label: 'Testnet',
  isMainnet: false,
  isConfigured: true,
  farChains: TESTNET_CHAINS,
  bch: TESTNET_BCH,
  limits: {
    minUsdMicros: 1_000_000n, // $1.00 minimum
    maxUsdMicros: 100_000_000n, // $100.00 maximum testnet
    fastLaneMaxUsdMicros: 25_000_000n, // $25.00 fast lane limit
  },
};

export const MAINNET_PROFILE: NetworkProfile = {
  kind: 'mainnet',
  label: 'Mainnet',
  isMainnet: true,
  isConfigured: false,
  farChains: [],
  bch: {
    name: 'Bitcoin Cash',
    network: 'mainnet',
    prefix: 'bitcoincash',
    tokenSymbols: ['PUSD', 'MUSD'],
    enabled: false,
  },
  limits: {
    minUsdMicros: 1_000_000n,
    maxUsdMicros: 500_000_000n,
    fastLaneMaxUsdMicros: 25_000_000n,
  },
};

export function readNetworkSetting(envVar?: string): {
  kind: 'testnet' | 'mainnet';
  error?: string;
} {
  if (!envVar || envVar === 'testnet') {
    return { kind: 'testnet' };
  }
  if (envVar === 'mainnet') {
    return {
      kind: 'mainnet',
      error:
        'Mainnet profile selected, but mainnet deployment is not configured.',
    };
  }
  return {
    kind: 'testnet',
    error: `Unknown VITE_NETWORK value "${envVar}". Defaulting to testnet.`,
  };
}

export function networkConfigErrors(
  profile: NetworkProfile,
  envError?: string,
): readonly string[] {
  const errors: string[] = [];
  if (envError) errors.push(envError);
  if (profile.isMainnet && !profile.isConfigured) {
    errors.push(
      'Mainnet deployment contracts and parameters are not yet configured.',
    );
  }
  if (profile.farChains.length === 0) {
    errors.push('No counterparty chains configured for this profile.');
  }
  return errors;
}
