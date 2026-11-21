# Timeouts and refunds

The safety of a swap depends on one rule: **the lock made first must outlive the lock made second**, by enough margin that the second party can always act in time.

## The rule, in each direction

**EVM to Bitcoin Cash.** You lock first on the EVM chain with deadline `evmDeadline`; the solver locks second on Bitcoin Cash with refund height `bchRefundHeight`. Invariant F requires that your EVM deadline comes later than the slowest likely time for the Bitcoin Cash refund height to be reached, plus the solver's reaction time and a safety margin.

**Bitcoin Cash to EVM.** You lock first on Bitcoin Cash; the solver locks second on the EVM chain. Invariant R requires that even if Bitcoin Cash blocks arrive unusually fast, your refund height is not reached before the solver's EVM deadline plus reaction time and margin.

Bitcoin Cash blocks arrive at random. Ferry models block arrival as an Erlang distribution and uses its 99.99% (slow) and 0.01% (fast) quantiles, so the rule holds in all but extreme cases. Every quote is checked against the invariant by the solver and again in your browser before you lock.

## Default timeouts

| Direction           | First lock (yours)                                    | Second lock (solver's)                              |
| ------------------- | ----------------------------------------------------- | --------------------------------------------------- |
| EVM to Bitcoin Cash | EVM deadline 24 hours                                 | Bitcoin Cash refund after 36 blocks (about 6 hours) |
| Bitcoin Cash to EVM | Bitcoin Cash refund after 144 blocks (about 24 hours) | EVM deadline 6 hours                                |

The exact deadlines of your swap are in its quote and on its page. Send links use the window you choose (24 hours, 3 days or 7 days).

## Refunds

- **EVM:** after the deadline anyone can call `refund(lockId)`, and the tokens always go to the original sender.
- **Bitcoin Cash:** after the refund height anyone can broadcast the covenant's refund spend, and the tokens always go to the refund address in the terms. No signature is needed.
- **Early return:** the recipient of a lock (the solver) can hand it back early with `release`, which it does when it declines to counter-lock.
