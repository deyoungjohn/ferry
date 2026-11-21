# How Ferry was tested

The landing page shows three testing numbers: **20,000 Foundry fuzz runs**, **1,100+ BCH covenant attacks rejected** and **200 load-run swaps with 0 failures**. This page says how each was produced and how to run it yourself. All three were re-run on 21 November 2026 for these docs, with the results below.

## Foundry fuzz runs

`FerryHTLC.sol` has six property tests that Foundry calls with random inputs, plus an invariant suite that sends random sequences of calls.

| Property                                                           | Runs  |
| ------------------------------------------------------------------ | ----- |
| A claim succeeds only with the matching secret                     | 5,000 |
| A refund is refused before the deadline and allowed at or after it | 5,000 |
| A claim still works after the deadline while the lock is open      | 5,000 |
| A refund is only possible at or after the deadline                 | 5,000 |
| A lock intent cannot be replayed, or replayed on another chain     | 5,000 |
| Only the recipient can release, and release conserves funds        | 5,000 |

That is **30,000 fuzz runs**, all passing; the site claims 20,000 to stay conservative. The invariant suite ran **5,000 runs of 64 calls (320,000 calls)** with no violation of its three invariants: the contract's balance always equals the sum of open locks, each lock resolves at most once, and funds only ever go to the recipient or the sender. All 67 Foundry tests pass, and line coverage of the contract is 98% with every branch covered.

```bash
cd packages/htlc-evm
FOUNDRY_FUZZ_RUNS=5000 FOUNDRY_INVARIANT_RUNS=5000 forge test
```

Foundry's default is 256 runs per fuzz test; the environment variables raise it.

## BCH covenant attacks

A test takes a valid claim and a valid refund of the real covenant and builds every mutation an attacker could try: another recipient, another token category, a smaller or larger token amount, extra inputs or outputs, a higher fee, a wrong or short secret, an early refund, a changed locktime or sequence, and combinations of these. Each mutated transaction is run in the libauth Bitcoin Cash virtual machine, which must reject it.

| Path         | Mutations | Rejected | Harmless variants accepted |
| ------------ | --------- | -------- | -------------------------- |
| claim, PUSD  | 724       | 709      | 15                         |
| refund, PUSD | 658       | 647      | 11                         |
| claim, MUSD  | 724       | 709      | 15                         |
| refund, MUSD | 658       | 647      | 11                         |

That is **1,356 attacks rejected per token**, 2,712 in total. The accepted variants are listed in the test by name: changes that cannot move funds anywhere else: an output value that stays within the fee limit, a different sequence number or (on a claim) locktime, or transaction version 1. Each still pays the right address the exact token amount.

```bash
pnpm --filter @ferry/htlc-bch exec vitest run test/covenant-mutation-claim.test.ts test/covenant-mutation-refund.test.ts
```

## Load run

The load test starts a local EVM chain (Anvil), deploys the real `FerryHTLC`, starts the real solver engine and HTTP server in the same process, and fires **200 concurrent one-dollar swaps**, forward and reverse, from one address. It checks that every swap completes and counts nonce errors, database-lock errors and reservation errors.

Result of the re-run: **200 of 200 completed, 0 failures**, 0 nonce errors, 0 database-lock errors; p50 12.1 s and p95 14.0 s from the start of the burst (all 200 share one signing queue, so this is the queue draining, not the time of one swap).

```bash
FERRY_RUN_LOAD=1 pnpm --filter @ferry/e2e exec vitest run test/load.test.ts
```

> **Note:** The load run uses a local Anvil chain, not a fork of mainnet. Real mainnet state is covered by the separate fork rehearsal below and by the [mainnet record](/docs/mainnet-record).

## Other suites

| Suite            | What it covers                                                                                                               | Result                 | Run with                                        |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------- | ----------------------------------------------- |
| Unit tests       | Every package                                                                                                                | about 1,500 tests pass | `pnpm test:unit`                                |
| Adversarial      | 28 attacks on the solver and relays: replays, tampered intents, griefing, token quirks, timing edges, operator surface       | 28 of 28 pass          | `pnpm --filter @ferry/e2e test`                 |
| End to end       | Full swaps, pay links, send links and recovery with the solver off                                                           | 15 of 15 pass          | `FERRY_RUN_E2E=1 pnpm --filter @ferry/e2e test` |
| Fork rehearsal   | Forward, reverse, refund, pay and send links on forks of Base, Ethereum, Arbitrum and BNB Chain; Arc and Robinhood read-only | pass                   | `pnpm --filter @ferry/e2e rehearse`             |
| Fork matrix      | The contract on a fork of every chain                                                                                        | 7 of 7 pass            | `pnpm --filter @ferry/fork-tests fork`          |
| Property tests   | Pricing and timing math in `@ferry/core` at high run counts                                                                  | pass                   | `pnpm verify:heavy`                             |
| Mutation testing | Timing, pricing and liquidity code mutated to check the tests notice                                                         | run per module         | `pnpm verify:mutation timing`                   |

The adversarial matrix, test by test, is in `docs/THREATS-TESTED.md` in the repository.
