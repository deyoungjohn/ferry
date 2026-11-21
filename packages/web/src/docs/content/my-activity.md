# My activity

[My activity](/app/my-activity) lists your swaps, including pay link payments and send links. You do not need an account: the list is found from your wallets.

## Where the list comes from

- **EVM wallet:** the swaps whose EVM side is your connected address.
- **Bitcoin Cash wallet:** Bitcoin Cash wallets use a new address for each payment, so Ferry asks the connected wallet for every address it has used (worked out from its public keys, with no prompt on your phone) and lists the swaps on any of them.
- **A pasted address:** paste any Bitcoin Cash address and press **Inspect Address** to see the swaps on that address alone.

The list comes from the solver's public record (`GET /v1/orders`, see [Solver API](/docs/api#swaps)). Each row opens the swap's page, which shows every transaction with a link to its explorer, so nothing in the list has to be taken on trust.

## When you need more than the list

[Recover](/docs/recovery) does not depend on the solver: it rebuilds your swaps from your wallet's recovery key and reads the chains directly.

## Statuses

| Status         | Meaning                                                |
| -------------- | ------------------------------------------------------ |
| In progress    | Locks are being made or claimed                        |
| Ready to claim | The solver's lock is there; open the swap to finish it |
| Completed      | Both claims are on chain                               |
| Refunded       | A lock went back to its sender                         |
