# Ferry Solver Runbook

This document describes operational procedures for managing, monitoring, and troubleshooting the Ferry solver daemon in testnet and production environments.

---

## 1. Architecture Overview

The solver daemon acts as the automated market maker and cross-chain counterparty for Ferry swaps between Ethereum/Base (EVM) and Bitcoin Cash (BCH CashTokens).

Key components:

- **HTTP Server (Fastify)**: Exposes public quoting, order status, cooperative secret reveal, and pay/send link routes (`/v1/*`), plus operator management endpoints. Requests enforce a strict 64 KB payload size limit and constant-time Bearer authentication on operator routes.
- **Engine Loop**: Background reconciliation and state machine runner driving active orders towards terminal completion.
- **BchQuorumClient**: Multi-node Electrum WebSocket client maintaining block tip consensus, UTXO queries, and double-spend proof monitoring.
- **EvmChainAdapter**: Viem-based EVM client handling lock detection, claims, refunds, and contract event subscriptions.
- **ActionExecutor & SQLite**: Crash-resilient write-ahead persistence (`data/solver.db`) guaranteeing no duplicate broadcasts or lost state across process restarts.
- **Liquidity & Skew Manager**: Dynamically manages inventory reserves, exposures, and implements inventory skew pricing (capped by `SKEW_MAX_BPS`).

---

## 2. Starting on Mainnet & Testnet

### Prerequisites

- Node.js 22.x (`node -v`)
- Persistent SQLite database directory (`packages/solver/data`)
- RPC endpoints:
  - Base RPC endpoint (HTTPS)
  - At least 2 distinct, independent Bitcoin Cash Electrum WebSocket endpoints (for mainnet quorum)

### Mainnet Startup Refusals & Guards

On `NETWORK=mainnet`, the daemon executes strict fail-fast validation during configuration loading and server startup. It refuses to start under any of the following conditions:

1. **Fewer Than Two Independent Electrum Servers**:
   - `BCH_ELECTRUM_HOSTS` must contain at least 2 distinct, reachable WebSocket endpoints.
   - Refusal: Throws `Fewer than 2 independent Electrum servers configured for mainnet`.
2. **Short or Insecure Operator Token**:
   - `OPERATOR_TOKEN` must be at least 32 characters in length.
   - Refusal: Throws `Operator token must be at least 32 characters on mainnet`.
3. **Placeholder or Dev Private Keys**:
   - `SOLVER_EVM_PRIVATE_KEY` and `SOLVER_BCH_WIF` cannot use default Anvil/Hardhat development keys.
   - `ALLOW_DEV_KEYS=1` is strictly forbidden when `NETWORK=mainnet`.
   - Refusal: Throws `Dev private keys are strictly forbidden on mainnet`.
4. **Missing Chain Contracts or Peg Feeds**:
   - Missing Base lock contract addresses or unconfigured token addresses abort startup immediately.

### Environment Variables

Key configuration parameters:

- `NETWORK`: `mainnet` or `testnet` (defaults to `testnet`).
- `PORT`: HTTP listen port (default `3000`).
- `HOST`: HTTP listen host (default `0.0.0.0`).
- `BASE_RPC_URL`: JSON-RPC URL for Base / EVM chain.
- `BCH_ELECTRUM_HOSTS`: Comma-separated list of Electrum WebSocket URLs (e.g. `wss://fulcrum1.fountainhead.cash:50004,wss://bch.imaginary.cash:50004`).
- `SOLVER_EVM_PRIVATE_KEY`: 0x-prefixed 32-byte hex private key for signing terms and EVM transactions.
- `SOLVER_BCH_WIF`: Bitcoin Cash WIF private key for locking and claiming CashTokens.
- `OPERATOR_TOKEN`: Secret Bearer token for accessing administrative endpoints (must be >= 32 characters on mainnet).
- `SKEW_MAX_BPS`: Maximum inventory skew spread adjustment in basis points (default `50`).
- `QUOTING_ENABLED`: `1` (enabled) or `0` (paused).
- `LOG_LEVEL`: `debug`, `info`, `warn`, or `error` (default `info`).

### Startup Command

```bash
pnpm --filter @ferry/solver build
pnpm --filter @ferry/solver start
```

### Startup Verification

Immediately verify that the service is running and healthy:

```bash
curl http://localhost:3000/v1/health
```

Expected output:

```json
{
  "ok": true,
  "quotingEnabled": true,
  "timestamp": 1794820000
}
```

---

## 3. System Alerts & Operator Monitoring

Operators can monitor system health via the operator alerts endpoint:

```bash
curl -H "Authorization: Bearer <OPERATOR_TOKEN>" http://localhost:3000/v1/operator/alerts
```

### Alert Reference

| Alert Code              | Severity | Meaning                                                                                                      | Operator Action                                                                                                                 |
| :---------------------- | :------- | :----------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------ |
| `BCH_TIP_UNHEALTHY`     | Critical | Electrum server quorum lost consensus, nodes disconnected, or tip age > 120s. Quoting paused automatically.  | Check network connectivity to Fulcrum servers. Replace failing endpoints in `BCH_ELECTRUM_HOSTS`. Quoting resumes when healthy. |
| `EVM_TIP_UNHEALTHY`     | Critical | Base JSON-RPC endpoint unreachable, failing calls, or block tip age exceeded threshold.                      | Verify RPC provider status or switch to backup RPC URL. Quoting resumes once tip synchronizes.                                  |
| `ORDERS_NEED_ATTENTION` | Critical | One or more active swaps encountered an ambiguous broadcast, transaction revert, or failed state transition. | Query `GET /v1/operator/needs-attention` immediately and follow the resolution steps below.                                     |
| `PEG_GUARD`             | Warning  | Reference stablecoin price drifted outside allowable peg band (default 2%).                                  | Inspect Cauldron DEX or Chainlink feeds. Quoting for affected token is automatically blocked until peg recovers.                |
| `PRICE_UNAVAILABLE`     | Warning  | Spot or reference oracle price feed is stale or missing.                                                     | Check oracle API connectivity. Quoting refuses with `PRICE_UNAVAILABLE` until fresh prices arrive.                              |

---

## 4. Resolving Orders Needing Attention & Counter-Lock Failures

When an order enters `needs_attention`, it will never silently fail or double-spend. Query details:

```bash
curl -H "Authorization: Bearer <OPERATOR_TOKEN>" http://localhost:3000/v1/operator/needs-attention
```

### What To Do When a Counter-Lock Fails

A counter-lock failure occurs when a user has successfully locked funds on the origin chain (e.g., EVM USDC for `EVM_TO_BCH`), but the solver's transaction to lock counterparty funds on the destination chain (e.g., BCH CashTokens) fails to execute or confirm.

#### Root Causes:

1. **Network fee surge or UTXO contention**: Insufficient satoshis for miner fees or unconfirmed parent UTXO dependencies.
2. **Ambiguous broadcast / RPC drop**: Broadcast returned a socket timeout or HTTP 504 while the node may or may not have relayed the transaction.
3. **Nonce desync on EVM**: A previous transaction on Base is pending or replaced.

#### Plain-Prose Resolution Procedure:

1. **Do not blindly resubmit without verifying on-chain status**:
   - Check the destination chain explorer (Fulcrum/BCH explorer or Basescan) using the solver's address and script hash.
   - If the counter-lock transaction actually confirmed or is pending in the mempool, record the transaction hash in SQLite (`orders` table `solver_lock_tx_id`). The state machine will resume naturally.
2. **Check the Clock (Quote Expiry & User Timelock)**:
   - Check `order.quoteExpiry` and user lock refund height / deadline.
   - **Rule**: If the remaining window before user refund is less than the required confirmation margin, **ABORT the counter-lock**. Do not lock funds if there is a risk that the user refunds while your counter-lock confirms.
3. **Handling Safe Expiration**:
   - If the solver does not counter-lock, solver inventory remains untouched.
   - The user's lock will expire after their lock duration, allowing the user to claim a full refund via `evmRefund` or `bchRefund`.
   - The engine will transition the order to `EXPIRED` once counter deadline passes without a counter-lock.
4. **Resubmitting when Safe**:
   - If ample time remains and the failure was transient (e.g. fee rate too low or transient RPC error), replenish UTXOs or adjust gas price and trigger execution from the write-ahead queue.

---

## 5. Draining and Graceful Shutdown

When taking down the solver for maintenance, upgrades, or de-provisioning, follow this drain-and-stop procedure to prevent stuck user funds:

### Step 1: Pause Quoting

Prevent new quote requests from being accepted:

```bash
curl -X POST -H "Authorization: Bearer <OPERATOR_TOKEN>" http://localhost:3000/v1/pause
```

New quote requests will immediately be refused with `QUOTING_PAUSED`.

### Step 2: Monitor In-Flight Swaps

Inspect the inventory and open exposure:

```bash
curl -H "Authorization: Bearer <OPERATOR_TOKEN>" http://localhost:3000/v1/operator/inventory
```

Verify `exposure` across all assets. Inspect active orders:

```bash
curl http://localhost:3000/v1/orders/recent
```

Wait until all in-flight orders reach terminal states (`DONE`, `SOLVER_REFUNDED`, or `EXPIRED`).

### Step 3: Stop the Engine & Process

Once open exposure drops to 0:

```bash
curl -X POST -H "Authorization: Bearer <OPERATOR_TOKEN>" http://localhost:3000/v1/kill-switch
```

Then stop the daemon process:

```bash
kill -TERM <pid>
```

The process will close database connections, flush SQLite WAL checkpoints, and terminate cleanly.

---

## 6. Inventory & Skew Pricing Management

Check the current inventory view and dynamic skew adjustments:

```bash
curl -H "Authorization: Bearer <OPERATOR_TOKEN>" http://localhost:3000/v1/operator/inventory
```

Example response:

```json
{
  "bch": {
    "symbol": "PUSD",
    "inventory": "100000000",
    "reserved": "0",
    "exposure": "0",
    "available": "100000000"
  },
  "evm": {
    "symbol": "USDC",
    "inventory": "100000000",
    "reserved": "0",
    "exposure": "0",
    "available": "100000000"
  },
  "skewBps": 25,
  "skewMaxBps": 50,
  "asOf": 1794820000
}
```

The solver automatically applies skew pricing to incentivize inventory rebalancing:

- If EVM USDC inventory is higher than BCH PUSD inventory, forward swaps (`EVM_TO_BCH`) receive a slight spread surcharge (`+skewBps`), while reverse swaps (`BCH_TO_EVM`) receive a spread discount (`-skewBps`).
- The maximum adjustment is strictly capped by `SKEW_MAX_BPS` (default 50 bps).
