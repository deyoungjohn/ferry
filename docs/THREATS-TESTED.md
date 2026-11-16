# Threats Tested

Adversarial security test suite: `packages/e2e/test/adversarial.test.ts` (run against local Anvil EVM nodes and an in-process `@ferry/solver` HTTP server).

**Latest run:** 28 tests total — **25 passed**, **3 expected fail** (`[expect-fail][owner:solver]`, documenting confirmed solver defects).

## Threat Matrix

| Category             | Threat / Attack Vector                                                           | Test Name                                                                                       | Result        |
| -------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------- |
| 1. Griefing & spam   | Quote flood rate limiting (per-address and per-IP)                               | `enforces per-address and per-IP rate limits on quote flood`                                    | PASS          |
| 1. Griefing & spam   | Per-address exposure reservation cap on un-locked quotes                         | `enforces per-address exposure reservation cap on un-locked quotes`                             | PASS          |
| 1. Griefing & spam   | Mismatched amount, token, recipient, or deadline in relay validation             | `rejects wrong amount, wrong token, wrong recipient, and wrong deadline in relay validation`    | PASS          |
| 1. Griefing & spam   | Dust, zero, below-min, above-max, and `uint256` extreme amounts without HTTP 500 | `refuses dust, zero, below-min, above-max, and uint256 extreme amounts without 500`             | PASS          |
| 2. Signature attacks | Replay of `relay-lock` payload on a different order                              | `rejects replaying a relay-lock request on another order`                                       | PASS          |
| 2. Signature attacks | Cross-chain replay of `lockWithIntent` on a second `chainId`                     | `rejects cross-chain replay of lockWithIntent on a second chainId`                              | PASS          |
| 2. Signature attacks | Replay of `lockWithIntent` on a different `FerryHTLC` contract address           | `rejects replay of lockWithIntent on a different FerryHTLC contract address`                    | PASS          |
| 2. Signature attacks | EIP-2612 permit front-running before `lockWithIntent` (`_tryPermit` resilience)  | `survives permit front-running (T7): relay lockWithIntent still succeeds`                       | PASS          |
| 2. Signature attacks | Tampered `orderId` in `LockIntent`                                               | `rejects tampered orderId in relay-lock intent`                                                 | PASS          |
| 2. Signature attacks | Expired `LockIntent` (`intentDeadline` in the past)                              | `rejects an expired intent`                                                                     | PASS          |
| 2. Signature attacks | EIP-7702 delegated EOA (`SignatureChecker` routes to EIP-1271)                   | `documents EIP-7702 delegated EOA behaviour (SignatureChecker routes to EIP-1271)`              | PASS          |
| 3. Timing attacks    | `invariantF` 1 second short of required margin and late lock inside margin       | `enforces invariantF one second short of required margin and rejects late lock inside margin`   | PASS          |
| 3. Timing attacks    | Refund rejected 1 second before deadline; claim succeeds at and after deadline   | `allows claim at and after deadline, while rejecting refund one second early`                   | PASS          |
| 3. Timing attacks    | Slow solver (user refunds with zero token loss after deadline)                   | `lets user refund with zero loss when solver is slow to counter-lock`                           | PASS          |
| 3. Timing attacks    | Reorg of user lock (`evm_revert`) without leaving phantom lock state             | `recovers cleanly from a reorg (evm_revert) of user lock without phantom state`                 | PASS          |
| 4. Secret handling   | Wrong secret, truncated secret, and adapter claim with wrong secret              | `rejects wrong secret, truncated secret, and secret on wrong order`                             | PASS          |
| 4. Secret handling   | Duplicate `revealSecret` idempotency without duplicate broadcast                 | `handles duplicate revealSecret idempotently without duplicate broadcast`                       | PASS          |
| 4. Secret handling   | `revealSecret` / `relayClaim` before counter-lock is confirmed/final             | `refuses revealSecret before counter-lock is confirmed/final`                                   | PASS          |
| 5. Token quirks      | Unknown / fee-on-transfer token rejected by `chain-config` and `EvmChainAdapter` | `refuses unknown / fee-on-transfer token not in chain-config`                                   | PASS          |
| 5. Token quirks      | Unconfigured / fee-on-transfer `evmToken` rejected by `POST /v1/quotes`          | `[expect-fail][owner:solver] solver /v1/quotes refuses unconfigured / fee-on-transfer evmToken` | EXPECTED FAIL |
| 5. Token quirks      | Non-standard void-return ERC-20 (USDT `MockNoReturnToken`) via `SafeERC20`       | `handles non-standard void-return ERC20 (USDT MockNoReturnToken) via SafeERC20`                 | PASS          |
| 5. Token quirks      | Blocklisted recipient detection via `checkRecipientCanReceiveToken`              | `detects blocklisted recipient via checkRecipientCanReceiveToken`                               | PASS          |
| 5. Token quirks      | 18-decimal EVM `amountIn` through `fast` lane caps and fees                      | `[expect-fail][owner:solver] handles 18-decimal EVM amountIn through fast/safe caps and fees`   | EXPECTED FAIL |
| 5. Token quirks      | Dynamic `version()` query for EIP-2612 permit domain                             | `queries ERC-20 version() for permit v2 tokens in EvmChainAdapter`                              | PASS          |
| 6. Operator surface  | Missing, short, and wrong operator bearer tokens on protected endpoints          | `rejects missing, short, and wrong operator bearer tokens`                                      | PASS          |
| 6. Operator surface  | Kill switch stops new quoting while leaving refunds working                      | `[expect-fail][owner:solver] kill switch stops new quoting while leaving refunds working`       | EXPECTED FAIL |
| 6. Operator surface  | Oversized request body and malformed JSON without stack-trace leaks              | `rejects oversized body and malformed JSON without leaking stack traces`                        | PASS          |
| 6. Operator surface  | `/v1/metrics` exposes no order list or user/solver addresses                     | `exposes no order list or addresses on /v1/metrics`                                             | PASS          |

## Confirmed Solver Defects (Marked `it.fails`)

1. **Unconfigured `evmToken` accepted by `POST /v1/quotes`:** `POST /v1/quotes` signs and returns a quote when `evmToken` is an arbitrary unconfigured address (such as a fee-on-transfer token), instead of validating `evmToken` against the configured chain assets. (`EvmChainAdapter` does reject it with `UnsupportedAssetError`.)
2. **18-decimal `amountIn` compared raw against 6-decimal `zeroConfMaxUsdMicros`:** A \$5.00 `fast`-lane quote with 18-decimal `amountIn` (`5 * 10^18`) is rejected because `amountIn` is compared unscaled against `25_000_000n` (6-decimal USD micros).
3. **`POST /v1/kill-switch` does not pause quoting:** Calling `POST /v1/kill-switch` stops the background engine loop, but `POST /v1/quotes` continues returning HTTP 200 quotes.

## What Could Not Be Tested Here (and Why)

- **Live BCH double-spend proof (DSProof) race and live BCH reorgs:** The hermetic suite mocks `BchChainPort` / `BchQuorumClient` in-process. Live Fulcrum quorum behaviour and BCH mempool DSProof propagation require a live regtest/chipnet BCH node pair.
- **60-second `QUOTE_TTL_S` reservation expiry wait over HTTP:** `QUOTE_TTL_S` is a compile-time constant (60s) in `@ferry/solver`, so waiting 60s in the integration suite would stall CI. Per-address exposure cap rejection is verified over HTTP above, and TTL expiry pruning is covered by unit tests in `@ferry/solver`.
- **On-chain fee-on-transfer shortfall inside `FerryHTLC`:** `FerryHTLC` does not perform a balance-before/after check on `safeTransferFrom`; protection against fee-on-transfer tokens relies on `chain-config` allowlisting and `EvmChainAdapter` asset validation (plus the missing `POST /v1/quotes` check noted above).
- **Live EIP-7702 delegation transaction:** Simulated on Anvil via `anvil_setCode` with the `0xef0100` delegation prefix pointing to a non-EIP-1271 contract.
- **Native `version() == "2"` ERC-20 permit token:** `MockUSDCWithPermit` in `@ferry/htlc-evm` exposes `version() == "1"`; `EvmChainAdapter.buildUserLock` is verified to query `version()` dynamically rather than hardcoding `"1"`.
