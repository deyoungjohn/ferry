# Supply-chain review

Production dependency audit and licence summary. Re-run with `pnpm audit --prod` and `pnpm licenses list --prod`.

## Pins

`scripts/verify/supply-chain.test.mjs` runs with the default unit tests and fails when any tracked `package.json` uses a range (`^`, `~`, `*`, `latest`, `>=`, partial versions) or an unpinned git reference. One git dependency is allowed: the Solidity test library `forge-std`, pinned to a release tag (the lockfile records the commit).

## Audit (production dependencies)

16 advisories: 1 critical, 10 high, 4 moderate, 1 low (sum of the groups below; one package can carry several).

| Package                     | Reached through                                                                          | Severity             | Decision                                                                                                                                                                                                                                    |
| --------------------------- | ---------------------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tar` 6.2.1 (11 advisories) | the headless probe, through the cash-wallet engine, a browser-storage shim and `sqlite3` | critical to moderate | Accepted for now. `tar` is only used by the native build step of `sqlite3` at install time, never at runtime, and nothing in Ferry extracts untrusted archives. Fix needs an upstream release of the wallet engine; tracked as a follow-up. |
| `@tootallnate/once` 1.1.2   | same chain, through `node-gyp`                                                           | low                  | Accepted: install-time build tooling only.                                                                                                                                                                                                  |
| `minimatch` 10.2.6          | the wallet engine's static file server                                                   | moderate             | Accepted: dev-time helper, patterns are not attacker controlled.                                                                                                                                                                            |
| `zod` 3.25.76               | the browser wallet kit, through `viem`                                                   | high                 | Accepted: this copy is only a transitive helper of the wallet kit; every Ferry package pins `zod` 4.6.7, which is past the fixed version. Revisit when the wallet kit updates.                                                              |

No finding is in code that runs in the solver or in the contracts' build.

## Licences (production dependencies, 535 packages)

MIT 412, ISC 58, BSD-3-Clause 15, Apache-2.0 13, BSD-2-Clause 4, BlueOak-1.0.0 4, and about a dozen dual or single-use permissive licences (WTFPL, Unlicense, 0BSD, CC0 and MIT combinations). Two font packages are OFL-1.1 (fonts only, redistributable). 18 packages report `Unknown`: all are the wallet-connection kit (`@reown/*`, `@walletconnect/*`, `@wizardconnect/*`), which publish a licence in the repository but not in the package manifest. Follow-up: confirm the licence text of each before the final release.
