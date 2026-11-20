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

The matrix covers health, quote, relay-lock with permit and approve-plus-lock
tokens, both full swap directions, finality below the confirmation threshold, a
reorged-out lock, EVM and covenant release, release after a claim, and a forward
swap restarted after the user's lock, the solver's BCH lock and the user's BCH
claim. Base, Ethereum, Arbitrum, BNB and Robinhood pass every row.

The two-chain row is `test/two-chain.test.ts`: Base and Arbitrum are forked at
the same time, one engine gets both adapters, and a forward swap runs on each
concurrently. It checks both orders settle and keeps separate order rows.

The wallet/amount row is partial (minimum, maximum, wrong token and wrong chain
pass; insufficient balance/allowance, bad permits and rounding are not written).
The gas row is not run.

Arc is not run. Its USDC can be funded by impersonating a recent holder, but
`lockWithIntent`/`lock` still reverts after funding; that is a tracked bug, not
a pass and not a silent skip.

Use `FERRY_FORK_CHAINS=base,ethereum` to run a subset while iterating. The full
run still uses one fork at a time and stops each one before the next.

The suite is not part of the normal unit run; `FERRY_RUN_FORK=1` is required.
