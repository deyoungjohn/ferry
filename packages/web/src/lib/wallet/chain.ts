import { decodeCashAddress, type CashAddrPrefix } from '@ferry/core';

export interface BchPrefixCheckResult {
  readonly ok: boolean;
  readonly prefix?: CashAddrPrefix;
  readonly error?: string;
}

/**
 * Validates that a connected BCH address matches the expected network prefix
 * (e.g. 'bchtest' for Chipnet, 'bitcoincash' for Mainnet).
 * Refuses cross-network connections with an explicit message.
 */
export function validateBchAddressPrefix(
  address: string,
  expectedPrefix: 'bchtest' | 'bitcoincash',
): BchPrefixCheckResult {
  if (!address || typeof address !== 'string') {
    return {
      ok: false,
      error: 'No address provided to validate.',
    };
  }

  try {
    const decoded = decodeCashAddress(address);
    if (decoded.prefix !== expectedPrefix) {
      const targetNetwork =
        expectedPrefix === 'bchtest' ? 'Bitcoin Cash Chipnet' : 'Bitcoin Cash';
      const detectedNetwork =
        decoded.prefix === 'bitcoincash'
          ? 'Bitcoin Cash Mainnet'
          : decoded.prefix === 'bchtest'
            ? 'Chipnet'
            : decoded.prefix;

      return {
        ok: false,
        prefix: decoded.prefix,
        error: `Wallet network mismatch: Connected wallet returned an address on ${detectedNetwork} (${decoded.prefix}:), but this application is configured for ${targetNetwork} (${expectedPrefix}:). Please switch the active network in your wallet.`,
      };
    }
    return { ok: true, prefix: decoded.prefix };
  } catch (cause) {
    return {
      ok: false,
      error: `Invalid Bitcoin Cash address: ${cause instanceof Error ? cause.message : String(cause)}`,
    };
  }
}

export function isWrongEvmChain(
  chainId: number | undefined,
  expectedChainId: number,
): boolean {
  return chainId !== undefined && chainId !== expectedChainId;
}

export function wrongEvmChainMessage(
  expectedChainId: number,
  expectedChainName = 'Base Sepolia',
): string {
  return `Switch your wallet to ${expectedChainName} (chain ${expectedChainId}).`;
}
