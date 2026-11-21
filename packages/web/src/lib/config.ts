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
  deckUrl:
    (import.meta.env?.VITE_DECK_URL as string | undefined) ||
    'https://docs.google.com/presentation/d/1-em8pmYnA6xlYXG2xfLIS0Mf6SMBZfAPY4efuB0gxWM/edit?usp=sharing',
  repoUrl:
    (import.meta.env?.VITE_REPO_URL as string | undefined) ??
    'https://github.com/deyoungjohn/ferry',
  licenseUrl:
    (import.meta.env?.VITE_LICENSE_URL as string | undefined) ??
    'https://github.com/deyoungjohn/ferry/blob/main/LICENSE',
  // The team's token-aware address for EMBER2026 donations (Community Choice voting).
  emberAddress:
    (import.meta.env?.VITE_EMBER_ADDRESS as string | undefined) ||
    'bitcoincash:zplzkjj2qj7u66w3aqggxw4d392elac005qk68ff65',
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
  // Prior work is shown only when set; Ferry's repository was created for this event.
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

export const SPREAD_BPS = 5; // 0.05%: the solver's current setting (used only for a price estimate when the solver gives none)
export const FIXED_FEE_USD = 0.05; // $0.05 fixed network cost offset

export const REOWN_PROJECT_ID =
  (import.meta.env?.VITE_REOWN_PROJECT_ID as string | undefined) ?? '';

/**
 * Whether the page may lock funds for a swap. Off unless the build says so, and
 * the solver must also be accepting quotes; until then the swap button says so.
 */
export const LIVE_EXECUTION_ENABLED =
  import.meta.env?.VITE_LIVE_EXECUTION === '1';

/**
 * Optional custom WizardConnect relay URLs.
 * Off by default; when unset or empty, WizardConnect uses its built-in relays:
 * ["wss://relay.riften.net:443", "wss://relay.cauldron.quest:443"].
 * Format: comma-separated list of WebSocket URLs (e.g. "wss://relay.example.com:443").
 */
/**
 * Switch for Ferry's own pairing relay (`VITE_WIZARD_RELAY=on`). Off by default: WizardConnect then
 * runs exactly as before the relay work (its built-in public relays, no relay list passed, and a
 * restored session that does not answer within 8 s is cleared). On: Ferry's relay in
 * `VITE_WIZARD_RELAY_URLS` is probed before each pairing, the relays a session used are saved,
 * and a restored session is kept while the wallet is asleep. Turn it on only once the relay runs.
 */
export const WIZARD_RELAY_ENABLED =
  (import.meta.env?.VITE_WIZARD_RELAY as string | undefined) === 'on';

export const WIZARD_RELAY_URLS: readonly string[] = (
  (import.meta.env?.VITE_WIZARD_RELAY_URLS as string | undefined) ?? ''
)
  .split(',')
  .map((url) => url.trim())
  .filter((url) => url.length > 0);
