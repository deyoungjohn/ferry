# Ferry Solver Runbook

This document describes operational procedures for managing, monitoring, deploying, and troubleshooting the Ferry solver daemon in testnet and production environments.

---

## 1. Architecture Overview

The solver daemon acts as the automated market maker and cross-chain counterparty for Ferry swaps between EVM chains (Ethereum, Base, Arbitrum, etc.) and Bitcoin Cash (BCH CashTokens: PUSD, MUSD).

Key components:

- **HTTP Server (Fastify)**: Exposes public quoting, order status, cooperative secret reveal, and pay/send link routes (`/v1/*`), plus operator management endpoints. Requests enforce a strict 64 KB payload size limit, configurable CORS, trusted proxy support, and constant-time Bearer authentication on operator routes.
- **Engine Loop**: Background reconciliation and state machine runner driving active orders towards terminal completion.
- **BchQuorumClient**: Multi-node Electrum WebSocket client maintaining block tip consensus, UTXO queries, and double-spend proof monitoring.
- **EvmChainAdapter**: Viem-based EVM client handling lock detection, claims, refunds, and contract event subscriptions.
- **ActionExecutor & SQLite**: Crash-resilient write-ahead persistence (`data/solver.db`) guaranteeing no duplicate broadcasts or lost state across process restarts.
- **Liquidity & Skew Manager**: Dynamically manages inventory reserves, exposures, and implements inventory skew pricing (capped by `SKEW_MAX_BPS`).
- **Composite Price Source**: Integrates Cauldron spot DEX and Paryon stats via `@ferry/bch-prices` with peg guard enforcement, and on-chain Chainlink feeds for EVM stablecoins.

---

## 2. Environment Variables Reference

Every configurable environment variable is listed below. Corresponding template file is available at `packages/solver/.env.example`.

### Core Daemon & Networking

- `NETWORK`: `testnet` | `mainnet` (default `testnet`).
- `HOST`: HTTP server bind host (default `127.0.0.1` or `0.0.0.0` in container).
- `PORT`: HTTP listen port (default `8787`).
- `DATABASE_PATH`: SQLite database file path (e.g. `data/solver.db` or `:memory:`).
- `ALLOWED_ORIGINS`: Comma-separated CORS allowed origins (e.g. `https://ferry.cash,http://localhost:5173`) or `*` for all (default `*`).
- `TRUSTED_PROXY`: Set to `1` or `true` when running behind reverse proxies (Caddy, Nginx, Cloudflare) so `req.ip` reflects client addresses. Also accepts `TRUST_PROXY`.
- `LOG_LEVEL`: Pino logger severity: `trace`, `debug`, `info`, `warn`, `error`, `fatal` (default `info`).
- `LOG_FILE_PATH`: Path for persistent file logging with built-in rotation (e.g. `logs/solver.log`).
- `OPERATOR_TOKEN`: Bearer token for accessing `/v1/operator/*` routes. **Must be >= 32 characters on mainnet.**
- `QUOTING_ENABLED`: Master switch: `true` (default) or `false`.

### Chain Endpoints & Keys

- `BCH_ELECTRUM_URLS`: Comma-separated Electrum WebSocket URLs. **Mainnet requires at least two independent hosts.**
- `BCH_CHIPNET_ELECTRUM_URLS`: Electrum URLs used when running in testnet profile.
- `SOLVER_BCH_WIF`: Bitcoin Cash WIF private key for counter-locking CashTokens. Must be a mainnet key on mainnet.
- `SOLVER_EVM_PRIVATE_KEY`: 0x-prefixed 32-byte hex private key for EVM transactions.
- `ALLOW_DEV_KEYS`: Set to `1` on testnet to allow dev/placeholder keys. **Strictly forbidden on mainnet.**
- `BASE_RPC_URL`: JSON-RPC endpoint for Base (default `https://sepolia.base.org` on testnet).
- `BASE_CHAIN_ID`: EVM chain ID (default `84532` for Base Sepolia, `8453` for Base mainnet).
- `BASE_FERRY_HTLC_ADDRESS`: Deployed FerryHTLC contract address on Base (also accepts `FERRY_HTLC_ADDRESS`).
- `BASE_USDC_ADDRESS`: USDC token contract address on Base.
- `ENABLED_ROUTES`: Comma-separated list of route keys to enable (e.g. `USDC:base`).
- `RPC_URL_*`: Chain-specific RPC URL overrides for `loadChainConfig` (`RPC_URL_BASE`, `RPC_URL_ETHEREUM`, `RPC_URL_ARBITRUM`, etc.).

### Policy, Risk & Timing

- `DSPROOF_WINDOW_MS`: Double-spend proof observation window in milliseconds (default `5000`).
- `TIP_MAX_AGE_BCH_SECONDS`: Maximum tolerated age for BCH block tip before pausing quotes (default `7200`).
- `TIP_MAX_AGE_BASE_SECONDS`: Maximum tolerated age for EVM tip (default `60`).
- `RATE_LIMIT_WINDOW_MS`: Rate limiting rolling window in ms (default `60000`).
- `RATE_LIMIT_MAX_PER_ADDRESS`: Max quote requests per address per window (default `10`).
- `RATE_LIMIT_MAX_PER_IP`: Max quote requests per IP per window (default `30`).
- `SPREAD_BPS`: Base swap spread in basis points (default `40` = 0.40%).
- `FIXED_FEE_USD_MICROS`: Fixed fee added to quotes in USD micros (default `0`).
- `MIN_SWAP_USD_MICROS`: Minimum swap amount in USD micros (default `1000000` = $1.00).
- `MAX_SWAP_USD_MICROS`: Maximum swap amount in USD micros (default `50000000` = $50.00).
- `MAX_EXPOSURE_USD_MICROS`: Maximum concurrent unconfirmed swap exposure in USD micros (default `250000000` = $250.00).
- `ZERO_CONF_MAX_USD_MICROS`: Maximum amount accepted for zero-conf fast lane (default `25000000` = $25.00).
- `QUOTE_TTL_SECONDS`: Quote validity duration in seconds (default `60`).
- `SKEW_MAX_BPS`: Maximum inventory skew spread adjustment in basis points (default `50`).
- `EVM_CONFS`: Required block confirmations for safe EVM locks (default `1`).
- `FWD_BCH_REFUND_BLOCKS`: Forward BCH refund block delay (default `36` blocks ~ 6 hours).
- `FWD_EVM_DEADLINE_SECONDS`: Forward EVM lock deadline in seconds (default `86400` = 24 hours).
- `REV_BCH_REFUND_BLOCKS`: Reverse BCH refund block delay (default `144` blocks ~ 24 hours).
- `REV_EVM_DEADLINE_SECONDS`: Reverse EVM lock deadline in seconds (default `21600` = 6 hours).
- `BCH_CARRY_SATS`: Dust carry satoshis forwarded on CashToken outputs (default `3000`).
- `BCH_MAX_FEE_SATS`: Maximum satoshi transaction fee allowance (default `1500`).
- `TPUSD_CATEGORY`: CashToken category ID for testnet PUSD.
- `TMUSD_CATEGORY`: CashToken category ID for testnet MUSD.
- `ALLOW_MOCK_PAYLINK_SIGNATURES`: Enable mock signature verification for hermetic test suites (forbidden on mainnet).

---

## 3. Mainnet Safety Refusals

On `NETWORK=mainnet`, the daemon executes strict fail-closed validation during startup. It strictly refuses to boot under any of the following conditions:

1. **Missing or Short Operator Token**: `OPERATOR_TOKEN` is missing or shorter than 32 characters.
2. **Inadequate Electrum Quorum**: Fewer than 2 distinct, reachable Electrum hosts configured in `BCH_ELECTRUM_URLS`.
3. **Placeholder or Dev Keys**: Known Anvil/Hardhat dev keys or `ALLOW_DEV_KEYS=1` configured.
4. **Testnet BCH WIF**: Configured BCH private key uses testnet prefix (`c` or `9`).
5. **No Eligible Mainnet Routes**: No routes are eligible with verified contract addresses in chain facts.
6. **Zero Address Contract**: Configured HTLC address is the zero address.

---

## 4. Operational Deployment

### Running with Docker

Build and run the containerized solver daemon:

```bash
docker build -f packages/solver/Dockerfile -t ferry-solver .
docker run -d \
  --name ferry-solver \
  -p 8787:8787 \
  -v $(pwd)/data:/app/data \
  -v $(pwd)/logs:/app/logs \
  --env-file .env.local \
  ferry-solver
```

### Running with Systemd

Create `/etc/systemd/system/ferry-solver.service`:

```ini
[Unit]
Description=Ferry Cross-Chain Solver Daemon
After=network.target

[Service]
Type=simple
User=ferry
WorkingDirectory=/opt/ferry
EnvironmentFile=/etc/ferry/solver.env
ExecStart=/usr/bin/node /opt/ferry/packages/solver/dist/main.js
Restart=always
RestartSec=5s
LimitNOFILE=65536
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

Enable and start the service:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now ferry-solver
```

### Caddy Reverse Proxy & TLS Example

Caddy provides automatic TLS certificates and simple reverse proxying:

```caddyfile
api.ferry.cash {
    encode gzip zstd

    # Strip or pass through headers
    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains"
        X-Content-Type-Options "nosniff"
        X-Frame-Options "DENY"
    }

    # Proxy to solver daemon
    reverse_proxy 127.0.0.1:8787 {
        header_up X-Forwarded-For {remote_host}
        header_up X-Forwarded-Proto {scheme}
    }
}
```

When running behind Caddy, ensure `TRUSTED_PROXY=1` is set in solver environment so rate limiting uses real remote IPs.

---

## 5. Maintenance & Database Backup

The daemon stores active orders and write-ahead transaction intents in SQLite with WAL (Write-Ahead Logging) enabled.

### Safe Online Backup Command

To safely back up SQLite without stopping the daemon, use SQLite's online backup API:

```bash
sqlite3 data/solver.db ".backup 'data/backup-$(date +%Y%m%d%H%M%S).db'"
```

This safely copies the database even while transactions and checkpoints are actively occurring.

### Automated Nightly Backup Cron Example

```cron
0 3 * * * sqlite3 /opt/ferry/data/solver.db ".backup '/opt/ferry/backups/solver-$(date +\%Y\%m\%d).db'" && find /opt/ferry/backups/ -name "solver-*.db" -mtime +14 -delete
```

---

## 6. Log File Rotation

The solver daemon features built-in rotating file logging when `LOG_FILE_PATH` is configured:

- When `LOG_FILE_PATH=logs/solver.log` is set, logs rotate automatically upon reaching 10 MB.
- Keeps up to 5 previous rotated files (`solver.log.1`, `solver.log.2`, etc.).
- Compact one-line records are simultaneously streamed to stdout for terminal and systemd journal visibility.

### Optional Linux Logrotate Configuration

If managing rotation externally via standard Linux `logrotate` (`/etc/logrotate.d/ferry-solver`):

```logrotate
/var/log/ferry/solver.log {
    daily
    missingok
    rotate 14
    compress
    delaycompress
    notifempty
    copytruncate
}
```

---

## 7. Monitoring & Health Endpoints

### Public Health Check

```bash
curl http://127.0.0.1:8787/v1/health
```

### Route Readiness Monitoring (Operator)

Returns live readiness evaluation per enabled route:

```bash
curl -H "Authorization: Bearer <OPERATOR_TOKEN>" http://127.0.0.1:8787/v1/operator/routes
```

Evaluates 5 operational criteria per route:

1. `htlcCodePresent`: On-chain bytecode verified at HTLC address.
2. `rpcReachable`: EVM JSON-RPC answers tip within freshness window and log cap range is known.
3. `priceFresh`: Reference oracle prices (Cauldron/Paryon and Chainlink) are fresh and within allowable age.
4. `inventoryAboveFloor`: Solver inventory exceeds minimum swap floor threshold.
5. `quorumHealthy`: BCH Electrum multi-server quorum is healthy.

### Operator Alerts

```bash
curl -H "Authorization: Bearer <OPERATOR_TOKEN>" http://127.0.0.1:8787/v1/operator/alerts
```

### Graceful Shutdown

The daemon intercepts `SIGINT` and `SIGTERM`:

1. Pauses HTTP listener.
2. Stops solver state machine runner.
3. Closes Electrum WebSocket subscriptions.
4. Closes SQLite database connection cleanly.
