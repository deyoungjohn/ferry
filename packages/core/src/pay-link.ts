import { z } from 'zod';
import { decodeCashAddress } from './cashaddr.js';
import { quoteExactOut, type PricingPolicy } from './pricing.js';
import { unixTimestampSeconds, type Hex } from './terms.js';

export const PAY_LINK_STATUSES = [
  'open',
  'reserved',
  'paid',
  'expired',
  'cancelled',
] as const;

export type PayLinkStatus = (typeof PAY_LINK_STATUSES)[number];

const base58IdSchema = z
  .string()
  .regex(/^[1-9A-HJ-NP-Za-km-z]{16,32}$/, 'PayLink id must be base58');

const hexLockingBytecodeSchema = z
  .string()
  .regex(/^0x(?:[0-9a-fA-F]{2})+$/)
  .max(204)
  .transform((value) => value.toLowerCase() as Hex);

const cashaddrSchema = z
  .string()
  .min(10)
  .max(128)
  .refine((value) => {
    try {
      decodeCashAddress(value);
      return true;
    } catch {
      return false;
    }
  }, 'Invalid CashAddr');

/**
 * Validate that a PayLink recipient CashAddr is well-formed and its derived
 * locking bytecode matches the provided locking bytecode.
 */
export function validatePayLinkRecipient(
  recipientCashaddr: string,
  recipientLockingBytecode: Hex,
): { ok: true; tokenAware: boolean } | { ok: false; reason: string } {
  try {
    const decoded = decodeCashAddress(recipientCashaddr);
    if (decoded.lockingBytecode !== recipientLockingBytecode.toLowerCase()) {
      return {
        ok: false,
        reason: 'recipientLockingBytecode does not match recipientCashaddr',
      };
    }
    return { ok: true, tokenAware: decoded.tokenAware };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : 'Invalid recipientCashaddr',
    };
  }
}

export const PayLinkSchema = z
  .strictObject({
    id: base58IdSchema,
    recipientCashaddr: cashaddrSchema,
    recipientLockingBytecode: hexLockingBytecodeSchema,
    token: z.enum(['PUSD', 'MUSD']),
    amountOut: z.bigint().positive().optional(),
    minAmountOut: z.bigint().positive().optional(),
    note: z.string().min(1).max(140).optional(),
    expiresAt: unixTimestampSeconds.optional(),
    verified: z.boolean(),
    status: z.enum(PAY_LINK_STATUSES),
    createdAt: unixTimestampSeconds,
  })
  .superRefine((link, ctx) => {
    const recipientCheck = validatePayLinkRecipient(
      link.recipientCashaddr,
      link.recipientLockingBytecode,
    );
    if (!recipientCheck.ok) {
      ctx.addIssue({
        code: 'custom',
        message: recipientCheck.reason,
        path: ['recipientLockingBytecode'],
      });
    }
    if (
      link.amountOut !== undefined &&
      link.minAmountOut !== undefined &&
      link.minAmountOut > link.amountOut
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'minAmountOut cannot exceed amountOut',
        path: ['minAmountOut'],
      });
    }
  });

export type PayLink = z.infer<typeof PayLinkSchema>;

export function parsePayLink(input: unknown): PayLink {
  return PayLinkSchema.parse(input);
}

/** Fixed-amount pay links are single-use; no-amount pay links stay open. */
export function isSingleUsePayLink(link: Pick<PayLink, 'amountOut'>): boolean {
  return link.amountOut !== undefined;
}

export type PayLinkEvent =
  | { type: 'reserve'; nowSeconds: number }
  | { type: 'release'; nowSeconds: number }
  | { type: 'pay'; nowSeconds: number }
  | { type: 'expire'; nowSeconds: number }
  | { type: 'cancel' };

export type PayLinkTransitionFailureReason =
  | 'already-terminal'
  | 'already-reserved'
  | 'not-reserved'
  | 'link-expired'
  | 'not-expired';

export type PayLinkTransitionResult =
  | { ok: true; status: PayLinkStatus; link: PayLink }
  | {
      ok: false;
      reason: PayLinkTransitionFailureReason;
      status: PayLinkStatus;
    };

function isExpiredAt(link: PayLink, nowSeconds: number): boolean {
  return link.expiresAt !== undefined && nowSeconds >= link.expiresAt;
}

/**
 * Pure state machine for PayLink status transitions.
 * - Fixed-amount links transition to 'paid' on payment (single-use).
 * - No-amount links return to/stay in 'open' on payment (reusable).
 */
export function transitionPayLinkStatus(
  link: PayLink,
  event: PayLinkEvent,
): PayLinkTransitionResult {
  if (
    link.status === 'paid' ||
    link.status === 'expired' ||
    link.status === 'cancelled'
  ) {
    return { ok: false, reason: 'already-terminal', status: link.status };
  }

  switch (event.type) {
    case 'reserve': {
      if (isExpiredAt(link, event.nowSeconds)) {
        return { ok: false, reason: 'link-expired', status: link.status };
      }
      if (link.status === 'reserved') {
        return { ok: false, reason: 'already-reserved', status: link.status };
      }
      return {
        ok: true,
        status: 'reserved',
        link: { ...link, status: 'reserved' },
      };
    }

    case 'release': {
      if (link.status !== 'reserved') {
        return { ok: false, reason: 'not-reserved', status: link.status };
      }
      const nextStatus: PayLinkStatus = isExpiredAt(link, event.nowSeconds)
        ? 'expired'
        : 'open';
      return {
        ok: true,
        status: nextStatus,
        link: { ...link, status: nextStatus },
      };
    }

    case 'pay': {
      if (isExpiredAt(link, event.nowSeconds)) {
        return { ok: false, reason: 'link-expired', status: link.status };
      }
      const nextStatus: PayLinkStatus = isSingleUsePayLink(link)
        ? 'paid'
        : 'open';
      return {
        ok: true,
        status: nextStatus,
        link: { ...link, status: nextStatus },
      };
    }

    case 'expire': {
      if (!isExpiredAt(link, event.nowSeconds)) {
        return { ok: false, reason: 'not-expired', status: link.status };
      }
      return {
        ok: true,
        status: 'expired',
        link: { ...link, status: 'expired' },
      };
    }

    case 'cancel': {
      return {
        ok: true,
        status: 'cancelled',
        link: { ...link, status: 'cancelled' },
      };
    }
  }
}

export type PayLinkQuoteFailureReason =
  | 'link-not-payable'
  | 'link-expired'
  | 'missing-amount'
  | 'amount-mismatch'
  | 'below-min-amount';

export type PayLinkQuoteResult =
  | {
      ok: true;
      payerAmountIn: bigint;
      recipientAmountOut: bigint;
      fromDecimals: number;
      toDecimals: number;
      spreadBps: number;
      fixedFeeUsdMicros: bigint;
    }
  | { ok: false; reason: PayLinkQuoteFailureReason };

/**
 * Exact-output quote helper for PayLinks.
 * The recipient receives the exact PUSD/MUSD amount; spread and fixed fee
 * are added on the payer's side via quoteExactOut.
 */
export function quotePayLinkExactOut(params: {
  link: PayLink;
  amountOut?: bigint;
  fromDecimals: number;
  toDecimals?: number;
  policy: PricingPolicy;
  nowSeconds: number;
}): PayLinkQuoteResult {
  const { link, policy, nowSeconds } = params;
  const toDecimals = params.toDecimals ?? 2;

  if (link.status !== 'open') {
    return { ok: false, reason: 'link-not-payable' };
  }
  if (isExpiredAt(link, nowSeconds)) {
    return { ok: false, reason: 'link-expired' };
  }

  let recipientAmountOut: bigint;
  if (link.amountOut !== undefined) {
    if (params.amountOut !== undefined && params.amountOut !== link.amountOut) {
      return { ok: false, reason: 'amount-mismatch' };
    }
    recipientAmountOut = link.amountOut;
  } else {
    if (params.amountOut === undefined || params.amountOut <= 0n) {
      return { ok: false, reason: 'missing-amount' };
    }
    if (
      link.minAmountOut !== undefined &&
      params.amountOut < link.minAmountOut
    ) {
      return { ok: false, reason: 'below-min-amount' };
    }
    recipientAmountOut = params.amountOut;
  }

  const payerAmountIn = quoteExactOut(
    recipientAmountOut,
    params.fromDecimals,
    toDecimals,
    policy,
  );

  return {
    ok: true,
    payerAmountIn,
    recipientAmountOut,
    fromDecimals: params.fromDecimals,
    toDecimals,
    spreadBps: policy.spreadBps,
    fixedFeeUsdMicros: policy.fixedFeeUsdMicros,
  };
}
