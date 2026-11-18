import {
  MAINNET_PROFILE,
  TESTNET_PROFILE,
  MAINNET_CHAINS_FROM_FACTS,
  readNetworkSetting,
  networkConfigErrors,
  isMainnetProfileConfigured,
  type NetworkProfile,
} from './network';

export interface BannerConfig {
  readonly deckUrl: string;
  readonly repoUrl: string;
  readonly emberAddress: string;
  readonly priorRepoUrl: string;
  readonly priorDemoUrl: string;
  readonly licenseUrl?: string;
}

/**
 * Banner configuration.
 * Clearly marked empty values indicate missing deployment assets.
 * When any value is empty, the banner displays a visible build warning on screen.
 * NEVER invent an address.
 */
export const BANNER_CONFIG: BannerConfig = {
  deckUrl: (import.meta.env?.VITE_DECK_URL as string | undefined) ?? '',
  repoUrl:
    (import.meta.env?.VITE_REPO_URL as string | undefined) ??
    'https://github.com/deyoungjohn/ferry',
  licenseUrl:
    (import.meta.env?.VITE_LICENSE_URL as string | undefined) ??
    'https://github.com/deyoungjohn/ferry/blob/main/LICENSE',
  emberAddress:
    (import.meta.env?.VITE_EMBER_ADDRESS as string | undefined) ?? '', // Empty until an official EMBER2026 address is designated
  priorRepoUrl:
    (import.meta.env?.VITE_PRIOR_REPO_URL as string | undefined) ?? '',
  priorDemoUrl:
    (import.meta.env?.VITE_PRIOR_DEMO_URL as string | undefined) ?? '',
};

export function getBannerWarnings(
  config: BannerConfig = BANNER_CONFIG,
): readonly string[] {
  const warnings: string[] = [];
  if (!config.deckUrl.trim()) warnings.push('Deck URL is unset');
  if (!config.repoUrl.trim()) warnings.push('Repo URL is unset');
  if (!config.emberAddress.trim()) warnings.push('EMBER2026 address is unset');
  if (!config.priorRepoUrl.trim()) warnings.push('Prior repo URL is unset');
  return warnings;
}

const mainnetConfigured = isMainnetProfileConfigured(
  MAINNET_CHAINS_FROM_FACTS,
  import.meta.env?.VITE_SOLVER_URLS,
  BANNER_CONFIG,
);

const setting = readNetworkSetting(
  import.meta.env?.VITE_NETWORK,
  mainnetConfigured,
);

export const NETWORK_KIND = setting.kind;
export const NETWORK_PROFILE: NetworkProfile =
  setting.kind === 'mainnet'
    ? {
        ...MAINNET_PROFILE,
        isConfigured: mainnetConfigured,
        farChains: mainnetConfigured ? MAINNET_CHAINS_FROM_FACTS : [],
      }
    : TESTNET_PROFILE;

export const IS_MAINNET = NETWORK_PROFILE.isMainnet;
export const NETWORK_LABEL = NETWORK_PROFILE.label;
export const NETWORK_CONFIG_ERRORS = networkConfigErrors(
  NETWORK_PROFILE,
  setting.error,
);

export const SPREAD_BPS = 40; // 0.40%
export const FIXED_FEE_USD = 0.05; // $0.05 fixed network cost offset

export const REOWN_PROJECT_ID =
  (import.meta.env?.VITE_REOWN_PROJECT_ID as string | undefined) ?? '';

/**
 * Whether the page may lock funds for a swap. Off unless the build says so, and
 * the solver must also be accepting quotes; until then the swap button says so.
 */
export const LIVE_EXECUTION_ENABLED =
  import.meta.env?.VITE_LIVE_EXECUTION === '1';
