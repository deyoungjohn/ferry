# Recovery

Every swap can be finished or refunded without Ferry's help. There are three ways, from easiest to most independent.

## 1. Recover with your wallet

Open [Recover](/app/recover) and press **Recover with wallet**. Your wallet signs the same fixed message it signed when you first swapped. From that signature Ferry rebuilds your [recovery key](/docs/recovery-key) in your browser, recomputes the hash lock of each of your swaps, and finds them on the chains. Swaps that need you are listed under **Needs your action**:

- a swap whose payout is waiting shows **Continue this swap**, which opens it with **Finish with your wallet**;
- a swap whose deadline has passed shows its refund.

This works on any device and any browser, with no file. Finished swaps are not listed.

## 2. Recover from a file

Each swap can also be saved as `ferry-<orderId>.json`. It holds the signed terms, the contract references and, when you hold it, the secret. Load it on the [Recover](/app/recover) page under **Load recovery file** and Ferry tells you exactly what to do: claim, refund, or wait (and until when).

## 3. Recover with no website

`recover.html` is a single self-contained page. Download it from [/recover.html](/recover.html) or the repository root, open it from your own computer, and load your recovery file. It reads public chain servers directly and sends the claim or refund: an EVM transaction through your browser wallet, or a Bitcoin Cash transaction that needs no wallet at all. It needs no Ferry server and no solver.

For the command line there is `@ferry/recover-cli`. It prints the action without sending anything unless you add `--broadcast`:

```bash
pnpm --filter @ferry/recover-cli build
node packages/recover-cli/dist/cli.js ferry-<orderId>.json --rpc <evm-rpc-url>
```

## What can and cannot go wrong

- Funds sit only in the two contracts. Neither has an owner who could move them.
- A claim can only pay the address in the terms, and a refund can only pay the sender.
- If you lose both your recovery key and your file, you can still refund after the deadline: refunds need no secret.
