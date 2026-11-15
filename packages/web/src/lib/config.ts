import {
  MAINNET_PROFILE,
  TESTNET_PROFILE,
  readNetworkSetting,
  networkConfigErrors,
  type NetworkProfile,
} from './network';

const setting = readNetworkSetting(import.meta.env?.VITE_NETWORK);

export const NETWORK_KIND = setting.kind;
export const NETWORK_PROFILE: NetworkProfile =
  setting.kind === 'mainnet' ? MAINNET_PROFILE : TESTNET_PROFILE;
export const IS_MAINNET = NETWORK_PROFILE.isMainnet;
export const NETWORK_LABEL = NETWORK_PROFILE.label;
export const NETWORK_CONFIG_ERRORS = networkConfigErrors(
  NETWORK_PROFILE,
  setting.error,
);

export interface BannerConfig {
  readonly deckUrl: string;
  readonly repoUrl: string;
  readonly emberAddress: string;
  readonly priorRepoUrl: string;
  readonly priorDemoUrl: string;
}

/**
 * Banner configuration.
 * Clearly marked empty values indicate missing deployment assets.
 * When any value is empty, the banner displays a visible build warning on screen.
 * NEVER invent an address.
 */
export const BANNER_CONFIG: BannerConfig = {
  deckUrl: '',
  repoUrl: 'https://github.com/deyoungjohn/ferry',
  emberAddress: '', // Empty until an official EMBER2026 address is designated
  priorRepoUrl: '',
  priorDemoUrl: '',
};

export function getBannerWarnings(
  config: BannerConfig = BANNER_CONFIG,
): readonly string[] {
  const warnings: string[] = [];
  if (!config.deckUrl.trim()) warnings.push('Deck URL is unset');
  if (!config.repoUrl.trim()) warnings.push('Repo URL is unset');
  if (!config.emberAddress.trim()) warnings.push('EMBER2026 address is unset');
  if (!config.priorRepoUrl.trim()) warnings.push('Prior repo URL is unset');
  if (!config.priorDemoUrl.trim()) warnings.push('Prior demo URL is unset');
  return warnings;
}

export const SPREAD_BPS = 40; // 0.40%
export const FIXED_FEE_USD = 0.05; // $0.05 fixed network cost offset
