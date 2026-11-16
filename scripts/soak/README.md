# Live Data Source Soak (`scripts/soak`)

Read-only soak harness that monitors every live public data source used by Ferry side-by-side without signing or broadcasting any transactions.

## Commands

Run the default 2-hour (120-minute) soak:

```bash
pnpm --filter @ferry/e2e soak:data
```

Or run directly from the repository root with a custom duration:

```bash
node --conditions=ferry-source --import tsx scripts/soak/run.ts --minutes 95
```

Press `Ctrl-C` at any time to stop early; the harness still closes connections cleanly and writes `scripts/soak/REPORT.md` and `scripts/soak/report.json`.

## What It Samples

- **BCH Fulcrum Quorum (every 30s):** Connects `BchQuorumClient` (`mainnet`) to the three recommended public Fulcrum hosts, verifies canonical mainnet genesis, and polls `getQuorumStatus()`, `pingAll()`, `blockchain.scripthash.get_history`, and `blockchain.scripthash.listunspent` (`tokens_only`) for a public PUSD CashAddress.
- **BCH Price Readers (every 30s):** Coinbase/Kraken `BCH/USD`, Cauldron spot `PUSD` & `MUSD`, and Paryon stats `PUSD`.
- **EVM Chainlink Feeds (every 60s):** `USDC/USD` and `USDT/USD` feeds on Base, Ethereum, Arbitrum, and BNB via public endpoints from `@ferry/chain-config`.
- **EVM Tip & `eth_getLogs` (every 60s):** Latest block number/timestamp and a 100-block `eth_getLogs` query on Base, Ethereum, Arbitrum, and BNB.

## Interpretation Guide

- **Success rate & Outages:** Any source below 99% or with outages exceeding your quoting window should have a fallback RPC/provider configured before production.
- **p50 / p95 Latency:** Compare p95 against your solver HTTP and RPC request timeouts.
- **Quorum Lost / >1 Block Behind:** `SPLIT_TIP` (`> 1` block spread) or `< 2` healthy Fulcrum servers pauses quoting on mainnet.
- **Stale Readings & Peg Disagreements:** Compare observed feed ages against `RUNBOOK.md` staleness thresholds and peg tolerance (`1%` warn / `2%` refuse).
