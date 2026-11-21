# My activity

[My activity](/app/my-activity) lists your swaps, pay links and send links. It is rebuilt from the chains, not from a Ferry account.

## Where the list comes from

- **EVM side:** `Locked`, `Claimed` and `Refunded` events of `FerryHTLC` for your address, read from public RPCs.
- **Bitcoin Cash side:** your address history, with each covenant's redeem script parsed back into its terms.
- **Recovery key:** with your wallet's recovery signature, Ferry can also find swaps whose hash locks came from your key.

The solver's own record adds labels (such as which swaps paid a pay link) but is never the only source.

## Statuses

| Status            | Meaning                                            |
| ----------------- | -------------------------------------------------- |
| In progress       | Locks are being made or claimed                    |
| Needs your action | A claim or refund waits for you; open it to finish |
| Done              | Both claims are on chain                           |
| Refunded          | A lock went back to its sender                     |
