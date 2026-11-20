import {
  RECOVERY_SCAN_GAP,
  swapSecretAt,
  swapTagAt,
  type Hex32,
} from '@ferry/core';
import {
  MAX_SEND_LINK_QUERY_TAGS,
  type SendLinkQueryMatch,
} from '@ferry/core/api';
import { sha256 } from 'viem';
import { NETWORK_PROFILE } from '../config';
import type { SendLinkData } from '../paylink/link';
import { formatRefundDate } from './create-send-link';

/**
 * Normalizes and pads an 8-byte (or shorter) recovery tag from swapTagAt(root, n)
 * into the 32-byte (64 hex characters + 0x) format required by the solver's viewTag schema.
 */
export function sendLinkViewTag(tag: string): Hex32 {
  const clean = tag.startsWith('0x')
    ? tag.slice(2).toLowerCase()
    : tag.toLowerCase();
  if (clean.length > 64) {
    throw new RangeError('Tag exceeds 32 bytes');
  }
  const padded = `0x${clean.padEnd(64, '0')}`;
  return padded as Hex32;
}

export function chainNameFromId(chainId: number): string {
  const match = NETWORK_PROFILE.farChains.find((c) => {
    if (typeof c.id === 'number' && c.id === chainId) return true;
    if (c.chainKey === String(chainId)) return true;
    return false;
  });
  if (match) return match.name;
  if (chainId === 8453) return 'Base';
  if (chainId === 42161) return 'Arbitrum One';
  if (chainId === 10) return 'OP Mainnet';
  if (chainId === 137) return 'Polygon';
  if (chainId === 4663) return 'Robinhood';
  if (chainId === 84532) return 'Base Sepolia';
  return `Chain ${chainId}`;
}

export function matchToSendLinkData(
  match: SendLinkQueryMatch,
  secret: Hex32,
): SendLinkData {
  const chainName = chainNameFromId(match.chainId);
  const amount = match.amountIn
    ? Number(match.amountIn) / 100
    : match.amountOut
      ? Number(match.amountOut) / 100
      : 0;

  let status: 'open' | 'claimed' | 'expired' = 'open';
  if (match.status === 'claimed') {
    status = 'claimed';
  } else if (match.status === 'expired') {
    status = 'expired';
  }

  let lockStatus: SendLinkData['lockStatus'] = 'locked';
  if (match.status === 'pending_lock') {
    lockStatus = 'pending_lock';
  } else if (match.status === 'claimed') {
    lockStatus = 'claimed';
  } else if (match.status === 'refunded') {
    lockStatus = 'refunded';
  } else if (match.status === 'expired') {
    lockStatus = 'expired';
  }

  return {
    id: match.id,
    orderId: match.orderId ?? match.id,
    destinationChain: chainName,
    destinationToken: match.token,
    recipientEvmAddress: match.recipientEvmAddress,
    amount,
    windowSeconds: match.evmDeadline - match.createdAt,
    expiresAt: match.evmDeadline,
    note: match.note,
    status,
    createdAt: match.createdAt,
    secret,
    refundDate: formatRefundDate(match.bchRefundHeight, match.evmDeadline),
    lockStatus,
  };
}

export interface ScanWalletSendLinksOptions {
  readonly root: Hex32;
  readonly solverUrl?: string | undefined;
  readonly queryFn?:
    | ((tags: readonly Hex32[]) => Promise<readonly SendLinkQueryMatch[]>)
    | undefined;
  readonly gap?: number | undefined;
  readonly batchSize?: number | undefined;
}

export interface ScanWalletSendLinksResult {
  readonly links: readonly SendLinkData[];
  readonly scannedCount: number;
}

/**
 * Scans send links for a wallet root starting at index 0 in batches of up to 50.
 * Rebuilds the secret for each matched order using swapSecretAt(root, n) and verifies
 * that sha256(secret) === match.hashLock.
 * Stops after RECOVERY_SCAN_GAP (default 20) consecutive empty indexes.
 */
export async function scanWalletSendLinks(
  options: ScanWalletSendLinksOptions,
): Promise<ScanWalletSendLinksResult> {
  const { root } = options;
  const gap = options.gap ?? RECOVERY_SCAN_GAP;
  const maxBatch = Math.min(
    options.batchSize ?? MAX_SEND_LINK_QUERY_TAGS,
    MAX_SEND_LINK_QUERY_TAGS,
  );

  const foundLinks: SendLinkData[] = [];
  let consecutiveMisses = 0;
  let startIndex = 0;

  while (consecutiveMisses < gap) {
    const batchTags: Hex32[] = [];
    const indexByTag = new Map<string, number>();

    const count = maxBatch;
    for (let i = 0; i < count; i += 1) {
      const idx = startIndex + i;
      const rawTag = swapTagAt(root, idx);
      const tag32 = sendLinkViewTag(rawTag);
      batchTags.push(tag32);
      indexByTag.set(tag32.toLowerCase(), idx);
    }

    // Query solver
    let matches: readonly SendLinkQueryMatch[] = [];
    if (options.queryFn) {
      matches = await options.queryFn(batchTags);
    } else if (options.solverUrl) {
      try {
        const url = `${options.solverUrl.replace(/\/+$/, '')}/v1/send-links/query`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tags: batchTags }),
        });
        if (res.ok) {
          const json = await res.json();
          matches = json.links ?? json.matches ?? [];
        }
      } catch {
        // Network / solver query failed; break scan
        break;
      }
    } else {
      break;
    }

    const matchesByIndex = new Map<number, SendLinkQueryMatch>();
    for (const m of matches) {
      const tagLower = m.tag.toLowerCase();
      const idx = indexByTag.get(tagLower);
      if (idx !== undefined) {
        matchesByIndex.set(idx, m);
      }
    }

    for (let i = 0; i < count; i += 1) {
      const idx = startIndex + i;
      const match = matchesByIndex.get(idx);
      if (match) {
        consecutiveMisses = 0;
        const secret = swapSecretAt(root, idx);
        const hash = sha256(secret);
        if (hash.toLowerCase() === match.hashLock.toLowerCase()) {
          foundLinks.push(matchToSendLinkData(match, secret));
        }
      } else {
        consecutiveMisses += 1;
        if (consecutiveMisses >= gap) {
          break;
        }
      }
    }

    startIndex += count;
  }

  // Sort newest first
  foundLinks.sort((a, b) => b.createdAt - a.createdAt);

  return { links: foundLinks, scannedCount: startIndex };
}
