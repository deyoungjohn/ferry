# Live Data Source Soak Report

- **Started:** 2026-11-16T18:56:59.509Z
- **Ended:** 2026-11-16T19:02:02.995Z
- **Duration:** 5.1 minutes (completed)
- **BCH Quorum Hosts:** electron.jochen-hoenicke.de:51004, electroncash.dk:50004, bch.imaginary.cash:50004

## Per-Source Metrics

| Source                  | Host                                                                               | Samples | Success Rate | p50 (ms) | p95 (ms) | Longest Outage (s) | Stale | Last Error                                            |
| ----------------------- | ---------------------------------------------------------------------------------- | ------: | -----------: | -------: | -------: | -----------------: | ----: | ----------------------------------------------------- |
| bch-quorum-tip          | electron.jochen-hoenicke.de:51004, electroncash.dk:50004, bch.imaginary.cash:50004 |      11 |        0.00% |      n/a |      n/a |                301 |     0 | Quorum unhealthy: INSUFFICIENT_SERVERS                |
| evm-tip-base            | base-rpc.publicnode.com                                                            |       5 |      100.00% |      210 |      262 |                  0 |     0 | none                                                  |
| evm-tip-ethereum        | ethereum-rpc.publicnode.com                                                        |       5 |      100.00% |      220 |      238 |                  0 |     0 | none                                                  |
| evm-tip-arbitrum        | arb1.arbitrum.io                                                                   |       5 |      100.00% |      257 |      301 |                  0 |     0 | none                                                  |
| evm-tip-bnb             | bsc-rpc.publicnode.com                                                             |       5 |      100.00% |      222 |      271 |                  0 |     0 | none                                                  |
| bch-fulcrum-history     | electron.jochen-hoenicke.de:51004, electroncash.dk:50004, bch.imaginary.cash:50004 |      11 |        0.00% |      n/a |      n/a |                301 |     0 | All active Electrum servers failed to execute request |
| bch-fulcrum-listunspent | electron.jochen-hoenicke.de:51004, electroncash.dk:50004, bch.imaginary.cash:50004 |      11 |        0.00% |      n/a |      n/a |                301 |     0 | All active Electrum servers failed to execute request |
| bch-usd                 | api.coinbase.com,api.kraken.com                                                    |      11 |      100.00% |      100 |      124 |                  0 |     0 | none                                                  |
| cauldron-pusd           | indexer.cauldron.quest                                                             |      10 |      100.00% |      337 |      377 |                  0 |     0 | none                                                  |
| evm-getlogs-arbitrum    | arb1.arbitrum.io                                                                   |       5 |      100.00% |      156 |      183 |                  0 |     0 | none                                                  |
| evm-getlogs-base        | base-rpc.publicnode.com                                                            |       5 |      100.00% |      169 |      193 |                  0 |     0 | none                                                  |
| evm-getlogs-ethereum    | ethereum-rpc.publicnode.com                                                        |       5 |      100.00% |      742 |      774 |                  0 |     0 | none                                                  |
| evm-getlogs-bnb         | bsc-rpc.publicnode.com                                                             |       5 |      100.00% |      228 |      277 |                  0 |     0 | none                                                  |
| chainlink-arbitrum-usdc | arb1.arbitrum.io                                                                   |       5 |      100.00% |      185 |      220 |                  0 |     0 | none                                                  |
| chainlink-base-usdc     | base-rpc.publicnode.com                                                            |       5 |      100.00% |      187 |      225 |                  0 |     0 | none                                                  |
| cauldron-musd           | indexer.cauldron.quest                                                             |      10 |      100.00% |      350 |      361 |                  0 |     0 | none                                                  |
| chainlink-bnb-usdc      | bsc-rpc.publicnode.com                                                             |       5 |      100.00% |      203 |      246 |                  0 |     0 | none                                                  |
| chainlink-arbitrum-usdt | arb1.arbitrum.io                                                                   |       5 |      100.00% |      178 |      276 |                  0 |     0 | none                                                  |
| chainlink-bnb-usdt      | bsc-rpc.publicnode.com                                                             |       5 |      100.00% |      168 |      248 |                  0 |     0 | none                                                  |
| paryon-pusd             | mainnet-v1.paryonusd.com                                                           |      10 |      100.00% |      146 |      167 |                  0 |     7 | none                                                  |
| chainlink-ethereum-usdc | ethereum-rpc.publicnode.com                                                        |       5 |      100.00% |      192 |      245 |                  0 |     0 | none                                                  |
| chainlink-ethereum-usdt | ethereum-rpc.publicnode.com                                                        |       5 |      100.00% |      173 |      232 |                  0 |     0 | none                                                  |

## Quorum, Peg & Integrity Summary

- **BCH Quorum Lost Ticks:** 11
- **BCH Server >1 Block Behind Ticks:** 0
- **BCH Quorum Tip Range:** n/a .. n/a
- **Max BCH Tip Age:** 0s (max liveness age: 0s)
- **Max EVM Tip Age (across Base/Ethereum/Arbitrum/BNB):** 15s
- **Peg Disagreements (>1% / 10,000 micros):** 10
- **Peg Disagreements (>2% / 20,000 micros):** 0
- **Genesis Mismatches:** BCH quorum connect error: Genesis hash verification failed: 0 valid server(s) remaining out of 3. Mainnet requires at least two independent healthy servers on the correct chain.
- **Tip Regressions / Mismatches:** None

## Least Reliable Source

- **bch-quorum-tip** (`electron.jochen-hoenicke.de:51004, electroncash.dk:50004, bch.imaginary.cash:50004`): 0.00% success, p95=n/a ms, longest outage=301s, last error: `Quorum unhealthy: INSUFFICIENT_SERVERS`

## Recommended Thresholds for `RUNBOOK.md`

- **BCH tip max age:** `7200s` (observed max: 0s)
- **EVM tip max age:** `120s` (observed max: 15s)
- **BCH HTTP price max age:** `300s` (Chainlink feeds use per-feed heartbeat + margin)
- **Quorum / RPC request timeout:** `10000ms` (observed max p95: 774ms)
