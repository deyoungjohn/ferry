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
approve-plus-lock tokens, both full swap directions, and the minimum, maximum,
wrong-chain and wrong-token refusals. Base, Ethereum, Arbitrum, BNB and Robinhood
pass every row on the live forks.

The Base full-swap stall was a harness gap, not an engine bug: the real EVM port
had no adapter registered for the order's chain id, so the engine could not read
the user's lock. Registering the chain id and the deployment block fixed it.

Arc is funded by impersonating a recent USDC holder found in a 10-block log
window, because its USDC does not use the ordinary ERC-20 balance slot. The
funding succeeds and the refusal rows pass, but the lock call still reverts; the
Arc full-swap rows are reported as failures until that is traced.

The following still require a manual or harness extension pass: finality/reorg
boundaries, two chains with the same lock id, quote and deadline timing, solver
inventory and gas refusals, bad permits, wallet reverts, crash/restart at every
step, keeper refunds and early release, wrong/late/non-recipient claims,
18-decimal and rounding cases, and gas spikes/replacements/nonce gaps.

Use `FERRY_FORK_CHAINS=base,ethereum` to run a subset while iterating. The full
run still uses one fork at a time and stops each one before the next.

The suite is not part of the normal unit run; `FERRY_RUN_FORK=1` is required.
