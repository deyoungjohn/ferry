# Deploying Ferry on one Lightsail server

One Ubuntu 24.04 Lightsail instance runs the solver and the website. Caddy is the
only public origin: it serves the web app from `/var/www/ferry/dist` and proxies
`/v1/*` to the solver on `127.0.0.1:8787`. The landing, features, proof, guide,
swap, pay and send pages are all inside the one app at the root of the domain.

The domain is `ferry.incepture.dev`. Examples use `203.0.113.10` for the server
address. No file in this folder contains a secret.

**Paths used everywhere below**

| What                                    | Where                                                               |
| --------------------------------------- | ------------------------------------------------------------------- |
| The one clone of the repository         | `/opt/ferry` (owned by `ubuntu`; you run everything there directly) |
| Solver environment file (secrets)       | `/etc/ferry/solver.env` (`0600`, owned by `ferry`)                  |
| Web build settings (public values only) | `/opt/ferry/packages/web/.env.production`                           |
| Built website                           | `/var/www/ferry/dist`                                               |
| Solver database and backups             | `/var/lib/ferry/`                                                   |
| Solver logs                             | `journalctl -u ferry-solver`                                        |

The solver runs **from source** (`node --conditions=ferry-source --import tsx
src/main.ts` in `/opt/ferry/packages/solver`), exactly as the tests run it, so
there is no solver build step. Only the website is built.

## 1. Create the instance

1. In Lightsail create an **Ubuntu 24.04** instance, **2 vCPU and 4 GB**.
2. Attach a **static IP**.
3. In **Networking** allow SSH 22, HTTP 80 and HTTPS 443.
4. Create a DNS **A** record `ferry.incepture.dev -> <static IP>`.
5. Download the Lightsail SSH key and log in:

```bash
ssh -i lightsail-key.pem ubuntu@203.0.113.10
```

## 2. Keep your SSH access

The bootstrap turns off password and root SSH login. Your key must already be in
`~/.ssh/authorized_keys` for `ubuntu` (it is, if the login above worked). After
the bootstrap, open a second terminal and confirm you can still log in before you
close the first one.

## 3. Clone and bootstrap

```bash
sudo install -d -o ubuntu -g ubuntu /opt/ferry
git clone https://github.com/deyoungjohn/ferry.git /opt/ferry
cd /opt/ferry
sudo bash deploy/bootstrap.sh
```

To restrict SSH to one address add `ADMIN_IP=203.0.113.10` before `bash`; leave it
out if you connect from changing networks. The bootstrap installs Node 22 (the
version in `.nvmrc`), pnpm, Caddy, `fail2ban`, the firewall rules, the `ferry`
service user, the directories and the systemd units. It does not start anything
and reads no secret. It is safe to run again; do that after every `git pull` that
changes anything in `deploy/`.

## 4. Build the website

```bash
cd /opt/ferry
pnpm install --frozen-lockfile
cp packages/web/.env.example packages/web/.env.production
nano packages/web/.env.production
```

Fill in the web settings (public values only, no keys):

```dotenv
VITE_NETWORK=mainnet
VITE_SOLVER_URLS=https://ferry.incepture.dev
VITE_REOWN_PROJECT_ID=<your Reown project id>
VITE_MOCK=
VITE_PRIOR_REPO_URL=https://github.com/deyoungjohn/ferry-testnet
VITE_DECK_URL=<when you have it>
VITE_EMBER_ADDRESS=<when you have it>
```

Then build and publish the files:

```bash
cd /opt/ferry
pnpm --filter @ferry/web build
sudo rsync -a --delete packages/web/dist/ /var/www/ferry/dist/
sudo chown -R root:root /var/www/ferry/dist
```

Until this step has run, `https://ferry.incepture.dev/` returns 404 because the
folder is empty.

## 5. Install the solver environment

Generate the keys offline first (`preparation/KEYS.md`). Do not copy the deployer
key to the server: copy only the two solver keys.

Two env files exist, in two places:

| File                           | Where                                                                                                                                       | Holds                                                     |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `solver.env`                   | Written on **your machine** (outside the repository, for example `~/ferry-solver.env`, `chmod 600`), then copied to `/etc/ferry/solver.env` | Everything in this section, including the two solver keys |
| `packages/web/.env.production` | On the server, `/opt/ferry` (section 4)                                                                                                     | Public web settings only                                  |

Start your local file from this block and fill in the `<...>` values yourself:

```dotenv
NETWORK=mainnet
FERRY_NETWORK=mainnet
ENABLED_ROUTES=usdc:base
HOST=127.0.0.1
PORT=8787
DATABASE_PATH=/var/lib/ferry/solver.db
TRUSTED_PROXY=true

BCH_ELECTRUM_URLS=wss://electron.jochen-hoenicke.de:51004,wss://electroncash.dk:50004,wss://bch.imaginary.cash:50004

BASE_RPC_URL=<your Base RPC URL>
RPC_URL_BASE=<the same Base RPC URL>
BASE_CHAIN_ID=8453
BASE_FERRY_HTLC_ADDRESS=0x8b968625F983420B571C102eC0b57F7e509c916e
BASE_USDC_ADDRESS=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913

TPUSD_CATEGORY=2469acc5afa4b10cb5b5c04afb89c3a3ffd61c5da9c01e26d00951cae2a02544
TMUSD_CATEGORY=b38a33f750f84c5c169a6f23cb873e6e79605021585d4f3408789689ed87f366

MAX_SWAP_USD_MICROS=1000000

SOLVER_EVM_PRIVATE_KEY=<from your key file: SOLVER_EVM_PRIVATE_KEY>
SOLVER_BCH_WIF=<from your key file: SOLVER_BCH_WIF>
OPERATOR_TOKEN=<at least 32 random characters, for example: openssl rand -hex 32>
```

Where the values come from:

- **Chain, token and contract values** are public facts, filled in above. The
  `TPUSD_`/`TMUSD_` names are historical; they take the mainnet PUSD and MUSD
  category IDs.
- **`BASE_RPC_URL` / `RPC_URL_BASE`:** your own paid Base endpoint, or the public
  `https://base-rpc.publicnode.com` as a fallback. Use the same URL for both.
- **The two solver keys:** copy only those two lines from `.env.mainnet.local`.
  Never copy `DEPLOYER_EVM_PRIVATE_KEY`.
- **`OPERATOR_TOKEN`:** generate it and keep a copy; the operator routes and the
  emergency stop need it.
- **`MAX_SWAP_USD_MICROS=1000000`** is the $1 cap for the first swaps.
- **`RESERVATION_CAP_PER_ADDRESS_USD_MICROS`** (optional): active reservation cap per user address in USD micros (default: min(2 × `MAX_SWAP_USD_MICROS`, `MAX_EXPOSURE_USD_MICROS`)).
- **`RESERVATION_CAP_PER_IP_USD_MICROS`** (optional): active reservation cap per IP in USD micros (default: min(2 × `MAX_SWAP_USD_MICROS`, `MAX_EXPOSURE_USD_MICROS`)).
- **`COST_MODEL_ENABLED`** (optional): whether quotes floor fees at live network cost plus safety margin (default: `true`).
- **`COST_SAFETY_PERCENT`** (optional): safety margin percent added to measured gas and BCH tx costs (default: `25`).
- **`MIN_MARGIN_USD_MICROS`** (optional): fixed solver margin in USD micros added on top of costs (default: `0`).
- **`COST_CACHE_TTL_SECONDS`** (optional): cost model input cache time-to-live in seconds (default: `45`).
- **`BASE_ETH_USD_FEED_ADDRESS`** (optional): Chainlink ETH/USD feed contract on Base (default: `0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70`).
- **`ETH_USD_MAX_AGE_SECONDS`** (optional): staleness limit for ETH/USD feed in seconds (default: `1800`).
- **`BCH_USD_MAX_AGE_SECONDS`** (optional): staleness limit for BCH/USD feeds in seconds (default: `300`).
- **`BASE_GAS_MAX_AGE_SECONDS`** (optional): staleness limit for Base gas price in seconds (default: `60`).
- **`BCH_FEE_RATE_MAX_AGE_SECONDS`** (optional): staleness limit for BCH quorum fee rate in seconds (default: `300`).
- **`BCH_USD_DISAGREEMENT_PERCENT`** (optional): maximum allowed percent divergence between public BCH/USD price feeds (default: `5`).

`HOST=127.0.0.1` keeps the solver off the public network, and `TRUSTED_PROXY=true`
is right because Caddy is the only caller. Do not set `ALLOW_DEV_KEYS` or
`ALLOW_MOCK_PAYLINK_SIGNATURES`.

Copy the file to the server from **your machine** and install it with the right
owner:

```bash
scp -i lightsail-key.pem ~/ferry-solver.env ubuntu@203.0.113.10:/tmp/solver.env
ssh -i lightsail-key.pem ubuntu@203.0.113.10 \
  'sudo install -m 0600 -o ferry -g ferry /tmp/solver.env /etc/ferry/solver.env && rm -f /tmp/solver.env'
```

Never paste a key into a shell command, chat, ticket or repository.

## 6. Check before you start

On the server, with your three public addresses (deployer EVM, solver EVM, solver
BCH token-aware):

```bash
cd /opt/ferry
ENABLED_ROUTES=usdc:base PREFLIGHT_ADDRESSES="deployer=0xDEPLOYER,solver=0xSOLVER,bch=bitcoincash:zSOLVER" pnpm --filter @ferry/chain-config preflight --strict
```

Write it as one line. It must end with `GO for mainnet launch`. If it lists
something missing (solver gas, USDC, PUSD, BCH), fund that first.

## 7. Start the services

Point Caddy at the domain, then start things in this order:

```bash
sudo sed -i 's/example.org/ferry.incepture.dev/' /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl daemon-reload
sudo systemctl enable --now caddy.service
sudo systemctl enable --now ferry-solver.service
sudo systemctl start ferry-backup.timer ferry-health.timer
```

Check it:

```bash
sudo systemctl status ferry-solver.service --no-pager
curl -fsS https://ferry.incepture.dev/v1/health
curl -fsSI https://ferry.incepture.dev/app/swap
cd /opt/ferry && pnpm --dir scripts/preflight preflight -- --url https://ferry.incepture.dev
```

`/v1/health` must return JSON (`{"ok":true,...}`). Then open
`https://ferry.incepture.dev/status` in a browser and press **Test All Routes
(Quote-Only)**; that checks every route without locking anything.

### Cost feeds & external source operator checks

> [!NOTE]
> Lightsail firewall is inbound-only (allowing SSH 22, HTTP 80, and HTTPS 443). Outbound traffic from the instance to external HTTPS and WebSocket endpoints (Coinbase, Kraken, Bitstamp, Base RPCs, and BCH Electrum hosts) is unrestricted by AWS. If quoting pauses or prices report stale in `/v1/health`, operators can verify feed reachability with these one-liners:

```bash
# 1. Coinbase BCH/USD spot price
curl -fsS "https://api.coinbase.com/v2/prices/BCH-USD/spot"

# 2. Kraken BCH/USD ticker
curl -fsS "https://api.kraken.com/0/public/Ticker?pair=BCHUSD"

# 3. Bitstamp BCH/USD ticker
curl -fsS "https://api.bitstamp.net/api/v2/ticker/bchusd/"

# 4. Base RPC Chainlink ETH/USD & Gas (test each configured Base RPC)
curl -fsS -X POST -H "Content-Type: application/json" --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' https://base-rpc.publicnode.com
curl -fsS -X POST -H "Content-Type: application/json" --data '{"jsonrpc":"2.0","method":"eth_gasPrice","params":[],"id":1}' https://base-rpc.publicnode.com

# 5. Inspect solver feed health & grace period status
curl -fsS http://127.0.0.1:8787/v1/health | jq .costFeeds
```

### Autonomous Swap Execution & Watching Orders

With real on-chain transaction builders and execution ports active (`executionReady: true`), the solver engine operates autonomously through its reconciliation loop:

1. **What the solver does autonomously:**
   - **Forward Swaps (EVM to BCH):**
     - Watches the Base HTLC contract for user locks.
     - Once finality is reached (1 confirmation on the fast lane, finalized on the safe lane), builds, signs with `SOLVER_BCH_WIF`, and broadcasts the real BCH lock transaction (Libauth VM verified) locking PUSD or MUSD to the P2SH32 covenant.
     - Monitors Electrum history on the covenant script hash. When the user spends the covenant, extracts the secret preimage from the unlocking script.
     - Claims the user's locked USDC on Base via `evmAdapter.claim`.
   - **Reverse Swaps (BCH to EVM):**
     - Watches the BCH covenant for user lock transactions (monitoring double-spend proofs for fast-lane 0-conf safety).
     - Counter-locks USDC on Base via `evmAdapter.lock`.
     - Watches Base contract events for the user's `Claimed` transaction and decodes the secret preimage.
     - Claims the user's locked PUSD or MUSD on BCH using CashScript and broadcasts the claim transaction.

2. **Funding requirements:**
   - **Bitcoin Cash (`SOLVER_BCH_WIF` address):**
     - CashTokens: **PUSD** / **MUSD** tokens for forward lock obligations.
     - Satoshis: **BCH** satoshis for UTXO carry amounts (3,000 sats per output) and network miner fees.
   - **Base (`SOLVER_EVM_PRIVATE_KEY` address):**
     - ERC-20: **USDC** tokens for reverse counter-lock obligations.
     - Native Gas: **ETH** on Base to pay gas for EVM locks and claims (self-check verifies that ETH balance covers estimated claim gas).

3. **How to watch an order go through:**
   - **Query SQLite order state:**
     ```bash
     sqlite3 /var/lib/ferry/solver.db \
       "SELECT id, direction, status, hashLock, secret, userLockTxId, solverLockTxId, userClaimTxId, solverClaimTxId FROM orders ORDER BY createdAt DESC LIMIT 5;"
     ```
   - **Query write-ahead action intents:**
     ```bash
     sqlite3 /var/lib/ferry/solver.db \
       "SELECT orderId, actionType, status, txid FROM action_intents;"
     ```
   - **Tail solver engine logs:**
     ```bash
     # Follow live solver systemd service journal
     sudo journalctl -u ferry-solver -f

     # Or tail file logs if LOG_FILE_PATH is configured in /etc/ferry/solver.env
     tail -f /var/log/ferry/solver.log
     ```

## 8. Update

The everyday commands are one script, run as the normal login user:

```bash
/opt/ferry/deploy/ferry-ops.sh health     # check everything; changes nothing
/opt/ferry/deploy/ferry-ops.sh update     # pull, build, publish, restart, then check
/opt/ferry/deploy/ferry-ops.sh caddy      # show and apply a changed Caddyfile
/opt/ferry/deploy/ferry-ops.sh logs       # follow the solver's log
/opt/ferry/deploy/ferry-ops.sh rollback <commit>
```

`health` runs the solver self-check as the service user with `/etc/ferry/solver.env`
loaded (running it by hand fails with "SOLVER_EVM_PRIVATE_KEY is not set" because only
systemd reads that file). The steps the script runs are listed below.

Take a Lightsail snapshot first. Then:

```bash
cd /opt/ferry
git pull --ff-only
pnpm install --frozen-lockfile
sudo bash deploy/bootstrap.sh          # only if deploy/ changed
pnpm --filter @ferry/web build
sudo rsync -a --delete packages/web/dist/ /var/www/ferry/dist/
sudo systemctl restart ferry-solver.service
```

The solver needs no build; restarting it picks up the new code. Run the strict
preflight again if chain configuration or addresses changed.

## 9. Roll back

Preferred: restore the Lightsail snapshot taken before the change. To roll back
only the code:

```bash
cd /opt/ferry
git switch --detach <previous-commit>
pnpm install --frozen-lockfile
pnpm --filter @ferry/web build
sudo rsync -a --delete packages/web/dist/ /var/www/ferry/dist/
sudo systemctl restart ferry-solver.service
```

Do not restore a database backup over a running solver: stop it first, restore,
start it, and watch the journal.

## 10. Logs

```bash
sudo journalctl -u ferry-solver -n 100 --no-pager
sudo journalctl -u ferry-solver -f
sudo journalctl -u ferry-health -n 50 --no-pager
sudo tail -f /var/log/caddy/ferry-access.log
```

Caddy access logs keep only the network prefix of client addresses.

## 11. If something is wrong

| You see                                       | Likely cause                                      | What to do                                                                                                                           |
| --------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `/v1/health` returns **502**                  | The solver is not running                         | `sudo journalctl -u ferry-solver -n 50 --no-pager`; the last lines say why                                                           |
| `/` or `/app/swap` returns **404**            | The website was never copied                      | Run the build and `rsync` in section 4                                                                                               |
| Journal says a variable is missing or invalid | `/etc/ferry/solver.env` incomplete                | Compare with the block in section 5; edit with `sudo nano /etc/ferry/solver.env`, then `sudo systemctl restart ferry-solver.service` |
| Journal says genesis verification failed      | A Bitcoin Cash host is down or on the wrong chain | Check `BCH_ELECTRUM_URLS`; use at least two of the hosts in section 5                                                                |
| `Start request repeated too quickly`          | The solver crashed five times in a row            | Fix the cause from the journal, then `sudo systemctl reset-failed ferry-solver.service && sudo systemctl start ferry-solver.service` |
| Preflight says the URL "returned HTML"        | The domain points at another site                 | Check the DNS record and `/etc/caddy/Caddyfile`                                                                                      |

## 12. Stop quoting in an emergency

`/v1/pause` stops new quotes and leaves the process running; `/v1/kill-switch`
stops the engine (restart the solver to recover). Both persist across restarts
until you resume.

```bash
TOKEN="$(sudo sed -n 's/^OPERATOR_TOKEN=//p' /etc/ferry/solver.env)"
curl -fsS -X POST -H "Authorization: Bearer $TOKEN" http://127.0.0.1:8787/v1/pause
unset TOKEN
```

The token is read into the shell and never printed. If the solver may be
compromised: stop it first (`sudo systemctl stop ferry-solver`), move funds, and
rotate the keys as described in `preparation/KEYS.md`.

## 13. Backups and daily copy hook

`ferry-backup.timer` runs every 15 minutes and keeps the 48 newest
`/var/lib/ferry/backups/solver-*.db` files. The service uses `sqlite3 .backup`,
so it is safe while the solver is running.

A daily copy hook is a documented extension point, not configured by the
bootstrap. To use one, create an executable `/etc/ferry/daily-backup.sh` owned by
`root:ferry` mode `0750`. It receives the newest backup path as its first
argument and runs at most once per UTC day. Put off-instance credentials in the
root-only hook or in a root-only environment file; never in this repository.

## 14. Files installed by the bootstrap

| Source                                | Destination                                     | Mode / owner       |
| ------------------------------------- | ----------------------------------------------- | ------------------ |
| `deploy/Caddyfile`                    | `/etc/caddy/Caddyfile` (if not already Ferry's) | `0644 root:root`   |
| `deploy/backup.sh`                    | `/usr/local/sbin/ferry-backup`                  | `0750 root:ferry`  |
| `deploy/healthcheck.sh`               | `/usr/local/sbin/ferry-healthcheck`             | `0750 root:ferry`  |
| `deploy/systemd/ferry-solver.service` | `/etc/systemd/system/`                          | `0644 root:root`   |
| `deploy/systemd/ferry-backup.*`       | `/etc/systemd/system/`                          | `0644 root:root`   |
| `deploy/systemd/ferry-health.*`       | `/etc/systemd/system/`                          | `0644 root:root`   |
| generated solver file                 | `/etc/ferry/solver.env`                         | `0600 ferry:ferry` |
| SQLite state                          | `/var/lib/ferry/solver.db`                      | `ferry:ferry`      |
| solver logs                           | `/var/log/ferry`                                | `0750 ferry:ferry` |
| static site                           | `/var/www/ferry/dist`                           | `0755 root:root`   |
| Caddy access log                      | `/var/log/caddy/ferry-access.log`               | `0640 caddy:caddy` |

## 15. Local checks before a server change

```bash
bash -n deploy/bootstrap.sh deploy/backup.sh deploy/healthcheck.sh
shellcheck deploy/bootstrap.sh deploy/backup.sh deploy/healthcheck.sh
systemd-analyze verify deploy/systemd/*.service deploy/systemd/*.timer
pnpm exec vitest run scripts/preflight
```

Install `shellcheck` locally if it is missing (`apt-get install shellcheck`, or
use the upstream release binary). On a workstation, `systemd-analyze verify` may
report `/usr/local/bin/node` and the two helper scripts as missing because the
bootstrap has not run there. That is expected; a syntax or directive error is a
real failure. `caddy validate` needs the official Caddy binary and a writable
temporary access-log path, or run it on the server after bootstrap.

## 16. Contract Redeployment & Verification Checklist (FerryHTLC with Early Release)

When deploying or upgrading `FerryHTLC` across chains:

- **Factory:** `0x4e59b44847b379578588920cA78FbF26c0B4956C` (standard CREATE2 singleton)
- **Salt:** `keccak256("ferry-htlc.v1")`
- **Init Code Hash:** See `FERRY_HTLC_INIT_CODE_HASH` in `packages/chain-config/src/htlc.ts`
- **Predicted Address:** `0xfC28c2596C553353578a5a444d2316514009DAdF`
- **Superseded Address:** `0x8b968625F983420B571C102eC0b57F7e509c916e` (retained for backward-compatible recovery of legacy locks)

### Redeployment steps

1. In `packages/htlc-evm`:
   ```bash
   # Predict address locally (verifies deterministic output)
   forge script script/Deploy.s.sol:Deploy --sig "predict()"
   ```
2. Broadcast deployment to each chain:
   ```bash
   # Base (8453)
   forge script script/Deploy.s.sol:Deploy --rpc-url https://mainnet.base.org --broadcast --private-key $DEPLOYER_KEY

   # Arbitrum (42161)
   forge script script/Deploy.s.sol:Deploy --rpc-url https://arb1.arbitrum.io/rpc --broadcast --private-key $DEPLOYER_KEY

   # Ethereum (1)
   forge script script/Deploy.s.sol:Deploy --rpc-url https://eth.llamarpc.com --broadcast --private-key $DEPLOYER_KEY

   # BNB Smart Chain (56)
   forge script script/Deploy.s.sol:Deploy --rpc-url https://bsc-dataseed.binance.org --broadcast --private-key $DEPLOYER_KEY
   ```
3. Verify source code on block explorers:
   ```bash
   # Etherscan / Basescan / Arbiscan
   forge verify-contract 0xfC28c2596C553353578a5a444d2316514009DAdF src/FerryHTLC.sol:FerryHTLC \
     --chain-id <CHAIN_ID> \
     --watch \
     --etherscan-api-key $EXPLORER_API_KEY

   # Sourcify (free, decentralized, works across all EVM chains)
   forge verify-contract 0xfC28c2596C553353578a5a444d2316514009DAdF src/FerryHTLC.sol:FerryHTLC \
     --verifier sourcify
   ```
4. Record deployments in `@ferry/chain-config`:
   ```bash
   pnpm --filter @ferry/chain-config record-deployment --chain base --address 0xfC28c2596C553353578a5a444d2316514009DAdF --block <DEPLOY_BLOCK>
   ```
5. Confirm routes and health via preflight:
   ```bash
   pnpm --filter @ferry/chain-config preflight
   ```

## 17. WizardConnect Pairing Relay (Optional Self-Hosted Relay)

To resolve pairing drops through public third-party relays (`relay.riften.net`, `relay.cauldron.quest`), Ferry provides an optional, self-hosted Nostr pairing relay ready to deploy on the Lightsail instance.

### Architecture & Container Justification

- **Software:** `nostr-rs-relay:0.9.0` (MIT, pinned digest `sha256:03f54bfbffff80a50db62c9287913bd25a2dec08033b56d2122bc2550363d5c5`).
- **Container Justification:** A pinned container provides a self-contained Rust binary with SQLite and enforces strict resource boundaries (`--memory 256m --cpus 0.5`) on the 4 GB Lightsail host without requiring Rust build tools or system libraries.
- **Network Isolation:** The container binds strictly to `127.0.0.1:8088`. Caddy acts as the public TLS reverse proxy.
- **Pairing Tuning (`deploy/relay/config.toml`):**
  - Public read/write for ephemeral pairing gift wraps (NIP-59 `kind: 1059`).
  - Small event and frame size limits (64 KB).
  - Short ping interval (`ping_interval = 30` seconds) to maintain WebSocket transport while phones open camera lenses.
  - Per-server rate limit (30 msgs/sec).
  - SQLite storage in `/var/lib/ferry/relay/db/nostr.db`. Ephemeral pairing events require **no backups**.

### DNS Setup

Add a dedicated DNS **A** record pointing to the server's public IP:

```
relay.ferry.incepture.dev -> 203.0.113.10
```

_(The pairing link `wiz://<host>` carries only a hostname without path, so the relay requires its own subdomain)._

### Operations Commands

Run from `/opt/ferry` as the login user:

```bash
# 1. Install and start the container
deploy/ferry-ops.sh relay install

# 2. Check running status, version, memory, active connections, and event count
deploy/ferry-ops.sh relay status

# 3. Follow relay logs
deploy/ferry-ops.sh relay logs

# 4. Probe relay health (NIP-11 information document)
deploy/ferry-ops.sh relay probe
# Or probe from anywhere:
curl -H "Accept: application/nostr+json" https://relay.ferry.incepture.dev/

# 5. Restart or remove
deploy/ferry-ops.sh relay restart
deploy/ferry-ops.sh relay remove
```

### Maintainer Decision Note: Self-Hosted Relay vs Default Fallbacks

#### The Redundancy Trade-Off

- **Paytaca Wallet Behavior:** In `@wizardconnect/core` (`decodeKeyExchangeURI`), a `wiz://<host>` link naming a specific relay causes Paytaca to connect **exclusively** to that single relay. Paytaca **ignores** the default relay fallbacks when a host is present in the link.
- **DApp Behavior:** The web app can connect to multiple relays (`WIZARD_RELAY_URLS`), but Paytaca's single-relay lock-in means that if our self-hosted relay becomes unreachable (or is blocked on a cellular carrier), Paytaca cannot fall back to Riften or Cauldron.
- **Third-Party Default:** When `VITE_WIZARD_RELAY_URLS` is empty, WizardConnect defaults to dual public relays (`relay.riften.net` and `relay.cauldron.quest`).

#### Measured Resource Usage

Measured on local run during full pairing, bi-directional message crossing, and relay restart:

- **Memory:** 12.4 MB (container cap: 256 MB; <0.3% of 4 GB host RAM).
- **CPU:** <0.1% idle, undetectable CPU impact during active pairings.
- **Disk:** Ephemeral SQLite database (~250 KB initial schema, <1 MB with pairing events).

#### What to Watch After Enabling

1. **Connection Stability:** Run `deploy/ferry-ops.sh relay status` and monitor active WebSocket connections during mobile wallet pairing.
2. **Caddy TLS & Logs:** Confirm TLS issuance on `relay.<domain>` via `curl -H "Accept: application/nostr+json" https://relay.<domain>/` and inspect `/var/log/caddy/relay-access.log`.
3. **Pairing Success Rate:** Watch whether mobile users on cellular data experience QR pairing stalls.

#### How to Switch On

1. Point DNS `relay.<domain>` to server IP.
2. In `deploy/Caddyfile`, apply changes: `deploy/ferry-ops.sh caddy`.
3. Start container: `deploy/ferry-ops.sh relay install`.
4. Set in `/opt/ferry/packages/web/.env.production`:
   ```
   VITE_WIZARD_RELAY_URLS=wss://relay.ferry.incepture.dev
   ```
5. Rebuild and publish website: `deploy/ferry-ops.sh update`.

#### How to Switch Back

If any issue arises:

1. Clear or comment out `VITE_WIZARD_RELAY_URLS` in `packages/web/.env.production`.
2. Rebuild and publish site: `pnpm --filter @ferry/web build && sudo rsync -a --delete packages/web/dist/ /var/www/ferry/dist/`.
3. Optionally stop container: `deploy/ferry-ops.sh relay remove`.

#### Recommendation for 22 Nov Deadline

- **Recommendation:** Keep the relay **ready to deploy, but do not point production traffic to it immediately**.
- **Reasoning:** Client-side handling is already hardened: pairing dialogs explain dropped connections and provide persistent recovery buttons ("Show the QR again" and "Reconnect wallet"). Because Paytaca connects exclusively to the URI host without fallback, deploying a single self-hosted relay removes the dual-relay redundancy provided by Riften and Cauldron.
- **Next Step:** Verify the self-hosted relay with a real mobile device running Paytaca across cellular carriers before toggling `VITE_WIZARD_RELAY_URLS` on the production site.
