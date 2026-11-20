# Fork edge-case matrix

Opt-in tests that fork one live chain at a time with `anvil --fork-url`, deploy the
Ferry HTLC and use the real solver engine against the simulated Bitcoin Cash
chain. Nothing is broadcast on a real network and no funded key is used.

Set only the public/paid RPC environment names before running:

```bash
export RPC_URL_BASE=...
export RPC_URL_ETHEREUM=...
export RPC_URL_ARBITRUM=...
export RPC_URL_BNB=...
export RPC_URL_ARC=...
export RPC_URL_ROBINHOOD=...
pnpm --filter @ferry/fork-tests fork
```

The runner uses one fork at a time, starts a fresh anvil per chain, funds throwaway
test accounts with `anvil_setBalance`, sets token balances on the fork, and stops
the fork before moving to the next chain. Missing RPC names are reported as
skipped chains, not as failures.

The current matrix covers health, quote, relay-lock with permit and
approve-plus-lock tokens, and the minimum, maximum, wrong-chain and wrong-token
refusals. Base, Ethereum, Arbitrum, BNB and Robinhood pass on the live forks. Arc
is skipped because its USDC token does not expose a discoverable ERC-20 balance
storage slot; use the manual checklist for it.

The following still require a manual or harness extension pass: full BCH claim
and refund flows, finality/reorg boundaries, quote and deadline timing, solver
inventory and gas refusals, bad permits, wallet reverts, crash/restart at every
step, keeper refunds and early release, wrong/late/non-recipient claims,
18-decimal and rounding cases, and gas spikes/replacements/nonce gaps.

The suite is not part of the normal unit run; `FERRY_RUN_FORK=1` is required.
