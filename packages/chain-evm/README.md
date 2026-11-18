# @ferry/chain-evm

The EVM adapter, relay validators, log readers and recovery helpers for Ferry.

## Browser entry: `@ferry/chain-evm/browser`

What the user's own wallet signs and sends, and how to read a lock for a progress timeline. It imports no Node built-in (a test fails if it does) and does not reach the adapter. All functions are pure except the ones that take a viem `PublicClient`.

### 1. Typed data to sign

| Function                                                                           | Returns                                                                                                                                                                            |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `buildLockIntentTypedData(terms)`                                                  | The EIP-712 `LockIntent` for `FerryHTLC.lockWithIntent`, ready for `signTypedData`. The intent deadline is the quote expiry plus one hour (`INTENT_VALIDITY_AFTER_QUOTE_SECONDS`). |
| `lockIntentFromTerms(terms)`                                                       | The `LockIntent` fields themselves, for passing the same values to the contract call.                                                                                              |
| `buildPermitTypedData({ token, chainId, owner, spender, value, nonce, deadline })` | The EIP-2612 `Permit` typed data, or `null` when the token has no permit.                                                                                                          |
| `buildOrderPermitTypedData(terms, token, nonce)`                                   | The permit for an order: the contract is the spender, the amount is exact, the deadline equals the intent deadline.                                                                |
| `readPermitNonce(client, token, owner)`                                            | The owner's current permit nonce.                                                                                                                                                  |

The permit domain name and version come from the token's facts in `@ferry/chain-config` (pass the token's `TokenFacts`), never from the chain. The builder derives the domain separator and throws `UserSideError` unless it equals the separator recorded in the facts, so a wrong version (Circle USDC uses `2`) or a missing record fails closed instead of producing a signature the token would reject.

### 2. Tokens without permit, claim and refund

All of these return a `WalletTransaction`: `{ kind, to, data, value, gas?, gasSource? }`, ready for `sendTransaction`.

| Function                                          | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `planApproveAndLock({ terms, allowance })`        | Pure plan. An allowance that already covers the amount needs no approval. A smaller non-zero allowance gets a `reset-approval` (approve zero) first, because USDT refuses to change a non-zero allowance directly. Then an exact-amount `approve`, then `lock`. Never an unlimited approval.                                                                                                                                                      |
| `prepareApproveAndLock({ client, terms })`        | Reads the allowance, plans, and attaches gas. Approvals are estimated by the node (`gasSource: 'node'`). A transaction that depends on an earlier one cannot be simulated until that one is mined, so the lock carries `LOCK_GAS_UPPER_BOUND`, and an exact approve that follows a reset carries `APPROVE_GAS_UPPER_BOUND` (both `gasSource: 'bound'`; real USDT measured 26,420 for the reset, 48,549 for the approve and 208,214 for the lock). |
| `buildClaimTransaction({ htlc, lockId, secret })` | Claim from the user's own wallet.                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `buildRefundTransaction({ htlc, lockId })`        | Refund after the deadline from the user's own wallet.                                                                                                                                                                                                                                                                                                                                                                                             |

### 3. Reading a lock

`getUserLockStatus({ client, htlc, lockId, explorerUrl, fromBlock })` returns:

- `state`: `absent`, `open`, `claimed`, `refunded`, or `expired` (unclaimed and past the deadline: the sender may refund, and a claim with the secret stays valid until one lands). Expiry is judged by the latest block's timestamp, not the browser clock.
- `deadline`, `chainTimestamp`, and `secret` once claimed.
- `locked`, `claimed`, `refunded`: `{ txHash, blockNumber, url }` or `null`, with the explorer link built from the chain's `explorerUrl` (`explorerTxUrl`, `explorerAddressUrl`).

`fromBlock` is where the event scan starts: the contract's deploy block from the facts, or the order's creation block when known (a narrower scan is cheaper on public endpoints).

### Recovery

`getEvmWalletRecoveryActions` and `inspectEvmWalletRecovery` are also exported from the browser entry.

### Tests

`test/user-side.test.ts` checks the builders against the real facts for every permit token and, on a local chain, that a signature produced through them is accepted by `lockWithIntent`. The opt-in harness test (`FERRY_RUN_E2E=1`, package `@ferry/e2e`, `test/user-side.test.ts`) drives forward with permit, forward without permit, reverse claim and refund against the in-process solver through the solver client.
