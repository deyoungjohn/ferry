import { createAppKit } from '@reown/appkit/react';
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi';
import { createConfig, http } from 'wagmi';
import {
  baseSepolia,
  sepolia,
  arbitrumSepolia,
  bscTestnet,
} from 'wagmi/chains';
import type { ChainAdapter } from '@reown/appkit';
import type { AppKitNetwork } from '@reown/appkit/networks';
import { REOWN_PROJECT_ID } from '../config';

export const SUPPORTED_CHAINS = [
  baseSepolia,
  sepolia,
  arbitrumSepolia,
  bscTestnet,
] as const;

const networks = SUPPORTED_CHAINS as unknown as [
  AppKitNetwork,
  ...AppKitNetwork[],
];

export const wagmiAdapter = REOWN_PROJECT_ID
  ? new WagmiAdapter({
      networks,
      projectId: REOWN_PROJECT_ID,
      transports: {
        [baseSepolia.id]: http(),
        [sepolia.id]: http(),
        [arbitrumSepolia.id]: http(),
        [bscTestnet.id]: http(),
      },
    })
  : null;

if (wagmiAdapter && REOWN_PROJECT_ID) {
  try {
    createAppKit({
      adapters: [wagmiAdapter as unknown as ChainAdapter],
      networks,
      projectId: REOWN_PROJECT_ID,
      metadata: {
        name: 'Ferry',
        description: 'Move dollars onto Bitcoin Cash without a bridge.',
        url:
          typeof window !== 'undefined'
            ? window.location.origin
            : 'https://ferry.cash',
        icons: [],
      },
      defaultNetwork: baseSepolia as unknown as AppKitNetwork,
      features: {
        analytics: false,
        email: false,
        socials: false,
        swaps: false,
        onramp: false,
      },
      themeMode: 'dark',
      themeVariables: {
        '--w3m-accent': '#c6f219',
        '--w3m-border-radius-master': '999px',
      },
    });
  } catch {
    // Ignore duplicate AppKit initialization in fast-refresh dev environments
  }
}

export const wagmiConfig =
  wagmiAdapter?.wagmiConfig ??
  createConfig({
    chains: [baseSepolia, sepolia, arbitrumSepolia, bscTestnet],
    transports: {
      [baseSepolia.id]: http(),
      [sepolia.id]: http(),
      [arbitrumSepolia.id]: http(),
      [bscTestnet.id]: http(),
    },
  });
