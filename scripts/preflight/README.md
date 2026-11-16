# Preflight

Read-only checks for mainnet funding and route readiness. Nothing here sends a
transaction.

```bash
pnpm --dir scripts/preflight preflight
# or
pnpm --filter @ferry/chain-config preflight
```

The root `pnpm preflight` alias is not added because the root workspace files are
owned by the maintainers. Add this line to the root `package.json` scripts if you
want the short form:

```json
"preflight": "pnpm --dir scripts/preflight preflight"
```

## Environment

Set values in `.env.local` (gitignored). The names are listed in `.env.example`.

- `RPC_URL_<CHAIN>`: optional comma-separated paid RPC URLs for `BASE`,
  `ETHEREUM`, `ARBITRUM`, `ARC`, `BNB` and `ROBINHOOD`. They are placed before the
  public URLs for the selected `FERRY_NETWORK`. The value is never printed; only
  the host name appears in output.
- `PREFLIGHT_ADDRESSES`: comma-separated solver EVM address and BCH CashAddr.
- `BCH_ELECTRUM_URLS` / `BCH_CHIPNET_ELECTRUM_URLS`: two Fulcrum hosts.
- `BCH_GENESIS_HASH`: expected genesis hash.
- `PUSD_CATEGORY` / `MUSD_CATEGORY`: CashToken categories.

`ENABLED_ROUTES` and `FERRY_NETWORK` use the same values as `@ferry/chain-config`.

## Watch

```bash
pnpm --dir scripts/preflight watch-chains
# or
pnpm --filter @ferry/chain-config watch-chains
```

It checks whether Circle or Tether now list a contract for Arc or Robinhood Chain,
and whether a public log-capable RPC exists. It never enables a route.
