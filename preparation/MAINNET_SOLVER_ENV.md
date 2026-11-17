# Mainnet solver environment (dress rehearsal)

This is the variable list for the first small mainnet swaps. It names where each
value comes from; it never contains a key, WIF, token or paid URL. The solver
reads these names in `packages/solver/src/config.ts`.

Legend: **chain-config** = `@ferry/chain-config` or its deployment record;
**human** = the maintainer supplies the secret or chooses the policy value;
**server** = host/runtime value.

## Solver core

| Variable | Purpose | Source |
|---|---|---|
| `NETWORK` | Set to `mainnet` | human |
| `BCH_ELECTRUM_URLS` | Two or three mainnet Fulcrum hosts | server survey in `FACTS.md`; the 90-minute soak kept the three-host set (Germany, Denmark, US) |
| `BASE_RPC_URL` | Base JSON-RPC endpoint | chain-config public URL, or human for a paid override; add a second URL because the soak saw brief Base/Arbitrum fetch failures |
| `BASE_CHAIN_ID` | `8453` | chain-config |
| `BASE_FERRY_HTLC_ADDRESS` | Deployed FerryHTLC on Base | chain-config after `record-deployment` |
| `BASE_USDC_ADDRESS` | Circle USDC on Base | chain-config |
| `SOLVER_EVM_PRIVATE_KEY` | Solver hot EVM key | human (secret) |
| `SOLVER_BCH_WIF` | Solver hot BCH key | human (secret) |
| `OPERATOR_TOKEN` | Bearer token for operator routes, at least 32 chars | human (secret) |
| `DATABASE_PATH` or `DATABASE_URL` | Solver state database | server |
| `PORT` / `HOST` | Solver listener | server |
| `TRUSTED_PROXY` | Set only behind a trusted reverse proxy | server |

## Pricing, caps and timing

These are policy values. Start from the blueprint defaults and change only with
a reviewed decision.

| Variable | Purpose | Source |
|---|---|---|
| `SPREAD_BPS` | Quote spread | human (blueprint default) |
| `FIXED_FEE_USD_MICROS` | Fixed fee in USD micros | human |
| `MIN_SWAP_USD_MICROS` / `MAX_SWAP_USD_MICROS` | Swap size floor and cap | human |
| `MAX_EXPOSURE_USD_MICROS` | Open exposure cap | human |
| `ZERO_CONF_MAX_USD_MICROS` | Fast-lane zero-conf cap | human |
| `QUOTE_TTL_SECONDS` | Quote validity | human |
| `EVM_CONFS` | Fast-lane EVM confirmations | human |
| `FWD_BCH_REFUND_BLOCKS` / `FWD_EVM_DEADLINE_SECONDS` | Forward timelock | human (blueprint default) |
| `REV_BCH_REFUND_BLOCKS` / `REV_EVM_DEADLINE_SECONDS` | Reverse timelock | human (blueprint default) |
| `BCH_CARRY_SATS` / `BCH_MAX_FEE_SATS` | BCH fee policy | human |
| `SKEW_MAX_BPS` | Inventory skew limit | human |
| `DSPROOF_WINDOW_MS` / `DOUBLE_SPEND_WAIT_MS` | Double-spend wait | human |
| `TIP_MAX_AGE_BCH_SECONDS` / `TIP_MAX_AGE_BASE_SECONDS` | Tip freshness limits | human; soak recommends `7200` / `120` (observed maxima `1354s` / `13s`) |
| `QUOTING_ENABLED` | Quote switch | human |
| `RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX_PER_ADDRESS` / `RATE_LIMIT_MAX_PER_IP` | API rate limits | human or server |
| `TPUSD_CATEGORY` / `TMUSD_CATEGORY` | BCH token categories the solver uses | chain-config / blueprint: set to the mainnet PUSD and MUSD categories despite the historical variable names |
| `ALLOW_MOCK_PAYLINK_SIGNATURES` | Must be unset or false on mainnet | human |
| `ALLOW_DEV_KEYS` / `FERRY_ALLOW_DEV_KEYS` | Must be unset on mainnet; the solver refuses dev keys | human |

## Preflight and chain configuration only

These are not solver variables, but the launch checks use them.

| Variable | Purpose | Source |
|---|---|---|
| `FERRY_NETWORK` | Select mainnet for chain-config/preflight | human |
| `ENABLED_ROUTES` | Enabled route keys, for example `usdc:base` | human |
| `RPC_URL_<CHAIN>` | Optional paid RPC overrides; comma list, host-only logs | human |
| `PREFLIGHT_ADDRESSES` | `deployer=0x...`, `solver=0x...`, `bch=bitcoincash:...` | human |
| `BCH_ELECTRUM_URLS` | Fulcrum hosts used by preflight | server survey |
| `BCH_GENESIS_HASH` | `000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f` | chain fact |
| `PUSD_CATEGORY` / `MUSD_CATEGORY` | Preflight token categories | chain-config / blueprint |
| `BCH_CHIPNET_ELECTRUM_URLS` | Not used on mainnet | human |

## Soak observations (2026-11-17)

The 90-minute read-only soak used the three recommended public BCH hosts and
paid RPC overrides where available. Keep the three-host BCH set; no host dropped
out, no genesis mismatch and no tip regression was seen. One quorum tick and a
31 s outage are within the recommended `TIP_MAX_AGE_BCH_SECONDS=7200` and
`TIP_MAX_AGE_BASE_SECONDS=120` headroom.

The Base and Arbitrum primary RPC hosts showed brief fetch failures (95.56% and
97.78% success, 63 s longest outage). Add a second URL to the comma list for
those chains. Ethereum and BNB stayed at 100%.

The BCH price path did not complete in this environment: Coinbase and Kraken DNS
failed, so `bch-usd` and the Cauldron PUSD/MUSD readers were at 0%; Paryon
answered but its readings were stale for most samples. That is an owner issue in
`packages/bch-prices` and the environment, not a server-list fix. No peg
disagreement conclusion can be drawn from this run. The quorum request target is
about `17s` (observed maximum p95 `5.7s` times three), but the solver has no
dedicated environment variable for it today.

## Launch order

1. Deploy Base FerryHTLC with the human's deployer key.
2. Run the deployment recorder with the chain, address and block; it writes only
   `htlcAddress` and `deployBlock` for mainnet after checking the CREATE2
   prediction, runtime code hash and deployment block.
3. Fill the solver variables above from chain-config, the human's secrets and the
   server.
4. Run the preflight with the three disposable addresses and `--strict`; it must
   print `GO for mainnet launch` before the first swap.
5. Start with one small swap at a time and keep the caps at the Minimum tier.

Never put a private key, WIF, operator token or paid RPC URL in this file or in
the repository.
