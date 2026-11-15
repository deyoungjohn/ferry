export type RelayLockErrorCode =
  'INSUFFICIENT_USER_BALANCE' | 'RELAY_LOCK_REVERTED';

export class RelayLockRejectedError extends Error {
  constructor(
    readonly code: RelayLockErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'RelayLockRejectedError';
  }
}

export class UnsupportedAssetError extends Error {
  constructor(tokenAddress: string, chainId: string) {
    super(`Token ${tokenAddress} is not configured on chain ${chainId}`);
    this.name = 'UnsupportedAssetError';
  }
}

export class ChainMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChainMismatchError';
  }
}

export class InvalidSecretError extends Error {
  readonly code = 'INVALID_SECRET' as const;

  constructor(lockId: string) {
    super(`Secret does not match hashLock for lock ${lockId}`);
    this.name = 'InvalidSecretError';
  }
}

export class RelayLockTransportError extends Error {
  readonly code = 'UPSTREAM_ERROR' as const;

  constructor(message: string, cause?: unknown) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = 'RelayLockTransportError';
  }
}
