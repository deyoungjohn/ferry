# The solver

The solver is the other side of every swap. It is a Node daemon with a SQLite database, run by an operator who supplies liquidity on both sides.

## What it does

1. **Quotes.** Prices the swap from live references, applies the spread and route fee, checks limits and liquidity, sets timeouts that satisfy the [timing invariants](/docs/timing), and signs the order id.
2. **Relays.** Sends the user's gasless lock (`lockWithIntent`) and, later, the user's claim, paying the gas.
3. **Counter-locks.** When the user's lock is final enough for the lane, locks its side on the other chain.
4. **Claims.** Reads the revealed secret from the chain (or from the user) and claims the user's lock.
5. **Refunds.** If a swap stops, refunds its own lock after the deadline, or releases the user's lock early when it will not counter-lock.

## Staying safe

- **State machine with write-ahead.** Every intended transaction is written to SQLite before it is sent, and the engine reconciles with the chains on restart, so a crash never sends twice or forgets a lock.
- **Bitcoin Cash quorum.** Reads compare at least two independent Fulcrum servers (same genesis, live tips); without agreement, quoting stops.
- **Peg guard.** Quoting stops for a token that is more than 1% off a dollar, or whose sources disagree by more than 2%.
- **Exposure limits.** Caps per swap, per address, per IP, and on total open exposure.
- **Mainnet refusals.** On mainnet it refuses to start without a strong operator token, two Electrum servers, real keys and verified contract addresses.
- **RPC fallback.** Each chain has up to three RPC endpoints; a failing one is skipped.

## Running a solver

Anyone can run a solver: the contracts do not know or care who it is. The web app can ask several solvers and pick the best verified quote. The configuration is documented in `packages/solver/RUNBOOK.md`.
