// Browser-safe entry: what the user's wallet signs and sends, and how to read a
// lock. It must not import any Node-only module.
export {
  APPROVE_GAS_UPPER_BOUND,
  INTENT_VALIDITY_AFTER_QUOTE_SECONDS,
  LOCK_GAS_UPPER_BOUND,
  UserSideError,
  buildClaimTransaction,
  buildUserLockPayload,
  buildLockIntentTypedData,
  buildOrderPermitTypedData,
  buildPermitTypedData,
  buildRefundTransaction,
  explorerAddressUrl,
  explorerTxUrl,
  getUserLockStatus,
  lockIntentFromTerms,
  planApproveAndLock,
  prepareApproveAndLock,
  readPermitDomain,
  readPermitNonce,
} from './user-side.js';
export type {
  LockEventRef,
  PermitTypedDataInput,
  UserLockStatus,
  WalletTransaction,
} from './user-side.js';
export {
  getEvmWalletRecoveryActions,
  inspectEvmWalletRecovery,
} from './recovery.js';
export type {
  EvmWalletRecoveryInput,
  EvmWalletRecoveryPlan,
  InspectEvmWalletRecoveryOptions,
} from './recovery.js';
