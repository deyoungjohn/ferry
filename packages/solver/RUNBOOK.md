# Ferry Solver Runbook

This document describes operational procedures for managing, monitoring, and troubleshooting the Ferry solver daemon in testnet and production environments.

---

## 1. Architecture Overview

The solver daemon acts as the automated market maker and cross-chain counterparty for Ferry swaps between Ethereum/Base (EVM) and Bitcoin Cash (BCH CashTokens).

Key components:

- **HTTP Server (Fastify)**: Exposes public quoting, order status, cooperative secret reveal, and pay/send link routes (`/v1/*`), plus operator management endpoints.
- **Engine Loop**: Background reconciliation and state machine runner driving active orders towards terminal completion.
- **BchQuorumClient**: Multi-node Electrum WebSocket client maintaining block tip consensus, UTXO queries, and double-spend proof monitoring.
- **EvmChainAdapter**: Viem-based EVM client handling lock detection, claims, refunds, and contract event subscriptions.
- **ActionExecutor & SQLite**: Crash-resilient write-ahead persistence (`data/solver.db`) guaranteeing no duplicate broadcasts or lost state across crashes.

---

## 2. Starting the Solver

### Prerequisites

- Node.js 22.x (`node -v`)
- Persistent SQLite database directory (`packages/solver/data`)
- RPC endpoints:
  - Base RPC endpoint (HTTPS)
  - At least 2 distinct Bitcoin Cash Electrum WebSocket endpoints (for mainnet quorum)

### Environment Variables

Key configuration parameters:

- `NETWORK`: `mainnet` or `testnet` (defaults to `testnet`).
- `PORT`: HTTP listen port (default `3000`).
- `HOST`: HTTP listen host (default `0.0.0.0`).
- `BASE_RPC_URL`: JSON-RPC URL for Base / EVM chain.
- `BCH_ELECTRUM_HOSTS`: Comma-separated list of Electrum WebSocket URLs (e.g. `wss://fulcrum1.fountainhead.cash:50004,wss://bch.imaginary.cash:50004`). Mainnet requires at least 2 distinct hosts.
- `SOLVER_EVM_PRIVATE_KEY`: 0x-prefixed 32-byte hex private key for signing terms and EVM transactions. Placeholder keys are strictly refused on mainnet.
- `SOLVER_BCH_WIF`: Bitcoin Cash WIF private key for locking and claiming CashTokens.
- `OPERATOR_TOKEN`: Secret Bearer token for accessing administrative endpoints. Must be >= 32 characters on mainnet.
- `QUOTING_ENABLED`: `1` (enabled) or `0` (paused).
- `LOG_LEVEL`: `debug`, `info`, `warn`, or `error` (default `info`).

### Startup Command

From the solver directory:

```bash
pnpm build
pnpm start
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

Check logs to ensure preflight self-checks passed without warnings:

- Electrum quorum established (`healthyNodeCount >= 2`)
- EVM chain client connected and synchronized
- Pending write-ahead intents recovered from SQLite

---

## 3. Stopping the Solver

The solver handles `SIGINT` (Ctrl+C) and `SIGTERM` signals with graceful shutdown:

1. Stops accepting new quote requests (`QUOTING_PAUSED`).
2. Finishes in-flight HTTP responses.
3. Halts new transaction dispatches in the action executor.
4. Flushes and checkpoints SQLite WAL logs.
5. Closes Electrum WebSocket connections and EVM event subscriptions.

To stop cleanly:

```bash
kill -TERM <pid>
```

Wait for the log message: `Ferry solver stopped cleanly`.

---

## 4. Emergency Kill Switch

If unexpected price volatility, peg deviation, contract vulnerability, or upstream disruption occurs, pause quoting immediately:

### Option A: Environment / Restart

Set `QUOTING_ENABLED=0` in the environment configuration and restart the process.

### Option B: Runtime Pause

When quoting is paused:

- `POST /v1/quotes` immediately returns HTTP 422 `QUOTING_PAUSED`.
- Existing non-terminal orders continue to be safely settled, claimed, or refunded by the engine loop.
- Fund safety is preserved without abrupt aborts of user trades.

---

## 5. Liquidity Management & Rebalancing

Check current available liquidity across routes:

```bash
curl http://localhost:3000/v1/liquidity
```

### Inspecting Inventory and Exposure

- `inventory`: Physical balance held in the solver's lock addresses.
- `exposure`: Open commitments in non-terminal swaps.
- `available`: `inventory - exposure - reserved`.
- `reserved`: Amount temporarily reserved for valid, unfunded active quotes.

### Rebalancing Flow

1. **Low EVM USDC**: Send native USDC on Base to `config.solverEvmAddress`.
2. **Low BCH CashTokens (PUSD / MUSD)**: Send token UTXOs with accompanying BCH gas sats (minimum carry sats) to `config.solverBchAddress`.
3. Check `GET /v1/liquidity` to confirm the new inventory is recognized.

---

## 6. Operational Alerts and Troubleshooting

### Alert 1: `BCH_TIP_UNHEALTHY` / Stale Electrum Quorum

- **Symptom**: `/v1/quotes` returns HTTP 503 `BCH_TIP_UNHEALTHY` or `STALE_CHAIN_TIP`.
- **Cause**: One or more Electrum servers have fallen behind, lost connection, or desynchronized from the network tip.
- **Action**:
  1. Inspect `GET /v1/health` and logs for individual node tip heights.
  2. If a specific Electrum server is unresponsive, update `BCH_ELECTRUM_HOSTS` to remove it or replace it with a healthy public Fulcrum node.
  3. Ensure network connectivity to port 50004 / WSS.

### Alert 2: `PEG_GUARD` Active

- **Symptom**: Quotes refused with HTTP 422 `PEG_GUARD`.
- **Cause**: Stablecoin reference price (USDC, PUSD, or MUSD) drifted beyond peg tolerance (default 2% / $0.02).
- **Action**:
  1. Check `GET /v1/pegs` for current oracle prices and timestamps.
  2. Verify whether Cauldron DEX (chipnet/mainnet) or Chainlink feed experienced a real de-peg or an oracle liquidity anomaly.
  3. Quoting will automatically resume when prices return to within peg tolerance.

### Alert 3: `needs_attention` Orders

- **Symptom**: Operator notification that an order requires manual inspection.
- **Inspection**:
  Query the operator endpoint using your secret bearer token:
  ```bash
  curl -H "Authorization: Bearer <OPERATOR_TOKEN>" http://localhost:3000/v1/operator/needs-attention
  ```
- **Common causes**:
  - `AMBIGUOUS_BROADCAST`: Node returned an ambiguous error (e.g. network timeout) and the transaction was not observed on-chain within timeout.
  - `REVERTED_TX`: EVM or BCH lock/claim transaction failed on-chain.
- **Resolution**:
  1. Check the transaction hash on the block explorer (Basescan or BCH 3xpl/explorer).
  2. If the transaction succeeded, record the txid in SQLite `orders` table.
  3. If the transaction definitively failed, clear the action in `actions` table and re-dispatch or mark refunded.

### Alert 4: `PRICE_UNAVAILABLE`

- **Symptom**: Quotes refused with HTTP 422 `PRICE_UNAVAILABLE`.
- **Cause**: Price feed reading is older than `PRICE_MAX_AGE_S` (30 seconds for spot/DEX) or exceeded the Chainlink feed heartbeat interval plus margin.
- **Action**:
  1. Verify outbound network connectivity to price APIs (Cauldron / Paryon / RPC).
  2. Check if Chainlink aggregator contract on Base is responding to `latestRoundData()`.

---

## 7. Metrics & Privacy

Public operational metrics can be queried at:

```bash
curl http://localhost:3000/v1/metrics
```

Metrics enforce strict privacy:

- Counters for quote volume, swap counts, settled totals, and active order counts.
- **NEVER** exposes user wallet addresses, order lists, IP addresses, or secrets.
