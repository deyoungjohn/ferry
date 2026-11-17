# Ferry server bootstrap

One Ubuntu 24.04 Lightsail instance runs the solver and one single-page app at
the domain root. The landing, features, proof, guides, swap, pay and send pages
are all inside the app; there is no `/swap/` sub-path and no separate landing
folder. Caddy is the only public origin: it serves the Vite `dist` and proxies
`/v1/*` to the solver on `127.0.0.1:8787`. `trusted_proxies` is intentionally
unset, so Caddy does not trust an inbound CDN or proxy. The solver sets
`TRUSTED_PROXY=true` only because Caddy is the sole local caller on
`127.0.0.1`.

The examples use `example.org` and `203.0.113.10`. The launch domain is
`ferry.incepture.dev`; replace the example in the committed Caddyfile and in the
commands below. No file in this folder contains a secret.

## 1. Create the instance

1. In Lightsail, create an **Ubuntu 24.04** instance with **2 vCPU and 4 GB**.
2. Attach a **static IP** and use `203.0.113.10` below as the example.
3. In **Networking**, allow:
   - SSH 22, preferably restricted to your admin address.
   - HTTP 80 from anywhere.
   - HTTPS 443 from anywhere.
4. Create a DNS **A** record `example.org -> 203.0.113.10`. Add `www` if you want
   it, but the example uses the apex only.
5. Download the Lightsail SSH key and test the first login:

```bash
ssh -i lightsail-key.pem ubuntu@203.0.113.10
```

## 2. Prepare the admin key

The bootstrap disables password SSH and root SSH. Confirm your public key is in
`~/.ssh/authorized_keys` for `ubuntu` before running it. The bootstrap copies
that key to the non-root `ferry` user; test a second session before closing the
first one:

```bash
ssh -i lightsail-key.pem ubuntu@203.0.113.10
```

If you use a different admin key, add it to `~/.ssh/authorized_keys` first and
test it.

## 3. Clone and bootstrap

There is **one clone**, at `/opt/ferry`. You (the `ubuntu` admin user) own it and
run every build and update there directly, with no `sudo -u`. The `ferry` service
user only reads the built files and runs the solver; it never needs a login or a
copy of its own.

```bash
sudo install -d -o ubuntu -g ubuntu /opt/ferry
git clone https://github.com/deyoungjohn/ferry.git /opt/ferry
cd /opt/ferry
sudo ADMIN_IP=203.0.113.10 bash deploy/bootstrap.sh
```

`ADMIN_IP` restricts SSH to that address. Omit it only if you accept SSH from
anywhere. The bootstrap installs Node 22 at the exact `.nvmrc` version, pnpm at
the `packageManager` version, Caddy from its official apt repository, the
directories, the units and the helper scripts. It does not start the solver and
does not read a secret.

## 4. Build the solver and web

Run these as `ubuntu`, in `/opt/ferry`:

```bash
cd /opt/ferry && pnpm install --frozen-lockfile
cd /opt/ferry && for package in @ferry/core @ferry/chain-config @ferry/chain-evm @ferry/solver; do pnpm --filter "$package" build; done
```

Create the production web environment file from the example and fill it in:

```bash
cp /opt/ferry/packages/web/.env.example /opt/ferry/packages/web/.env.production
nano /opt/ferry/packages/web/.env.production
```

The required production values are:

- `VITE_NETWORK=mainnet`
- `VITE_SOLVER_URLS=https://ferry.incepture.dev` for the same-origin solver
- `VITE_REOWN_PROJECT_ID=<your Reown project id>`
- `VITE_MOCK=` (empty; never `1` in production)
- `VITE_PRIOR_REPO_URL` for the banner, plus the optional banner variables in
  `packages/web/.env.example`

Build and publish the single-page app at the domain root:

```bash
cd /opt/ferry && pnpm --filter @ferry/web build
sudo rsync -a --delete /opt/ferry/packages/web/dist/ /var/www/ferry/dist/
sudo chown -R root:root /var/www/ferry/dist
sudo find /var/www/ferry/dist -type d -exec chmod 0755 {} +
sudo find /var/www/ferry/dist -type f -exec chmod 0644 {} +
```

## 5. Install the solver environment

Generate the keys offline as described in `preparation/KEYS.md`. Do not copy the
deployer key to the server. Copy only the solver values into a solver-only file
and keep the deployer key on the offline machine.

### Which file holds these values

Two env files exist, in two places:

| File                           | Where                                                                                                                                                             | Holds                                                  |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `solver.env`                   | Written on **your machine** (outside the repository, for example `~/ferry-solver.env`, `chmod 600`), then copied to `/etc/ferry/solver.env` on the server (below) | Every value in this section, including the solver keys |
| `packages/web/.env.production` | On the server, in the `ferry` user's clone (section 4)                                                                                                            | Only public values for the web build (no keys)         |

The names of every solver variable are listed, without values, in
`packages/solver/.env.example`; where each value comes from is in
`preparation/MAINNET_SOLVER_ENV.md`. Start your local file from this block and
fill in the three `<…>` values yourself:

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
OPERATOR_TOKEN=<at least 32 random characters, for example the output of: openssl rand -hex 32>
```

Where each value comes from:

- **Chain, token and contract values:** public facts, already filled in above.
  The contract address is recorded in `packages/chain-config`; the two category
  IDs are the mainnet PUSD and MUSD token categories (the `TPUSD_`/`TMUSD_`
  names are historical and take the mainnet IDs).
- **`BASE_RPC_URL` / `RPC_URL_BASE`:** your own paid Base endpoint (the
  `RPC_URL_BASE` line of your private env file), or the public
  `https://base-rpc.publicnode.com` as a fallback. Use the same URL for both.
- **The two solver keys:** copy only those two lines from `.env.mainnet.local`
  (made by `keys:generate`). Never copy `DEPLOYER_EVM_PRIVATE_KEY`.
- **`OPERATOR_TOKEN`:** generate it yourself and keep a copy; you need it for the
  operator routes and the emergency stop.
- **`MAX_SWAP_USD_MICROS=1000000`** is the $1 cap for the first swaps.

`TRUSTED_PROXY=true` is correct because Caddy is the only process that can reach
the solver on localhost. `HOST=127.0.0.1` keeps the solver off the public
interface. Do not set `ALLOW_DEV_KEYS` or `ALLOW_MOCK_PAYLINK_SIGNATURES`.

Copy the solver-only file, install it with the right owner and remove the
temporary copy:

```bash
scp -i lightsail-key.pem solver.env ubuntu@203.0.113.10:/tmp/solver.env
ssh -i lightsail-key.pem ubuntu@203.0.113.10 \
  'sudo install -m 0600 -o ferry -g ferry /tmp/solver.env /etc/ferry/solver.env && rm -f /tmp/solver.env'
```

Never paste a key into a shell command, chat, ticket or repository.

## 6. Run the strict preflight

Use the public preflight addresses and the RPC names the preflight reads. Keep
paid RPC values in the environment; do not print them.

```bash
cd /opt/ferry && \
  ENABLED_ROUTES=usdc:base \
  PREFLIGHT_ADDRESSES="deployer=0x...,solver=0x...,bch=bitcoincash:..." \
  pnpm --filter @ferry/chain-config preflight --strict
```

The root `pnpm preflight` alias is not present; the filtered command above is
the supported form in this checkout. A `GO for mainnet launch` line is required
before the first swap.

After the site is live, verify that the public URL really serves the solver API:

```bash
pnpm --dir scripts/preflight preflight -- --url https://ferry.incepture.dev
```

It GETs `/v1/health` and fails with `this URL is not a Ferry solver (it returned
HTML)` when the URL is a static page or any other non-JSON response.

## 7. Set the domain and start services

Replace `example.org` in `/etc/caddy/Caddyfile` with `ferry.incepture.dev`:

```bash
sudo nano /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile
```

Start Caddy first, then the solver, then the timers:

```bash
sudo systemctl daemon-reload
sudo systemctl enable caddy.service
sudo systemctl restart caddy.service
sudo systemctl enable --now ferry-solver.service
sudo systemctl start ferry-backup.timer ferry-health.timer
```

Check the public site and the solver:

```bash
curl -fsS https://ferry.incepture.dev/v1/health
curl -fsS https://ferry.incepture.dev/swap
curl -fsS https://ferry.incepture.dev/
sudo systemctl status ferry-solver.service --no-pager
```

The health timer checks `/v1/health` and `/v1/ready`. The current solver exposes
`/v1/health`; if `/v1/ready` is not present yet, add the readiness route or set
`FERRY_READY_URL=http://127.0.0.1:8787/v1/health` in a systemd drop-in for the
health service until the route lands. The timer prints one line to the journal
when either check fails.

## 8. Update

Take a Lightsail snapshot before every change. Then:

```bash
cd /opt/ferry && git pull --ff-only && pnpm install --frozen-lockfile && for package in @ferry/core @ferry/chain-config @ferry/chain-evm @ferry/solver; do pnpm --filter "$package" build; done
cd /opt/ferry && pnpm --filter @ferry/web build
sudo rsync -a --delete /opt/ferry/packages/web/dist/ /var/www/ferry/dist/
sudo chown -R root:root /var/www/ferry/dist
sudo systemctl restart ferry-solver.service
sudo systemctl reload caddy.service
```

Build before restarting so the restart does not serve a half-written tree. Run
the strict preflight again if the chain configuration or contract addresses
changed.

## 9. Roll back

Preferred: restore the Lightsail snapshot from before the change. If you are
rolling back only the code and have a clean previous commit:

```bash
cd /opt/ferry && git switch --detach <previous-commit> && pnpm install --frozen-lockfile && for package in @ferry/core @ferry/chain-config @ferry/chain-evm @ferry/solver; do pnpm --filter "$package" build; done
cd /opt/ferry && pnpm --filter @ferry/web build
sudo rsync -a --delete /opt/ferry/packages/web/dist/ /var/www/ferry/dist/
sudo systemctl restart ferry-solver.service
sudo systemctl reload caddy.service
```

Do not restore a database backup over a running solver. Stop the solver first if
you need to recover SQLite state, then start it and watch the journal.

## 10. Logs

```bash
sudo journalctl -u ferry-solver -f
sudo journalctl -u ferry-health -n 50 --no-pager
sudo journalctl -u ferry-backup -n 50 --no-pager
sudo tail -f /var/log/caddy/ferry-access.log
```

Caddy access logs are JSON with the client address truncated to a /24 (IPv4) or
/56 (IPv6); `common_log` and `X-Forwarded-For` are removed. Cookies,
`Authorization` and proxy authorization headers are redacted by Caddy.

## 11. Stop quoting in an emergency

`/v1/pause` stops new quotes and leaves the process running. `/v1/kill-switch`
stops the engine; restart the solver to recover it.

```bash
TOKEN="$(sudo sed -n 's/^OPERATOR_TOKEN=//p' /etc/ferry/solver.env)"
curl -fsS -X POST -H "Authorization: Bearer $TOKEN" http://127.0.0.1:8787/v1/pause
unset TOKEN
```

To stop the engine instead:

```bash
TOKEN="$(sudo sed -n 's/^OPERATOR_TOKEN=//p' /etc/ferry/solver.env)"
curl -fsS -X POST -H "Authorization: Bearer $TOKEN" http://127.0.0.1:8787/v1/kill-switch
unset TOKEN
```

The token is read into the shell, never printed. If the solver is compromised,
stop it first, move funds, and rotate the keys as described in
`preparation/KEYS.md`.

## 12. Backups and daily copy hook

`ferry-backup.timer` runs every 15 minutes and keeps the 48 newest
`/var/lib/ferry/backups/solver-*.db` files. The service uses `sqlite3 .backup`,
so it is safe while the solver is running.

A daily copy hook is a documented extension point, not configured by the
bootstrap. To use one, create an executable `/etc/ferry/daily-backup.sh` owned by
`root:ferry` mode `0750`. It receives the newest backup path as its first
argument and runs at most once per UTC day. Put off-instance credentials in the
root-only hook or in a root-only environment file; never in this repository.

## 13. Files installed by the bootstrap

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

## 14. Local checks before a server change

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
