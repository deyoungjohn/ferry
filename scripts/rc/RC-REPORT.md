# Release-candidate report (in progress)

Base: `origin/main` at 8edd06e. Clean install, every `dist` folder removed first. Node 22.23.4, 4 CPUs, 15 GB. Foundry 1.5.1, solc 0.8.28.

## 1. Default suite

| Step | Result | Seconds |
| --- | --- | --- |
| `pnpm format:check` | pass | 2 |
| `pnpm typecheck` | pass | 65 |
| `pnpm lint` | pass (cached) | 7 |
| `pnpm test:unit` | pass | 22 |
| `pnpm test` (root, all packages) | pass | 57 |
| `pnpm check:private` | pass | 1 |

Root test totals (passed / skipped): htlc-bch 37/1, chain-config 121/0, evm-prices 15/1, htlc-evm 7/7, recover-cli 3/0, chain-evm 32/1, probe 14/1, solver 205/5, web 166/0, e2e 35/17. The skips are the opt-in suites, run in section 2.

Setup note: in this sandbox the forge-std GitHub tarball host is blocked, so the contract package dependencies were placed by hand; this does not affect the results.

## Remaining (not yet run)

Opt-in suites (e2e, adversarial, rehearsal, load), fuzz at 5,000 runs, coverage, scenario table, 15x flake run, open risks.
