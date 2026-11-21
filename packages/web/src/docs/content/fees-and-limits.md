# Fees, limits and lanes

## What a swap costs

Every quote shows the full cost before you confirm:

| Part         | Today                  | What it pays for                           |
| ------------ | ---------------------- | ------------------------------------------ |
| Spread       | 0.05% (5 basis points) | The solver's margin                        |
| Route fee    | $0 on most routes      | Relay gas where it matters (set per route) |
| Network fees | Included               | The solver relays your lock and claim      |

The solver prices against live references: Chainlink feeds for the EVM stablecoins, and the Cauldron pool and Paryon for PUSD and MUSD. If a stablecoin drifts more than 1% from a dollar, or two price sources disagree by more than 2%, the solver stops quoting that route rather than give a bad price.

The live values are published at [`/v1/stats`](https://ferry.incepture.dev/v1/stats) under `quotePolicy`.

## Limits

| Limit        | Today        |
| ------------ | ------------ |
| Minimum swap | $1.00        |
| Maximum swap | $50.00       |
| Fast lane    | up to $25.00 |

Limits are low on purpose while Ferry is new on mainnet. They are solver settings, not contract limits.

## Lanes

- **Fast:** the solver acts as soon as your lock is safe enough for the amount. Under a minute.
- **Safe:** the solver waits for more confirmations. About 1 to 2 minutes for EVM to Bitcoin Cash; about ten minutes for Bitcoin Cash to EVM, which waits for one block.

Send links use the safe lane.
