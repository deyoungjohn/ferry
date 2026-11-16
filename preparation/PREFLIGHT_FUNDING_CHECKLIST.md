# Mainnet funding checklist (Minimum tier)

This is the human checklist for the Minimum inventory tier in blueprint §21.
Run the read-only preflight first and use its exact addresses. The preflight
prints the gaps; this page is the order to fund them in. No private key, WIF,
mnemonic or `.env.local` value belongs on this page.

## Before funding

- [ ] Confirm the solver EVM address and the solver BCH CashAddr, and put both
      in `PREFLIGHT_ADDRESSES` in `.env.local`.
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

### Bitcoin Cash

- [ ] Fund PUSD to the solver BCH address: **15 PUSD**.
- [ ] Fund MUSD to the solver BCH address: **5 MUSD** (or skip MUSD and accept
      that the MUSD route is not demonstrated).
- [ ] Fund BCH for fees and carry: **0.005 BCH**.
- [ ] Fund the solver BCH address shown by the preflight. The same address holds
      PUSD, MUSD and the BCH fee balance.

### Base

- [ ] Fund USDC to the solver EVM address on Base: **15 USDC**.
- [ ] Fund ETH on Base for relay gas: **about 2 USD** at current prices.
- [ ] Fund the solver EVM address shown by the preflight.

### Other enabled EVM chains

For each extra enabled route (Ethereum, Arbitrum One, Arc, BNB Chain, and
Robinhood Chain only if it ever becomes enabled):

- [ ] Fund about **10 USD of the route's stablecoin** on that chain to the
      solver EVM address.
- [ ] Fund a few dollars of native gas, more on Ethereum. Arc pays gas in USDC;
      its gas balance and its ERC-20 stablecoin balance are not the same unit.
- [ ] Use the exact chain and token from the preflight table; do not send a token
      to the wrong network.

### USDT routes

- [ ] Ethereum USDT: the route needs a one-time approval from the user, but the
      solver still needs ETH for relay gas.
- [ ] Arbitrum USDT0: permit is available; the solver still needs ETH for gas.
- [ ] BNB Chain USDT is Binance-Peg BSC-USD with 18 decimals. It is off by
      default; enable it only after the disclosure is accepted.

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
