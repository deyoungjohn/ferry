import type { Hex32 } from '@ferry/core';
import type { RecoveryStorePort } from '@ferry/user-flow';

const PREFIX = 'ferry.recovery.';

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Keeps the recovery file (which holds the swap secret) in this browser, so a
 * reload in the middle of a swap can pick it up again. The page also offers the
 * same file as a download, because browser storage can be cleared.
 */
export function createLocalRecoveryStore(
  area: Storage | null = storage(),
): RecoveryStorePort {
  return {
    save(orderId: Hex32, json: string): Promise<void> {
      if (!area) {
        return Promise.reject(
          new Error('This browser cannot keep the recovery file.'),
        );
      }
      try {
        area.setItem(PREFIX + orderId, json);
        return Promise.resolve();
      } catch (cause) {
        return Promise.reject(
          new Error('This browser could not save the recovery file.', {
            cause,
          }),
        );
      }
    },
    load(orderId: Hex32): Promise<string | null> {
      try {
        return Promise.resolve(area?.getItem(PREFIX + orderId) ?? null);
      } catch {
        return Promise.resolve(null);
      }
    },
    list(): Promise<readonly Hex32[]> {
      const ids: Hex32[] = [];
      try {
        for (let i = 0; area && i < area.length; i += 1) {
          const key = area.key(i);
          if (key?.startsWith(PREFIX))
            ids.push(key.slice(PREFIX.length) as Hex32);
        }
      } catch {
        // an unreadable store lists nothing
      }
      return Promise.resolve(ids);
    },
  };
}
