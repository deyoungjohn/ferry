import { bytesToHex, hexToBytes, isAddress } from 'viem';
import { z } from 'zod';
import { MAX_SEND_LINK_WINDOW_SECONDS } from './pricing.js';
import { sendLinkNoteSchema } from './api/index.js';
import { unixTimestampSeconds, type Hex, type Hex32 } from './terms.js';
import {
  DEFAULT_TIMING_CONFIG,
  invariantR,
  type CounterLockTime,
  type TimingConfig,
  type TimingDecision,
} from './timing.js';

export const SEND_LINK_STATUSES = [
  'quoted',
  'locked',
  'claimed',
  'expired',
  'refunded',
] as const;

export type SendLinkStatus = (typeof SEND_LINK_STATUSES)[number];

export const SEND_LINK_WINDOWS_SECONDS = Object.freeze({
  '24h': 86_400,
  '3d': 3 * 86_400,
  '7d': 7 * 86_400,
});

const hex32Schema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/, 'Expected 32-byte 0x-prefixed hex')
  .transform((value) => value.toLowerCase() as Hex32);

const evmAddressSchema = z
  .string()
  .refine((value) => isAddress(value), 'Malformed EVM address')
  .transform((value) => value.toLowerCase() as Hex);

export const SendLinkSchema = z.strictObject({
  id: hex32Schema,
  destinationChainId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  token: evmAddressSchema,
  recipientAddress: evmAddressSchema,
  amount: z
    .bigint()
    .positive()
    .max((1n << 256n) - 1n),
  windowSeconds: z.number().int().positive().max(MAX_SEND_LINK_WINDOW_SECONDS),
  claimAfter: unixTimestampSeconds.optional(),
  /** The sender's message for the receiver. */
  note: sendLinkNoteSchema.optional(),
  status: z.enum(SEND_LINK_STATUSES),
  createdAt: unixTimestampSeconds,
});

export type SendLink = z.infer<typeof SendLinkSchema>;

export function parseSendLink(input: unknown): SendLink {
  return SendLinkSchema.parse(input);
}

export type SendLinkWindowFailureReason =
  | 'invalid-window'
  | 'window-too-long'
  | 'invalid-start'
  | 'unfeasible-window'
  | 'height-out-of-range';

export type SendLinkWindowPlan =
  | {
      ok: true;
      evmDeadlineSeconds: number;
      bchRefundHeight: number;
      remainingBlocks: number;
      decision: TimingDecision;
    }
  | {
      ok: false;
      reason: SendLinkWindowFailureReason;
      message: string;
    };

const MAX_ERLANG_BLOCKS = 10_000;
const MAX_BCH_BLOCK_HEIGHT = 499_999_999;

/**
 * Plan the destination EVM deadline and BCH refund height for a send link
 * with window W (up to 7 days) so that reverse timing invariant R holds.
 */
export function planSendLinkWindow(params: {
  windowSeconds: number;
  start: CounterLockTime;
  config?: TimingConfig;
  extraBchMarginBlocks?: number;
}): SendLinkWindowPlan {
  const { windowSeconds, start } = params;
  const config = params.config ?? DEFAULT_TIMING_CONFIG;
  const extraBlocks = params.extraBchMarginBlocks ?? 0;

  if (!Number.isInteger(windowSeconds) || windowSeconds <= 0) {
    return {
      ok: false,
      reason: 'invalid-window',
      message: 'windowSeconds must be a positive integer',
    };
  }
  if (windowSeconds > MAX_SEND_LINK_WINDOW_SECONDS) {
    return {
      ok: false,
      reason: 'window-too-long',
      message: `windowSeconds ${windowSeconds} exceeds maximum ${MAX_SEND_LINK_WINDOW_SECONDS}`,
    };
  }
  if (
    !Number.isInteger(start.unixSeconds) ||
    start.unixSeconds <= 0 ||
    start.unixSeconds >= 1e11 ||
    !Number.isInteger(start.bchTipHeight) ||
    start.bchTipHeight < 0 ||
    start.bchTipHeight > MAX_BCH_BLOCK_HEIGHT ||
    !Number.isInteger(extraBlocks) ||
    extraBlocks < 0
  ) {
    return {
      ok: false,
      reason: 'invalid-start',
      message: 'Invalid start time or BCH tip height',
    };
  }

  const evmDeadlineSeconds = start.unixSeconds + windowSeconds;
  if (evmDeadlineSeconds >= 1e11) {
    return {
      ok: false,
      reason: 'invalid-start',
      message: 'Resulting evmDeadlineSeconds exceeds Unix seconds bound',
    };
  }

  const minBlocks = Math.max(1, config.minReverseRemainingBlocks + extraBlocks);
  if (minBlocks > MAX_ERLANG_BLOCKS) {
    return {
      ok: false,
      reason: 'unfeasible-window',
      message: 'Minimum required blocks exceeds planner search bound',
    };
  }

  const checkBlocks = (blocks: number): TimingDecision =>
    invariantR(
      {
        evmDeadlineSeconds,
        bchRefundHeight: start.bchTipHeight + blocks,
      },
      start,
      config,
    );

  const requiredSeconds =
    windowSeconds + config.solverReactionSeconds + config.safetySeconds;
  const expectedBlocks = Math.ceil(requiredSeconds / config.blockMeanSeconds);

  let low = minBlocks;
  let high = Math.min(
    MAX_ERLANG_BLOCKS,
    Math.max(
      minBlocks,
      expectedBlocks + Math.ceil(Math.sqrt(expectedBlocks) * 5) + 32,
    ),
  );
  while (!checkBlocks(high).allowed) {
    if (high >= MAX_ERLANG_BLOCKS) {
      return {
        ok: false,
        reason: 'unfeasible-window',
        message: 'No block count within 10,000 blocks satisfies invariant R',
      };
    }
    low = high + 1;
    high = Math.min(MAX_ERLANG_BLOCKS, high * 2);
  }

  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (checkBlocks(mid).allowed) {
      high = mid;
    } else {
      low = mid + 1;
    }
  }

  const remainingBlocks = low;
  const bchRefundHeight = start.bchTipHeight + remainingBlocks;
  if (bchRefundHeight > MAX_BCH_BLOCK_HEIGHT) {
    return {
      ok: false,
      reason: 'height-out-of-range',
      message: 'Planned BCH refund height exceeds block-height locktime range',
    };
  }

  const decision = checkBlocks(remainingBlocks);
  return {
    ok: true,
    evmDeadlineSeconds,
    bchRefundHeight,
    remainingBlocks,
    decision,
  };
}

/**
 * Derive blinded tag n for a send link view key:
 *   tag n = HMAC-SHA-256(viewKey, "ferry:send-links:v1:" + n)
 *
 * Uses universal Web Crypto (globalThis.crypto.subtle) so it runs identically in
 * Node 19+, browser runtimes, and worker threads with zero external dependencies.
 */
export async function deriveSendLinkTag(
  viewKey: string | Uint8Array,
  counter: number,
): Promise<Hex32> {
  if (!Number.isInteger(counter) || counter < 0) {
    throw new RangeError(
      'Send link tag counter must be a non-negative integer',
    );
  }
  const rawKey =
    typeof viewKey === 'string'
      ? hexToBytes((viewKey.startsWith('0x') ? viewKey : `0x${viewKey}`) as Hex)
      : viewKey;
  if (rawKey.length !== 32) {
    throw new RangeError('Send link view key must be exactly 32 bytes');
  }
  const message = new TextEncoder().encode(`ferry:send-links:v1:${counter}`);
  const cryptoKey = await globalThis.crypto.subtle.importKey(
    'raw',
    rawKey as unknown as Parameters<
      typeof globalThis.crypto.subtle.importKey
    >[1],
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await globalThis.crypto.subtle.sign(
    'HMAC',
    cryptoKey,
    message as unknown as Parameters<typeof globalThis.crypto.subtle.sign>[2],
  );
  return bytesToHex(new Uint8Array(signature)) as Hex32;
}
