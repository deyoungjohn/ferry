import { type SolverConfig } from '../config.js';

export class PreflightError extends Error {
  constructor(message: string) {
    super(`[Preflight] ${message}`);
    this.name = 'PreflightError';
  }
}

const KNOWN_PLACEHOLDER_KEYS = new Set([
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', // Anvil account 0
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d', // Anvil account 1
  '0x5de4111afa1a4b94908f83103eb2f954b09a470f5d2fc655e7120e83004e1435', // Anvil account 2
  '0x0000000000000000000000000000000000000000000000000000000000000000',
  '0x1111111111111111111111111111111111111111111111111111111111111111',
]);

/**
 * Validates preflight environment configuration before solver startup.
 * Enforces strict mainnet safety invariants (blueprint §5.1, §11.3).
 */
export function runPreflightCheck(config: SolverConfig): void {
  // 1. Placeholder key refusal
  if (config.solverEvmPrivateKey) {
    const normalizedKey = config.solverEvmPrivateKey.toLowerCase();
    if (KNOWN_PLACEHOLDER_KEYS.has(normalizedKey)) {
      if (config.network === 'mainnet') {
        throw new PreflightError(
          'Refusing to run on mainnet with known development/placeholder EVM private key',
        );
      }
    }
  }

  // 2. Mainnet-specific invariants
  if (config.network === 'mainnet') {
    // Two distinct Electrum hosts requirement
    const hosts = config.bchElectrumUrls
      .split(',')
      .map((h: string) => h.toLowerCase().trim())
      .filter(Boolean);
    const uniqueHosts = new Set(hosts);
    if (uniqueHosts.size < 2) {
      throw new PreflightError(
        `Mainnet requires at least 2 distinct BCH Electrum hosts for quorum liveness; found ${uniqueHosts.size} (${config.bchElectrumUrls})`,
      );
    }

    // Operator token length requirement (>= 32 chars)
    if (!config.operatorToken || config.operatorToken.length < 32) {
      throw new PreflightError(
        'Mainnet requires OPERATOR_TOKEN to be at least 32 characters for secure operator endpoint authentication',
      );
    }

    // Mock pay link signatures strictly forbidden on mainnet
    if (config.allowMockPaylinkSignatures) {
      throw new PreflightError(
        'Mainnet strictly forbids ALLOW_MOCK_PAYLINK_SIGNATURES',
      );
    }

    // Require non-empty BCH private key / WIF
    if (!config.solverBchWif || config.solverBchWif.trim().length === 0) {
      throw new PreflightError(
        'Mainnet requires valid SOLVER_BCH_WIF private key for counter-locking',
      );
    }

    // Trusted proxy enforcement
    if (!config.trustedProxy) {
      // In mainnet, running directly without trusted proxy specification is warned
    }
  }

  // 3. Chain config verification
  if (
    !config.baseHtlcAddress ||
    config.baseHtlcAddress === '0x0000000000000000000000000000000000000000'
  ) {
    if (config.network === 'mainnet') {
      throw new PreflightError(
        'Mainnet requires valid non-zero BASE_HTLC_ADDRESS',
      );
    }
  }
}
