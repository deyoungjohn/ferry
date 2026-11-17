import { createAppKit } from '@reown/appkit/react';
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi';
import { createConfig, http } from 'wagmi';
import { base, mainnet, arbitrum, bsc } from 'wagmi/chains';
import type { ChainAdapter } from '@reown/appkit';
import type { AppKitNetwork } from '@reown/appkit/networks';
import { REOWN_PROJECT_ID } from '../config';

export const SUPPORTED_CHAINS = [base, mainnet, arbitrum, bsc] as const;

const networks = SUPPORTED_CHAINS as unknown as [
  AppKitNetwork,
  ...AppKitNetwork[],
];

export const wagmiAdapter = REOWN_PROJECT_ID
  ? new WagmiAdapter({
      networks,
      projectId: REOWN_PROJECT_ID,
      transports: {
        [base.id]: http(),
        [mainnet.id]: http(),
        [arbitrum.id]: http(),
        [bsc.id]: http(),
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
            : 'https://ferry.incepture.dev',
        icons: [],
      },
      defaultNetwork: base as unknown as AppKitNetwork,
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
    chains: [base, mainnet, arbitrum, bsc],
    transports: {
      [base.id]: http(),
      [mainnet.id]: http(),
      [arbitrum.id]: http(),
      [bsc.id]: http(),
    },
  });
