# Ferry

**A ferry, not a bridge.** Two-way, trust-minimised atomic swaps between stablecoins on EVM chains (USDC first, USDT on some chains) and PUSD / MUSD on Bitcoin Cash. Nothing is wrapped, minted or held by a custodian: each swap is a pair of hash-time-locked contracts that unlock with the same secret, and a solver supplies the liquidity.

Counter chains: Base, Ethereum, BNB Chain, Arbitrum, Robinhood Chain and Arc. On top of the swap: **pay links** (get paid from the chain someone already uses) and **send links** (send dollars to someone who only uses another chain).

> **Status: under construction for BCH BLAZE 2026.** This repository was started on 15 November 2026 and is built during the event. Nothing here has been used with real funds yet.

## Prior work and how this was built

- **Prior work:** [`ferry-testnet`](https://github.com/deyoungjohn/ferry-testnet) is a public testnet implementation built before the event. This repository is a new repository, not a fork of it. It is disclosed as the pre-BLAZE testnet work.
- **Preparation:** the design and the spike results from the testnet work are in [`preparation/`](preparation/).
- **A swarm of AI agents:** this repository is written by a small swarm of AI coding agents (Claude) working in parallel under human direction. The `Co-Authored-By` trailers in the history show it.

## Layout

| Path             | Purpose                                                             |
| ---------------- | ------------------------------------------------------------------- |
| `preparation/`   | The blueprint and spike results (documents only, no product code)   |
| `packages/`      | Product code, one package per module (added as it is built)         |
| `scripts/guard/` | The check that keeps private working material out of the repository |

## Develop

Requires Node 22 and pnpm 9.

```bash
pnpm install
pnpm test:unit      # includes the private-reference check
pnpm check:private  # files and commit messages
```

Never commit keys or environment files. A pre-push hook (`git config core.hooksPath .githooks`) runs format, typecheck, lint and the private-reference check.
