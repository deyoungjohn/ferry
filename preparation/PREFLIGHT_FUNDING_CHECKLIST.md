# Mainnet funding checklist (Minimum tier)

This is the human checklist for the Minimum inventory tier in blueprint §21.
Run the read-only preflight first and use its exact addresses. The preflight
prints the gaps; this page is the order to fund them in. No private key, WIF,
mnemonic or `.env.local` value belongs on this page.

## Before funding

- [ ] Confirm the deployer EVM address, the solver EVM address and the solver
      BCH CashAddr, and put all three in `PREFLIGHT_ADDRESSES` in `.env.local`.
- [ ] Confirm the enabled routes with `ENABLED_ROUTES` and the network with
      `FERRY_NETWORK`.
- [ ] Run the preflight and keep its table:

  ```bash
  pnpm --dir scripts/preflight preflight
  ```

- [ ] Complete the testnet work first. Mainnet funding and any mainnet
      transaction need explicit human approval.

## Minimum tier

The Minimum tier is for mainnet acceptance runs and the demo recording, one
swap at a time: `MAX_SWAP_USD` 5 and `MAX_OPEN_EXPOSURE_USD` 10. The amounts
below come from blueprint §21; do not scale them up without a separate decision.

### Measured deploy and relay gas (2026-11-16)

These are native gas amounts, read from the paid endpoints on 2026-11-16. The
relay estimate is 700,000 gas per chain for two Minimum-tier swaps plus one
refund drill, with the 20% safety margin used by `estimateDeployFunding()`.
Deploy gas is the measured shared-contract deployment estimate; Ethereum uses
the higher Prague-priced measurement. Gas prices change, so re-run before
funding. Fund the deploy amount to the deployer EVM address and the relay amount
to the solver EVM address; the total is the sum if one address holds both.

| Chain | Native | Gas price | Deploy gas | Deploy amount | Relay amount | Total to hold |
|---|---|---:|---:|---:|---:|---:|
| Base | ETH | 0.0060 gwei | 804,543 | 0.000006 ETH | 0.000005 ETH | 0.000011 ETH |
| Ethereum | ETH | 0.2107 gwei | 5,520,829 | 0.001396 ETH | 0.000177 ETH | 0.001573 ETH |
| Arbitrum One | ETH | 0.0200 gwei | 804,543 | 0.000019 ETH | 0.000017 ETH | 0.000036 ETH |
| Arc | USDC | 25.7500 gwei | 789,951 | 0.024409 USDC | 0.021630 USDC | 0.046039 USDC |
| BNB Chain | BNB | 0.0500 gwei | 804,543 | 0.000048 BNB | 0.000042 BNB | 0.000090 BNB |
| Robinhood Chain | ETH | 0.0200 gwei | 804,543 | 0.000019 ETH | 0.000017 ETH | 0.000036 ETH |

Robinhood Chain remains skipped because it has no issuer-documented USDC or
USDT token, even though the endpoint is reachable. The BNB and Robinhood deploy
gas rows use the shared-contract estimate because those chains have no measured
deployment of the current bytecode yet.

### Bitcoin Cash

- [ ] Fund PUSD to the solver BCH address: **15 PUSD**.
- [ ] Fund MUSD to the solver BCH address: **5 MUSD** (or skip MUSD and accept
      that the MUSD route is not demonstrated).
- [ ] Fund BCH for fees and carry: **0.001 BCH (the maintainer lowered the starting floor from the blueprint minimum of 0.005 BCH; at 3,000 sats of carry per forward swap this covers about 30 swaps)**.
- [ ] Fund the solver BCH address shown by the preflight. The same address holds
      PUSD, MUSD and the BCH fee balance.

### Base

- [ ] Fund USDC to the solver EVM address on Base: **15 USDC**.
- [ ] Fund the deploy ETH amount to the deployer EVM address and the relay ETH
      amount to the solver EVM address; about 2 USD of relay gas is the
      blueprint's rule of thumb.
- [ ] Fund USDC to the solver EVM address shown by the preflight.

### Other enabled EVM chains

For each extra enabled route (Ethereum, Arbitrum One, Arc, BNB Chain, and
Robinhood Chain only if it ever becomes enabled):

- [ ] Fund about **10 USD of the route's stablecoin** on that chain to the
      solver EVM address.
- [ ] Fund the deploy native gas to the deployer EVM address and the relay
      native gas to the solver EVM address. Arc pays gas in USDC; its gas
      balance and its ERC-20 stablecoin balance are not the same unit.
- [ ] Use the exact chain and token from the preflight table; do not send a token
      to the wrong network.

### USDT routes

- [ ] Ethereum USDT: the route needs a one-time approval from the user, but the
      solver still needs ETH for relay gas.
- [ ] Arbitrum USDT0: permit is available; the solver still needs ETH for gas.
- [ ] BNB Chain USDT is Binance-Peg BSC-USD with 18 decimals. It is off by
      default; enable it only after the disclosure is accepted.

## RPC redundancy and log reads

- Arbitrum: the paid endpoint dropped 4 of 20 burst calls in the 2026-11-16
  measurement, so keep a second endpoint configured and let the solver retry
  with backoff. The data already lists `arb1.arbitrum.io` and
  `arbitrum.gateway.tenderly.co`.
- Arc: use the chain's public endpoint, or the Blockdaemon endpoint with the
  100,000-block cap, for history. The paid Alchemy endpoint is tip-only at 10
  blocks.
- Robinhood Chain: use the chain's public endpoint for history; the paid Alchemy
  endpoint is tip-only at 10 blocks. The route remains skipped until a canonical
  token exists.
- Activity reads require at least 1,000 blocks per `eth_getLogs`; a route with
  only tiny endpoints fails closed in the preflight instead of scanning forever.

## Next actions and commands

The preflight prints a `Next actions` line per route (`DEPLOY`, `FUND`, `VERIFY`,
`ENABLE` or `SKIP`). Use the three disposable addresses in `PREFLIGHT_ADDRESSES`
as labels:

```bash
# Load only the RPC_URL_* lines; never cat, copy or print .env.local.
while IFS= read -r line; do
  case "$line" in RPC_URL_*=*) export "$line" ;; esac
done < ../.env.local

ENABLED_ROUTES=usdc:base,usdc:ethereum,usdt:ethereum,usdc:arbitrum,usdt:arbitrum,usdc:arc,usdt:bnb \
PREFLIGHT_ADDRESSES=deployer=0x...,solver=0x...,bch=bitcoincash:... \
pnpm --filter @ferry/chain-config preflight

# Measured paid-endpoint caps, latency, burst and tag support.
pnpm --filter @ferry/chain-config measure-rpc

# Deploy and relay native gas at the current gas price.
pnpm --dir scripts/preflight deploy-funding
```

`PREFLIGHT_ADDRESSES` accepts unlabelled EVM/BCH addresses too; labels make the
deployer, solver and BCH roles explicit.

## After funding

- [ ] Run the preflight again. Every enabled route should show the RPC, factory,
      token and feed checks, and only the expected "HTLC not deployed" status
      until the reviewed deployment lands.
- [ ] Confirm the Minimum-tier gaps are empty. If a balance is short, fund the
      address and asset printed in the checklist output.
- [ ] Re-run the preflight before the first mainnet swap and again after any
      rebalance.

The preflight reads the Chainlink feed freshness, the token facts and the
Route's HTLC/factory code. It never sends a transaction and never prints a paid
RPC URL or path; only the host name appears.
