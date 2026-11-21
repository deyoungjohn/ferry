# The Bitcoin Cash covenant

On Bitcoin Cash each swap gets its own covenant, written in CashScript. The swap's terms are its constructor parameters, so its address (pay-to-script-hash, 32 bytes) is unique to that swap. Nothing is deployed in advance.

## Parameters

| Parameter                  | Meaning                                                      |
| -------------------------- | ------------------------------------------------------------ |
| `hashLock`                 | `sha256(secret)`                                             |
| `recipientLockingBytecode` | Who a claim pays                                             |
| `refundLockingBytecode`    | Who a refund pays                                            |
| `tokenCategory`            | PUSD or MUSD (internal byte order)                           |
| `tokenAmount`              | Exact token amount                                           |
| `refundHeight`             | Block height after which a refund is allowed                 |
| `maxFee`                   | Largest miner fee a spend may take from the carried satoshis |

## Spending paths

```text
function claim(bytes secret) {
    require(secret.length == 32);
    require(sha256(secret) == hashLock);
    require(this.activeInputIndex == 0);
    require(tx.inputs.length == 1);
    require(tx.outputs.length == 1);
    require(tx.outputs[0].lockingBytecode == recipientLockingBytecode);
    require(tx.outputs[0].tokenCategory == tokenCategory);
    require(tx.outputs[0].tokenAmount == tokenAmount);
    require(tx.outputs[0].value >= tx.inputs[0].value - maxFee);
}
```

- **claim(secret)** pays the full token amount to the recipient. No signature: anyone who knows the secret can send it, and it can only pay the recipient.
- **refund()** pays the full amount to the refund address once `refundHeight` is reached. No signature either.
- **release(pk, sig)** lets the recipient hand the lock back to the refund address early, with the recipient's signature.

Every path allows one input and one output, so a spend cannot split the tokens, add an output, or take more than `maxFee` in fees.

## Why keyless matters

Because claims and refunds need no key, the person being paid does not have to have a Bitcoin Cash wallet connected: the web app, the recovery page or the command-line tool can build the spend, check it in the libauth virtual machine, and broadcast it.

## Tested against attacks

Every spending path was run against more than 1,300 mutated transactions per token, each of which the covenant must reject. See [How Ferry was tested](/docs/testing#bch-covenant-attacks).
