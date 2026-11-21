# Running Ferry

Everything needed to build, test and run Ferry is in the repository.

## Build and test

Requires Node 22 and pnpm 9, plus Foundry for the Solidity tests.

```bash
pnpm install
pnpm format:check && pnpm typecheck && pnpm lint
pnpm test:unit
pnpm check:private
```

Run the web app against mocks, with no solver or wallet:

```bash
VITE_NETWORK=testnet VITE_MOCK=1 pnpm --filter @ferry/web dev
```

## The website

One single-page app at the root of the domain; the server proxies `/v1/*` to the solver.

| Path                                   | Page                                                 |
| -------------------------------------- | ---------------------------------------------------- |
| `/`                                    | Landing page                                         |
| `/features`, `/how-it-works`, `/stats` | About Ferry                                          |
| `/docs`                                | These docs                                           |
| `/app/swap`                            | Swap                                                 |
| `/app/pay-link`                        | Pay links and send links                             |
| `/app/my-activity`                     | Your swaps                                           |
| `/app/recover`                         | Recovery                                             |
| `/pay/:id`, `/send/:id`                | A pay link or send link, as the other person sees it |
| `/status`                              | Route status                                         |
| `/recover.html`                        | Standalone recovery page                             |

## Deploying

`deploy/` holds a Caddy config (TLS, security headers, content policy, the `/v1` proxy), systemd units for the solver, a bootstrap script and `deploy/ferry-ops.sh`, which updates, checks and backs up a server:

```bash
deploy/ferry-ops.sh update -y
deploy/ferry-ops.sh status
```

## The pairing relay

`deploy/ferry-ops.sh relay install` runs a pinned `nostr-rs-relay` container for WizardConnect behind Caddy at `relay.<domain>`. Point `VITE_WIZARD_RELAY_URLS` at it and rebuild. The app probes it before each pairing and falls back to the public relays if it does not answer, so it can be stopped at any time. Details: `deploy/README.md`.
