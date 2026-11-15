export interface SupportedToken {
  readonly symbol: string;
  readonly name: string;
  readonly decimals: number;
  readonly addressOrCategory: string;
}

export interface FarChain {
  readonly id: string | number;
  readonly name: string;
  readonly type: 'evm' | 'solana' | 'tron';
  readonly rpcUrl: string;
  readonly explorerUrl: string;
  readonly htlcAddress: string;
  readonly tokens: readonly SupportedToken[];
}

export interface BchChain {
  readonly name: string;
  readonly network: 'chipnet' | 'mainnet';
  readonly prefix: 'bchtest' | 'bitcoincash';
  readonly electrumUrls: readonly string[];
  readonly explorerUrl: string;
  readonly pusdCategory: string;
  readonly musdCategory: string;
  readonly decimals: number;
  readonly pusdSymbol: string;
  readonly musdSymbol: string;
  readonly tokens: readonly SupportedToken[];
}

export interface NetworkProfile {
  readonly kind: 'testnet' | 'mainnet';
  readonly label: string;
  readonly isMainnet: boolean;
  readonly isConfigured: boolean;
  readonly farChains: readonly FarChain[];
  readonly bch: BchChain;
  readonly limits: {
    readonly minUsdMicros: bigint;
    readonly maxUsdMicros: bigint;
    readonly fastLaneMaxUsdMicros: bigint;
  };
}

export const TESTNET_PROFILE: NetworkProfile = {
  kind: 'testnet',
  label: 'Testnet',
  isMainnet: false,
  isConfigured: true,
  farChains: [
    {
      id: 84532,
      name: 'Base Sepolia',
      type: 'evm',
      rpcUrl: 'https://sepolia.base.org',
      explorerUrl: 'https://sepolia.basescan.org',
      htlcAddress: '0x5A0C062f4B7b8fF2263530e12bc15De9C836a641',
      tokens: [
        {
          symbol: 'USDC',
          name: 'USD Coin',
          decimals: 6,
          addressOrCategory: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
        },
      ],
    },
    {
      id: 11155111,
      name: 'Ethereum Sepolia',
      type: 'evm',
      rpcUrl: 'https://rpc.sepolia.org',
      explorerUrl: 'https://sepolia.etherscan.io',
      htlcAddress: '0x5A0C062f4B7b8fF2263530e12bc15De9C836a641',
      tokens: [
        {
          symbol: 'USDC',
          name: 'USD Coin',
          decimals: 6,
          addressOrCategory: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
        },
      ],
    },
    {
      id: 421614,
      name: 'Arbitrum Sepolia',
      type: 'evm',
      rpcUrl: 'https://sepolia-rollup.arbitrum.io/rpc',
      explorerUrl: 'https://sepolia.arbiscan.io',
      htlcAddress: '0x5A0C062f4B7b8fF2263530e12bc15De9C836a641',
      tokens: [
        {
          symbol: 'USDC',
          name: 'USD Coin',
          decimals: 6,
          addressOrCategory: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
        },
      ],
    },
    {
      id: 'solana-devnet',
      name: 'Solana Devnet',
      type: 'solana',
      rpcUrl: 'https://api.devnet.solana.com',
      explorerUrl: 'https://explorer.solana.com/?cluster=devnet',
      htlcAddress: 'DbFyFKCGHZ7Pb3rUsbGtNhYcrvmbGm3qx4mnF4fYnyqN',
      tokens: [
        {
          symbol: 'USDC',
          name: 'USD Coin',
          decimals: 6,
          addressOrCategory: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
        },
      ],
    },
    {
      id: 'tron-nile',
      name: 'TRON Nile',
      type: 'tron',
      rpcUrl: 'https://nile.trongrid.io',
      explorerUrl: 'https://nile.tronscan.org',
      htlcAddress: 'TN2gn3GTuTHkZ3dmgitZr78VpSiwr4Epxs',
      tokens: [
        {
          symbol: 'USDT',
          name: 'Tether USD',
          decimals: 6,
          addressOrCategory: 'TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf',
        },
      ],
    },
    {
      id: 97,
      name: 'BSC Testnet',
      type: 'evm',
      rpcUrl: 'https://data-seed-prebsc-1-s1.binance.org:8545',
      explorerUrl: 'https://testnet.bscscan.com',
      htlcAddress: '0x5A0C062f4B7b8fF2263530e12bc15De9C836a641',
      tokens: [
        {
          symbol: 'USDT',
          name: 'Tether USD',
          decimals: 18,
          addressOrCategory: '0x7ef95a0FEE0Dd31b22626fA2e10Ee6A223F8a684',
        },
      ],
    },
  ],
  bch: {
    name: 'Bitcoin Cash Chipnet',
    network: 'chipnet',
    prefix: 'bchtest',
    electrumUrls: [
      'wss://chipnet.imaginary.cash:50004',
      'wss://blackie.c3-soft.com:64004',
    ],
    explorerUrl: 'https://chipnet.imaginary.cash',
    pusdCategory:
      'ec335fd3ffa45f80cef7217cf98e8adf562df5a3e33f354f69df2951703586ac',
    musdCategory:
      'c99627aec3e041f281068704c2609699d234586d5097301eff995f3bd00ac04d',
    decimals: 2,
    pusdSymbol: 'tPUSD',
    musdSymbol: 'tMUSD',
    tokens: [
      {
        symbol: 'tPUSD',
        name: 'Testnet Paryon USD',
        decimals: 2,
        addressOrCategory:
          'ec335fd3ffa45f80cef7217cf98e8adf562df5a3e33f354f69df2951703586ac',
      },
      {
        symbol: 'tMUSD',
        name: 'Testnet MUSD',
        decimals: 2,
        addressOrCategory:
          'c99627aec3e041f281068704c2609699d234586d5097301eff995f3bd00ac04d',
      },
    ],
  },
  limits: {
    minUsdMicros: 1_000_000n, // $1
    maxUsdMicros: 100_000_000n, // $100
    fastLaneMaxUsdMicros: 25_000_000n, // $25
  },
};

// Mainnet profile is empty-by-default and unconfigured.
export const MAINNET_PROFILE: NetworkProfile = {
  kind: 'mainnet',
  label: 'Mainnet',
  isMainnet: true,
  isConfigured: false,
  farChains: [],
  bch: {
    name: 'Bitcoin Cash Mainnet',
    network: 'mainnet',
    prefix: 'bitcoincash',
    electrumUrls: [],
    explorerUrl: '',
    pusdCategory: '',
    musdCategory: '',
    decimals: 2,
    pusdSymbol: 'PUSD',
    musdSymbol: 'MUSD',
    tokens: [],
  },
  limits: {
    minUsdMicros: 1_000_000n,
    maxUsdMicros: 0n,
    fastLaneMaxUsdMicros: 0n,
  },
};

export function readNetworkSetting(envVal?: string): {
  kind: 'testnet' | 'mainnet';
  error?: string;
} {
  const raw = (envVal ?? '').trim().toLowerCase();
  if (!raw || raw === 'testnet') {
    return { kind: 'testnet' };
  }
  if (raw === 'mainnet') {
    return {
      kind: 'mainnet',
      error: 'Mainnet profile is not configured for public operation.',
    };
  }
  return {
    kind: 'testnet',
    error: `Unrecognized VITE_NETWORK "${raw}". Defaulting to testnet.`,
  };
}

export function networkConfigErrors(
  profile: NetworkProfile,
  extraError?: string,
): readonly string[] {
  const errors: string[] = [];
  if (extraError) errors.push(extraError);
  if (profile.isMainnet && !profile.isConfigured) {
    errors.push(
      'Mainnet deployment contracts and parameters are not yet configured.',
    );
  }
  return errors;
}
