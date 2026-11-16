/**
 * Chain display configuration for Ferry Web UI.
 *
 * NOTE: Consumes display facts from @ferry/chain-config loadChainDisplay().
 * Carries NO chain facts (no RPC URLs, no token contract addresses, no HTLC addresses, no Electrum endpoints).
 * Out-of-scope networks are excluded.
 */
import {
  loadChainDisplay,
  type AssetSymbol,
  type ChainDisplayResult,
  type ChainId,
} from '@ferry/chain-config';
import chainsData from '../../../chain-config/src/data/chains.json';

export interface SupportedTokenDisplay {
  readonly symbol: AssetSymbol | string;
  readonly name: string;
  readonly decimals: number;
}

export interface ChainDisplay {
  readonly id: string | number;
  readonly chainKey?: ChainId;
  readonly name: string;
  readonly shortName?: string;
  readonly type: 'evm';
  readonly tokenSymbols: readonly (AssetSymbol | string)[];
  readonly enabled: boolean;
  readonly disabledReason: string | null;
  readonly priceSource?: string;
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

/**
 * Loads chain display view from @ferry/chain-config facts (FR-14, FR-17, Requirement 4).
 * Disabled routes carry their specific disabledReason.
 */
export function loadFarChainsFromFacts(
  network: 'testnet' | 'mainnet',
): readonly ChainDisplay[] {
  const envRoutes =
    typeof import.meta !== 'undefined' && import.meta.env?.VITE_ENABLED_ROUTES
      ? (import.meta.env.VITE_ENABLED_ROUTES as string)
      : isMainnetEnv
        ? undefined
        : 'usdc:base,usdc:ethereum,usdc:arbitrum';

  const result: ChainDisplayResult = loadChainDisplay({
    network,
    data: chainsData,
    ...(envRoutes !== undefined ? { env: { ENABLED_ROUTES: envRoutes } } : {}),
  });

  return result.chains.map((chain, index) => ({
    id: chain.chainId,
    chainKey: chain.id,
    name: chain.name,
    shortName: chain.name.split(' ')[0] ?? chain.name,
    type: 'evm' as const,
    tokenSymbols: chain.tokenSymbols.length > 0 ? chain.tokenSymbols : ['USDC'],
    enabled: chain.enabled,
    disabledReason: chain.disabledReason,
    priceSource: chain.priceSource,
    order: index + 1,
  }));
}

// Default to mainnet profile in production/default builds per human decision:
// "no testnet swaps; small mainnet swaps first, so the default production build must be the mainnet profile".
const isMainnetEnv = import.meta.env.VITE_NETWORK !== 'testnet';

export const TESTNET_CHAINS: readonly ChainDisplay[] = isMainnetEnv
  ? []
  : loadFarChainsFromFacts('testnet');
export const MAINNET_CHAINS_FROM_FACTS: readonly ChainDisplay[] =
  loadFarChainsFromFacts('mainnet');

export const TESTNET_BCH: BchChainDisplay = isMainnetEnv
  ? {
      name: 'Bitcoin Cash',
      network: 'mainnet',
      prefix: 'bitcoincash',
      tokenSymbols: ['PUSD', 'MUSD'],
      enabled: true,
    }
  : {
      name: 'Bitcoin Cash Chipnet',
      network: 'chipnet',
      prefix: 'bchtest',
      tokenSymbols: ['tPUSD', 'tMUSD'],
      enabled: true,
    };

export const TESTNET_PROFILE: NetworkProfile = isMainnetEnv
  ? {
      kind: 'mainnet',
      label: 'Mainnet',
      isMainnet: true,
      isConfigured: true,
      farChains: MAINNET_CHAINS_FROM_FACTS,
      bch: TESTNET_BCH,
      limits: {
        minUsdMicros: 1_000_000n,
        maxUsdMicros: 100_000_000n,
        fastLaneMaxUsdMicros: 25_000_000n,
      },
    }
  : {
      kind: 'testnet',
      label: 'Testnet',
      isMainnet: false,
      isConfigured: true,
      farChains: TESTNET_CHAINS,
      bch: TESTNET_BCH,
      limits: {
        minUsdMicros: 1_000_000n, // $1.00 minimum
        maxUsdMicros: 100_000_000n, // $100.00 maximum
        fastLaneMaxUsdMicros: 25_000_000n, // $25.00 fast lane limit
      },
    };

export interface BannerCheckValues {
  readonly deckUrl?: string;
  readonly repoUrl?: string;
  readonly emberAddress?: string;
  readonly priorRepoUrl?: string;
  readonly priorDemoUrl?: string;
}

/**
 * Checks whether mainnet profile values are fully provided (Requirement 6):
 * - Chain list from facts has enabled routes
 * - Solver URLs are configured
 * - Banner values (deck, repo, ember, prior links) are supplied
 */
export function isMainnetProfileConfigured(
  chains: readonly ChainDisplay[] = MAINNET_CHAINS_FROM_FACTS,
  solverUrls?: string,
  banner?: BannerCheckValues,
): boolean {
  const hasChains = chains.length > 0;

  const urls =
    solverUrls ??
    (typeof import.meta !== 'undefined'
      ? (import.meta.env?.VITE_SOLVER_URLS as string | undefined)
      : undefined);
  const hasSolver = Boolean(urls && urls.trim().length > 0);

  const deck =
    banner?.deckUrl ??
    (typeof import.meta !== 'undefined'
      ? (import.meta.env?.VITE_DECK_URL as string | undefined)
      : '');
  const repo =
    banner?.repoUrl ??
    (typeof import.meta !== 'undefined'
      ? (import.meta.env?.VITE_REPO_URL as string | undefined)
      : '');
  const ember =
    banner?.emberAddress ??
    (typeof import.meta !== 'undefined'
      ? (import.meta.env?.VITE_EMBER_ADDRESS as string | undefined)
      : '');
  const priorRepo =
    banner?.priorRepoUrl ??
    (typeof import.meta !== 'undefined'
      ? (import.meta.env?.VITE_PRIOR_REPO_URL as string | undefined)
      : '');

  const hasBanner = Boolean(
    deck?.trim() && repo?.trim() && ember?.trim() && priorRepo?.trim(),
  );

  return hasChains && hasSolver && hasBanner;
}

const mainnetConfigured = isMainnetProfileConfigured();

export const MAINNET_PROFILE: NetworkProfile = {
  kind: 'mainnet',
  label: 'Mainnet',
  isMainnet: true,
  isConfigured: mainnetConfigured,
  farChains: mainnetConfigured ? MAINNET_CHAINS_FROM_FACTS : [],
  bch: {
    name: 'Bitcoin Cash',
    network: 'mainnet',
    prefix: 'bitcoincash',
    tokenSymbols: ['PUSD', 'MUSD'],
    enabled: mainnetConfigured,
  },
  limits: {
    minUsdMicros: 1_000_000n,
    maxUsdMicros: 500_000_000n,
    fastLaneMaxUsdMicros: 25_000_000n,
  },
};

export function readNetworkSetting(
  envVar?: string,
  mainnetConfiguredFlag: boolean = isMainnetProfileConfigured(),
): {
  kind: 'testnet' | 'mainnet';
  error?: string;
} {
  if (envVar === 'testnet') {
    return { kind: 'testnet' };
  }
  if (envVar === 'mainnet' || (envVar === undefined && isMainnetEnv)) {
    if (mainnetConfiguredFlag) {
      return { kind: 'mainnet' };
    }
    return {
      kind: 'mainnet',
      error:
        'Mainnet profile selected, but mainnet deployment is not configured.',
    };
  }

  return { kind: 'testnet' };
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
