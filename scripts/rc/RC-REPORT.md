# Release-candidate report

Base: `origin/main` after the browser entry and the solver inventory and policy changes were merged, plus the changes in this branch. Clean install, every `dist` folder removed first. Node 22.23.4, 4 CPUs, 15 GB RAM. Foundry 1.8.3 (the version CI pins), solc 0.8.28. Public endpoints were reachable through the sandbox proxy; the BCH Fulcrum hosts (wss) were not.

## 1. Default suite

| Step                             | Result        | Seconds |
| -------------------------------- | ------------- | ------: |
| `pnpm format:check`              | pass          |       3 |
| `pnpm typecheck`                 | pass          |      54 |
| `pnpm lint`                      | pass (cached) |      10 |
| `pnpm test:unit`                 | pass          |      93 |
| `pnpm test` (root, all packages) | pass          |     147 |
| `pnpm check:private`             | pass          |       1 |

Root test totals on this run are in the log of the default suite; the skips are the opt-in suites in section 2.

Foundry: 54 tests pass. Fuzz at 5,000 runs (five fuzz tests) and the invariant suite at 5,000 runs with depth 64 (320,000 calls, 0 reverts) found no counterexample.

## 2. Opt-in suites on the merged code

| Suite                                                                             | Result                                                                                         | Seconds |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------: |
| e2e (`FERRY_RUN_E2E=1`), including the user-wallet flow                           | 15 of 15 pass                                                                                  |      51 |
| adversarial                                                                       | 28 of 28 pass, none marked expected-fail                                                       |      87 |
| mainnet refusals                                                                  | 7 of 7 pass                                                                                    |       2 |
| fork rehearsal on Base, Ethereum, Arbitrum, BNB, plus Arc and Robinhood read-only | 5 of 5 pass                                                                                    |      33 |
| fork matrix (`FERRY_FORK_TESTS=1`, htlc-evm)                                      | 7 of 7 pass                                                                                    |      64 |
| load, 200 concurrent swaps from one address and IP                                | 101 finished, 99 refused by the per-IP reservation cap, 0 nonce, database-lock or other errors |      19 |

Load latency for the 101 swaps that finished, measured from the start of the burst with 50 ms receipt polling on the local chain: p50 11.8 s, p95 14.3 s. All swaps share one signer queue, so latency is the queue draining, not per-swap time. With the viem default polling interval an earlier 200-swap run had not finished after 5 minutes, because each queued transaction waits for one polling tick (see open risks). The solver caps what one IP may hold in active reservations (a fixed constant), so a 200-swap burst from one address is refused for about half of the swaps; the test now requires every swap to finish or be refused for that reason.

Rehearsal scenarios on the fork (every row passed). The user side is built only with the `@ferry/chain-evm/browser` builders, reading the token's permit domain from the configured facts (Circle USDC, version 2) and checking lock state with `getUserLockStatus`. On Base the fork already holds the real deployed contract and the rehearsal reuses it; the other chains deploy through the deployment script.

| Chain    | Contract | Forward lock (gas)                           | Forward claim         | Reverse: solver lock (gas) | Reverse: user claim from wallet (gas) | User refund drill (gas) | Send link | Pay link | Probe dry run |
| -------- | -------- | -------------------------------------------- | --------------------- | -------------------------- | ------------------------------------- | ----------------------- | --------- | -------- | ------------- |
| Base     | existing | permit and intent, relayed (258,146)         | relayed, secret shown | 207,655                    | 61,720                                | 58,382                  | pass      | pass     | pass          |
| Ethereum | deployed | permit and intent, relayed (258,364)         | relayed, secret shown | 207,776                    | 61,809                                | 58,471                  | pass      | pass     | pass          |
| Arbitrum | deployed | permit and intent, relayed (258,134)         | relayed, secret shown | 207,655                    | 61,720                                | 58,382                  | pass      | pass     | pass          |
| BNB      | deployed | wallet approve and lock, no permit (259,489) | relayed, secret shown | 206,013                    | 58,396                                | 55,058                  | pass      | pass     | pass          |

Relay cost against the blueprint fee at the minimum swap size ($1, spread $0.004), from this run's gas and live gas and L1 fee inputs: Base $0.0058, Arbitrum $0.0193, BNB $0.0095, Ethereum $0.104. Only Base is near the spread; Ethereum needs a fixed fee of about $0.10 per swap.

## 3. Scenario table

Covered by the suites above; times are from the rehearsal.

| Scenario                                                                                                                                           | Result  |          Time |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ------------: |
| Forward swap (EVM to BCH), each route chain                                                                                                        | pass    |  0.3 to 0.8 s |
| Reverse swap (BCH to EVM, solver counter-lock and claim)                                                                                           | pass    |  0.3 to 0.5 s |
| Refund drill                                                                                                                                       | pass    |  0.4 to 0.7 s |
| Pay link                                                                                                                                           | pass    |   under 20 ms |
| Send link (lock and claim)                                                                                                                         | pass    |  0.4 to 4.4 s |
| Recovery from file with the solver off (e2e)                                                                                                       | pass    |  in e2e suite |
| Kill switch then restart, quoting stays paused (solver unit tests)                                                                                 | pass    | in unit suite |
| Each mainnet refusal (7 cases)                                                                                                                     | pass    |     3 s total |
| Not run here: send link 24 h versus 7 d window on a fork, USDT routes with real tokens beyond the rehearsal, BCH-side swaps against a live Fulcrum | not run |             - |

## 4. Flake count

On the earlier base, `pnpm test:unit` was run 15 times while three busy loops kept the CPUs saturated (30 to 72 s per run). All 15 runs passed; no test failed even once.

## 5. Coverage (vitest, lines; Foundry for the contract)

| Package                                |                      Lines | Lowest files                                                       |
| -------------------------------------- | -------------------------: | ------------------------------------------------------------------ |
| core                                   |                      95.6% | cashaddr 86.9%                                                     |
| bch-prices                             |                      90.3% | inventory 85%                                                      |
| chain-evm                              |                      88.1% | l2-cost 82.9%, adapter 83.1%                                       |
| probe                                  |                      87.2% | runner 83.2%                                                       |
| solver-client                          |                      91.4% | multi 80.6%                                                        |
| htlc-bch                               |                      86.3% | electrum 75.6%                                                     |
| recover-cli                            |                      81.1% | cli 76.2%                                                          |
| evm-prices                             |                      74.2% | chainlink 71.2%                                                    |
| solver                                 |                      74.0% | paylink/link 37.0%, bch/lock-builder 37.5%, api/rate-limiter 39.5% |
| web                                    |                      68.1% | lib/solver/real 0%                                                 |
| chain-config                           |                      60.8% | evm-read 5.6%, preflight 24.1%, record-deployment 40.8%            |
| htlc-evm scripts                       |                      57.7% | deploy 56.5%, verify-commands 56.3%                                |
| FerryHTLC.sol (forge, minimum-IR mode) | 98.1% lines, 100% branches | -                                                                  |

## 6. Read-only data soak (price and EVM sources, 32 minutes, 11:38 to 12:10 UTC)

Run with `--no-fulcrum` because wss is blocked in this sandbox; the BCH quorum was not exercised.

| Source group                                                   | Samples each | Success | p50 / p95 latency               | Longest outage |
| -------------------------------------------------------------- | -----------: | ------: | ------------------------------- | -------------: |
| Chainlink USDC and USDT feeds on Base, Ethereum, Arbitrum, BNB |           32 |    100% | 108 to 127 ms / 146 to 219 ms   |            0 s |
| EVM tip, four chains                                           |           32 |    100% | 435 to 717 ms / 612 to 1,027 ms |            0 s |
| `eth_getLogs` over 100 blocks, four chains                     |           32 |    100% | 89 to 698 ms / 136 to 833 ms    |            0 s |
| BCH/USD (Coinbase and Kraken)                                  |           64 |    100% | 368 / 491 ms                    |            0 s |
| Cauldron PUSD and MUSD                                         |           64 |    100% | 625 to 646 / 687 to 708 ms      |            0 s |
| Paryon PUSD                                                    |           64 |    100% | 616 / 673 ms                    |            0 s |

Findings:

- Slowest source: the Base public RPC tip read (p95 1,027 ms); still far inside a 10 s timeout. Maximum EVM tip age observed: 11 s.
- **Paryon readings were flagged stale in 54 of 64 samples**, and **Paryon and Cauldron PUSD prices disagreed by more than 1% in all 64 samples** (none above 2%). Either the Paryon timestamp is not refreshed as often as the 30 s sampling, or the two sources differ by a steady margin. The peg guard policy decides whether quoting pauses at 1%; this should be understood before funding the solver (owner: bch-prices and solver).
- Suggested thresholds were unchanged: EVM tip age 120 s, request timeout 10 s.

## 7. Open risks, by launch impact

1. **Per-IP reservation cap is a fixed constant in the solver** (owner: solver). Real users behind one address or one proxy share it, and a burst of about 100 one-dollar swaps from one IP exhausts it for the quote lifetime. Make it configurable and say in the runbook what it is.
2. **Throughput per signer is bounded by the receipt polling interval.** Each transaction in the signer queue waits for a receipt; with the default poll, 200 queued transactions did not finish in 5 minutes on the local chain. The solver should set a short polling interval on its public client.
3. **Paryon staleness and Paryon versus Cauldron disagreement** (owners: bch-prices and solver): Paryon readings were stale in 54 of 64 soak samples and the two PUSD prices differed by more than 1% in all of them (never above 2%). Decide whether the peg guard's 1% rule would have paused quoting during that window.
4. **The deploy script prints no deploy block on `already-deployed`.** Keep the block printed by the broadcast run.
5. Low unit coverage in `chain-config` preflight and RPC reading, and in the solver's pay-link and BCH lock builder (section 5); the rehearsal covers some of it.
6. Not exercised in this sandbox: the BCH Fulcrum quorum (wss is blocked), a full process restart of the solver after the kill switch, and real mainnet swaps.

Closed since the first run: the deployment recorder now masks the immutable slots and accepts the real Base deployment; the deploy and verify scripts resolve workspace packages from source.
