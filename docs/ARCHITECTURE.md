# Ferry Architecture

Ferry connects Bitcoin Cash CashTokens (`PUSD`, `MUSD`) with EVM stablecoins (`USDC`, `USDT`) using two-sided Hash-Time-Locked Contracts (HTLCs) coordinated by off-chain solvers. Bitcoin Cash is the hub of every route: swaps always have BCH on one side and an enabled EVM chain (Base, Ethereum, BNB Chain, Arbitrum, Robinhood Chain, or Arc) on the other.

## Core protocol objects (`@ferry/core`)

1. **Canonical `OrderTerms` and `orderId`:**
   - Every swap is defined by `OrderTerms` (version, direction `EVM_TO_BCH` or `BCH_TO_EVM`, BCH token & category, EVM chain ID, token & HTLC address, user & solver addresses on both chains, `hashLock`, `evmDeadline`, `bchRefundHeight`, `bchCarrySats`, `bchMaxFee`, `quoteId`, `quoteExpiry`, and `pricing`).
   - `orderId = sha256(canonicalCBOR(terms))` using RFC 8949 deterministic CBOR (`cborg`), ensuring identical hashes across TypeScript and Solidity/CashScript tooling.
   - `orderTermsToJson` / `orderTermsFromJson` provide a single JSON-safe codec (bigints as decimal strings, bytes as `0x`-prefixed hex) shared by API schemas, recovery files, and clients.
2. **EIP-191 quote signatures:**
   - Solvers sign the 32-byte `orderId` (`signOrderId`). Clients (`@ferry/solver-client`) recover the signer address locally and verify all terms, pricing freshness, `quoteOut` floor rounding, and timing invariants before locking funds.
3. **Timing invariants (`F` and `R`):**
   - **Forward (`EVM_TO_BCH`):** user locks first on EVM with `evmDeadline`; solver locks second on BCH with `bchRefundHeight`. `invariantF` enforces `evmDeadline - t0 >= P99.99[DeltaBCH(N)] + SOLVER_REACTION + SAFETY` so the user's EVM lock never expires before the solver's BCH lock can be claimed.
   - **Reverse (`BCH_TO_EVM`):** user locks first on BCH with `bchRefundHeight`; solver locks second on EVM with `evmDeadline`. `invariantR` enforces `P0.01[DeltaBCH(N)] >= (evmDeadline - t0) + SOLVER_REACTION + SAFETY` (and a minimum remaining block buffer) using fast memoized Erlang quantile inversion (`erlangQuantile`).

## Settlement contracts

- **Bitcoin Cash (`@ferry/htlc-bch`, `FerryHTLC.cash`):**
  - A P2SH32 CashTokens covenant parameterized by the order's `hashLock`, `recipientLockingBytecode`, `refundLockingBytecode`, `bchRefundHeight`, `tokenCategory` (internal byte order), `tokenAmount`, and `maxFee`.
  - Both `claim` (with 32-byte `secret` where `sha256(secret) == hashLock`) and `refund` (after `tx.locktime >= bchRefundHeight`) are **keyless**: anyone can submit the spend because the covenant enforces the exact recipient locking bytecode, token category, and token amount on output 0.
  - All spends are verified locally in `@bitauth/libauth` before broadcast.
- **EVM (`@ferry/htlc-evm`, `FerryHTLC.sol`):**
  - Deployed deterministically via CREATE2 across supported EVM chains with no admin, owner, or upgradeability.
  - Supports `lock`, gas-free `lockWithIntent` (EIP-2612 `permit` + EIP-712 user intent), permissionless `claim(lockId, secret)`, and `refund(lockId)` after `deadline`.

## Off-chain coordination & client flow

- **Solver (`@ferry/solver`):** manages quote pricing, inventory & exposure reservations, SQLite WAL persistence, startup chain reconciliation, Fulcrum genesis/liveness quorum checks, and idempotent transaction execution.
- **Multi-solver client (`@ferry/solver-client`):** `bestQuote` queries multiple solver URLs in parallel, rejects tampered, expired, or mis-priced quotes with field-level `QuoteVerificationError`s, surfaces refusals (`QuoteRefusal`) for display, and selects the highest verified payout (tie-breaking by latency).
- **Pay links & send links:**
  - **Pay links (`/p/<id>`):** exact-output forward swaps (`quoteInForExactOut`) paying a recipient's BCH address from any supported EVM chain.
  - **Send links (`/s/<id>#<secret>`):** recipient-bound reverse swaps with 24h, 3d, or 7d windows planned via `planSendLinkWindow`; the secret stays in the URL fragment only and is never sent in HTTP URLs or logs.
- **Recovery & Activity:**
  - `RecoveryFile` (`ferry-<orderId>.json`) stores signed terms, contract refs, and the secret (only when held by the user). `recoveryActions` computes the user's exact claim/refund branch or wait reason; `buildBchRecoveryTransaction` and `buildEvmRecoveryCalldata` construct recovery spends without relying on a solver.
  - `fetchBchActivity` reconstructs past swaps directly from BCH transaction history and covenant redeem scripts.
