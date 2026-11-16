# Ferry Solver (`@ferry/solver`)

Automated market maker and cross-chain counterparty daemon for Ferry cross-chain atomic swaps between Ethereum/Base (EVM) and Bitcoin Cash (BCH CashTokens).

---

## Features

- **Conformed API Routes**: Strictly validated against `@ferry/core/api` schemas (`/v1/chains`, `/v1/stats`, `/v1/orders/recent`, `/v1/pegs`, `/v1/metrics`, `/v1/quotes`, `/v1/orders/:id`, `/v1/orders/:id/secret`, `/v1/orders/:id/relay-lock`, `/v1/orders/:id/relay-claim`).
- **Crash Resilience & Chaos Tested**: Write-ahead transaction intent queue backed by SQLite. Process can be killed at any intermediate state and recover without duplicate broadcasts or lost state.
- **Inventory & Dynamic Skew Pricing**: Real-time balance and reservation tracking, reporting inventory skew via `GET /v1/operator/inventory` and adjusting quote spreads dynamically within `SKEW_MAX_BPS`.
- **Hardened Security**: Per-IP and per-address rate limiting on quotes and pay links, constant-time `timingSafeEqual` Bearer token authentication for operator endpoints, 64 KB request body limits, and sanitized error handlers preventing stack trace leakage.
- **Operator Runbook**: Detailed operational procedures in [`RUNBOOK.md`](./RUNBOOK.md).

---

## Prerequisites

- **Node.js**: v22.x or later (`source ~/.nvm/nvm.sh && nvm use 22`)
- **pnpm**: v10.x or later
- **Anvil** (optional for standalone dev RPC): Foundry toolchain (`anvil --port 8545`)

---

## Quickstart: Runnable Local Dev

Bring up the solver in local development mode with a single command:

```bash
pnpm --filter @ferry/solver dev
```

### What `pnpm --filter @ferry/solver dev` Does:

1. Connects to local Anvil on port 8545 (or falls back to an in-memory simulated EVM adapter).
2. Spawns an in-process fake Electrum server simulating BCH tip progression and CashToken UTXO history.
3. Provides mock reference price sources for USDC and PUSD ($1.00 each).
4. Initializes an ephemeral SQLite database with write-ahead persistence.
5. Polls order state transitions every 500ms and prints **one short line per state change** to stdout:
   ```text
   [order:a1b2c3d4] QUOTED -> USER_LOCK_SEEN
   [order:a1b2c3d4] USER_LOCK_SEEN -> SOLVER_LOCK_BROADCAST
   [order:a1b2c3d4] SOLVER_LOCK_BROADCAST -> SOLVER_LOCK_SEEN
   [order:a1b2c3d4] SOLVER_LOCK_SEEN -> SECRET_KNOWN
   [order:a1b2c3d4] SECRET_KNOWN -> SOLVER_CLAIM_BROADCAST
   [order:a1b2c3d4] SOLVER_CLAIM_BROADCAST -> DONE
   ```

---

## Running the End-to-End Integration Test

The opt-in end-to-end integration test runs against the solver API using `@ferry/solver-client`, executing forward swaps, reverse swaps, refund drills, and price refusal verifications.

To run the e2e test:

```bash
FERRY_RUN_E2E=1 pnpm --filter @ferry/solver test test/e2e.test.ts
```

_(Note: Without `FERRY_RUN_E2E=1`, the suite is skipped automatically during normal unit test CI runs)._

### Scenarios Tested in E2E:

1. **Forward Swap (`EVM_TO_BCH`)**: Quote -> Relay-Lock -> Reveal Secret -> Relay-Claim -> Verified `SOLVER_CLAIM_BROADCAST` / `DONE`.
2. **Reverse Swap (`BCH_TO_EVM`)**: Quote -> Reveal Secret -> Verified `SECRET_KNOWN` / `DONE`.
3. **Refund Drill**: Expired counter deadline transition -> Verified `SOLVER_REFUNDED`.
4. **Stale Price Refusal**: Price feed older than threshold -> Client receives HTTP 422 `PRICE_UNAVAILABLE` via `SolverRefusalError`.

---

## Running Chaos & Resilience Tests

Chaos tests verify process crashes, RPC failures mid-swap, Electrum lies, and reservation races:

```bash
pnpm --filter @ferry/solver test test/chaos.test.ts
```

Tests include:

- Forward & reverse swap process kill at every intermediate state with restart to `DONE` (no duplicate broadcasts).
- Transient RPC down (`ECONNREFUSED`) mid-swap with automatic recovery.
- Electrum server genesis mismatch dropped without serving corrupted state.
- Stale price source refusal (`PRICE_UNAVAILABLE`).
- Reservation race refusing over-committed liquidity with `INSUFFICIENT_LIQUIDITY`.

---

## Running Package Tests

Compute is limited, so run only this package's tests:

```bash
pnpm --filter @ferry/solver test
```

---

## API Summary

All endpoints conform to `@ferry/core/api`:

### Public Routes

- `GET /v1/health`: Basic liveness and tip health.
- `GET /v1/chains`: Supported EVM chains and BCH finality confirmations.
- `GET /v1/stats`: Aggregate volume and completed swap metrics.
- `GET /v1/orders/recent`: Recent swap orders (with privacy safeguards).
- `GET /v1/pegs`: Peg status and reference oracle prices.
- `GET /v1/metrics`: Prometheus-compatible operational counters.
- `POST /v1/quotes`: Rate-limited quote generation.
- `GET /v1/orders/:id`: Current swap order status.
- `POST /v1/orders/:id/secret`: Reveal cooperative secret.
- `POST /v1/orders/:id/relay-lock`: Submit user lock intent.
- `POST /v1/orders/:id/relay-claim`: Submit user claim intent.
- `POST /v1/links`: Create PayLink.
- `GET /v1/links/:id`: Get PayLink details.
- `POST /v1/links/:id/quotes`: Quote for a PayLink.
- `GET /v1/links`: List PayLinks by owner.
- `POST /v1/links/:id/cancel`: Cancel PayLink.
- `POST /v1/send-quotes`: Quote SendLink.
- `GET /v1/send-links/:id`: Get SendLink details.

### Protected Operator Routes (Bearer Auth)

- `GET /v1/operator/inventory`: Per-asset balances, reservations, exposure, and skew in bps.
- `GET /v1/operator/alerts`: Critical and warning system alerts.
- `GET /v1/operator/needs-attention`: Orders requiring operator inspection.
- `POST /v1/kill-switch`: Halt solver engine immediately.
- `POST /v1/pause`: Pause quoting (returns 422 `QUOTING_PAUSED`).
- `POST /v1/resume`: Resume quoting.
- `GET /v1/config`: Redacted configuration snapshot.
