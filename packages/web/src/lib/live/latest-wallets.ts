import type { BchWallet, EvmWallet } from '../wallet/types';

/**
 * A wallet that always answers from the newest wallet object. The page builds its swap session
 * once, but the wallets are re-created on every render (a connection finishing, a reconnect):
 * a session that kept the first object signed with a wallet that had no connection, and said
 * "Connect a WizardConnect wallet first" while the pill showed Connected.
 */
export function latestWallet<T extends EvmWallet | BchWallet>(
  current: () => T | undefined,
): T {
  return new Proxy({} as T, {
    get(_target, property) {
      const wallet = current();
      if (!wallet) return undefined;
      const value = (wallet as unknown as Record<PropertyKey, unknown>)[
        property
      ];
      return typeof value === 'function'
        ? (value as (...args: unknown[]) => unknown).bind(wallet)
        : value;
    },
  });
}
