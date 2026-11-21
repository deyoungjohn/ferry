# What Ferry is

Ferry is a two-way atomic swap between stablecoins on EVM chains and PUSD or MUSD CashTokens on Bitcoin Cash. Nothing is wrapped, minted or held by a custodian. Every swap is a pair of hash time-locked contracts, one on each chain, that open with the same secret.

## The problem

Dollars live on EVM chains. Bitcoin Cash has fast, cheap payments and its own dollar tokens, but moving between the two has meant trusting someone: a bridge that holds the deposit, a wrapped token that is only as good as its issuer, or an exchange account.

## The idea

A swap has two sides, and each side is locked in its own contract:

1. You lock your stablecoin in a contract on your chain. Only a secret can release it to the other side, and only before a deadline. After the deadline it can go back to you.
2. A **solver**, an independent liquidity provider, sees your lock and locks the matching amount on the other chain, under the same secret.
3. You claim the solver's lock by revealing the secret. Revealing it lets the solver claim yours.

Either both claims happen, or neither lock is spent and both are refunded. The full picture is in [Atomic swaps](/docs/atomic-swaps).

## What Ferry is not

- **Not a bridge.** No wrapped tokens and no pool of user deposits. You receive real PUSD or MUSD, and the solver receives real USDC, USDT or USDG.
- **Not custodial.** Ferry never holds your money. Contracts have no owner, admin key, pause switch or upgrade path.
- **Not trustless in every sense.** You still depend on a solver being online to quote and lock its side. If it is not, you get your money back after the deadline. See [Trust model](/docs/trust-model).

## Who it is for

- People who hold dollars on an EVM chain and want them on Bitcoin Cash, or the other way.
- Merchants and people who want to be paid in PUSD or MUSD by anyone with dollars on another chain: [Pay links](/docs/pay-links).
- People who want to send dollars to a friend who only has an EVM wallet: [Send links](/docs/send-links).
