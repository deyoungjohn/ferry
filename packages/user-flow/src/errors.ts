export type UserFlowErrorCode =
  | 'WRONG_CHAIN'
  | 'INVALID_INPUT'
  | 'DRY_RUN_QUOTE'
  | 'NO_QUOTE'
  | 'RECOVERY_NOT_SAVED'
  | 'SECRET_MISSING'
  | 'WALLET_REJECTED'
  | 'SIGNED_TRANSACTION_REJECTED'
  | 'COUNTER_LOCK_TIMEOUT'
  | 'NOTHING_TO_SPEND'
  | 'INSUFFICIENT_FUNDS'
  | 'QUOTE_BELOW_MINIMUM'
  | 'TOKEN_CATEGORY_ORDER'
  | 'TX_REVERTED'
  | 'QUOTE_EXPIRED'
  | 'NOT_READY';

/** A failure the page can show in plain words; `refundAvailable` says whether the user's own refund path is still open. */
export class UserFlowError extends Error {
  readonly code: UserFlowErrorCode;
  readonly refundPossible: boolean;

  constructor(
    code: UserFlowErrorCode,
    message: string,
    options?: { readonly refundPossible?: boolean; readonly cause?: unknown },
  ) {
    super(
      message,
      options?.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = 'UserFlowError';
    this.code = code;
    this.refundPossible = options?.refundPossible ?? false;
  }
}
