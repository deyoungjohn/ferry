# Preflight

Read-only checks for mainnet funding and route readiness. Nothing here sends a
transaction.

```bash
pnpm --dir scripts/preflight preflight
# or
pnpm --filter @ferry/chain-config preflight
# strict launch gate
pnpm --filter @ferry/chain-config preflight --strict
```

The root `pnpm preflight` alias is not added because the root workspace files are
owned by the maintainers. Add this line to the root `package.json` scripts if you
want the short form:

```json
"preflight": "pnpm --dir scripts/preflight preflight"
```

## Public URL check

```bash
pnpm --dir scripts/preflight preflight -- --url https://example.org
```

It GETs `/v1/health` and fails when the response is not JSON, including when a
landing page returns HTML. The production layout is `/` for the landing page,
`/swap/` for the app and `/v1/*` for the solver.

## Environment

Values live in `.env.local` (gitignored). The scripts do **not** auto-load that
file because it also holds keys. Export only the `RPC_URL_*` lines:

```bash
while IFS= read -r line; do
  case "$line" in RPC_URL_*=*) export "$line" ;; esac
done < ../.env.local
```

Never `cat`, copy or print the file. The names are listed in `.env.example`.

- `RPC_URL_<CHAIN>`: optional comma-separated paid RPC URLs for `BASE`,
  `ETHEREUM`, `ARBITRUM`, `ARC`, `BNB` and `ROBINHOOD`. They are placed before the
  public URLs for the selected `FERRY_NETWORK`. The value is never printed; only
  the host name appears in output.
- `PREFLIGHT_ADDRESSES`: comma-separated addresses. Labels are
  `deployer=0x...`, `solver=0x...` and `bch=bitcoincash:...`; unlabelled EVM and
  BCH addresses are also accepted.
- `BCH_ELECTRUM_URLS` / `BCH_CHIPNET_ELECTRUM_URLS`: two Fulcrum hosts.
- `BCH_GENESIS_HASH`: expected genesis hash.
- `PUSD_CATEGORY` / `MUSD_CATEGORY`: CashToken categories.

`ENABLED_ROUTES` and `FERRY_NETWORK` use the same values as `@ferry/chain-config`.

## Measure and funding

```bash
pnpm --dir scripts/preflight measure-rpc
pnpm --dir scripts/preflight deploy-funding
```

`measure-rpc` prints host-only cap, latency, burst and block-tag results.
`deploy-funding` prints the native gas for the deployment and Minimum-tier
relays at the current paid-endpoint gas price.

## BCH servers

```bash
pnpm --dir scripts/preflight bch-servers
```

Read-only survey of public BCH mainnet Fulcrum servers: reachability, genesis,
tip, latency, `dsproof.get`, token UTXOs, and operator/country notes. It never
broadcasts.

## Watch

```bash
pnpm --dir scripts/preflight watch-chains
# or
pnpm --filter @ferry/chain-config watch-chains
```

It checks whether Circle or Tether now list a contract for Arc or Robinhood Chain,
and whether a public log-capable RPC exists. It never enables a route.
