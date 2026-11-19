import { createAppKit } from '@reown/appkit/react';
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi';
import { createConfig, http } from 'wagmi';
import { defineChain } from 'viem';
import { base, mainnet, arbitrum, bsc } from 'wagmi/chains';
import type { ChainAdapter } from '@reown/appkit';
import type { AppKitNetwork } from '@reown/appkit/networks';
import { REOWN_PROJECT_ID } from '../config';

// Chains wagmi does not ship: from the recorded chain facts (endpoints and explorers).
export const arc = defineChain({
  id: 5042,
  name: 'Arc',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.mainnet.arc.io'] } },
  blockExplorers: {
    default: { name: 'Arc Explorer', url: 'https://explorer.arc.io' },
  },
});

export const robinhood = defineChain({
  id: 4663,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.mainnet.chain.robinhood.com'] } },
  blockExplorers: {
    default: {
      name: 'Blockscout',
      url: 'https://robinhoodchain.blockscout.com',
    },
  },
});

export const SUPPORTED_CHAINS = [
  base,
  mainnet,
  arbitrum,
  bsc,
  arc,
  robinhood,
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
        [base.id]: http(),
        [mainnet.id]: http(),
        [arbitrum.id]: http(),
        [bsc.id]: http(),
        [arc.id]: http(),
        [robinhood.id]: http(),
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
        description: 'Move stablecoins onto Bitcoin Cash without a bridge.',
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
    chains: SUPPORTED_CHAINS,
    transports: {
      [base.id]: http(),
      [mainnet.id]: http(),
      [arbitrum.id]: http(),
      [bsc.id]: http(),
      [arc.id]: http(),
      [robinhood.id]: http(),
    },
  });
