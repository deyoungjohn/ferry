# The EVM contract

`FerryHTLC.sol` holds every EVM-side lock. It is deployed at `0xfC28c2596C553353578a5a444d2316514009DAdF` on all six chains and has no owner, admin, pause or upgrade.

## A lock

Each lock stores the token, the sender, the recipient, the amount, the hash lock, the deadline and a state (`Locked`, `Claimed` or `Refunded`). Its id is `keccak256(sender, hashLock)`, so a hash lock can be used once per sender.

## Functions

| Function                                             | Who can call                     | What it does                                                                            |
| ---------------------------------------------------- | -------------------------------- | --------------------------------------------------------------------------------------- |
| `lock(token, recipient, amount, hashLock, deadline)` | The sender                       | Pulls the tokens and creates the lock                                                   |
| `lockWithIntent(...)`                                | Anyone (the solver relays it)    | Uses an EIP-2612 permit and the sender's EIP-712 lock intent, so the sender pays no gas |
| `claim(id, secret)`                                  | Anyone                           | If `sha256(secret)` matches, pays the recipient and emits the secret                    |
| `refund(id)`                                         | Anyone, at or after the deadline | Returns the tokens to the sender                                                        |
| `release(id)`                                        | The recipient only               | Returns the tokens to the sender early                                                  |

`claim` and `refund` take no address argument: funds can only go to the recipient or the sender stored in the lock.

## Gasless locks

`lockWithIntent` checks a signed `LockIntent` bound to the order id, the chain id and this contract's address, with a deadline and a nonce. A front-run permit does not break it (`_tryPermit` tolerates a permit that was already used), and the same intent cannot be replayed on another order, chain or contract. Tokens use `SafeERC20`, so USDT's non-standard return values work.

## Verifying it yourself

Source is verified on Etherscan, Arbiscan and Sourcify (see [Chains, tokens and contracts](/docs/chains-and-tokens#mainnet-contracts)). The deploy uses the standard CREATE2 deployer, so the same bytecode and salt give the same address everywhere. `pnpm --filter @ferry/htlc-evm verify-commands` prints the verification command for each explorer, and the deployment recorder in `packages/chain-config` compares the code on chain with a local build.
