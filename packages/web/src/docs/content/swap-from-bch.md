# Swap out of Bitcoin Cash

A reverse swap turns PUSD or MUSD on Bitcoin Cash into a stablecoin on an EVM chain. You need a Bitcoin Cash wallet that speaks WizardConnect (to lock your tokens) and an EVM address to receive.

## Steps

1. **Connect.** Scan the WizardConnect QR with your Bitcoin Cash wallet. See [Wallets](/docs/wallets).
2. **Quote.** Choose PUSD or MUSD, the amount, the chain and token to receive, and the receiving EVM address (your connected EVM wallet by default).
3. **Lock.** Your Bitcoin Cash wallet signs one transaction that locks the tokens in this swap's covenant. The lock transaction also carries a short tag so your wallet's recovery key can find the swap later.
4. **Counter-lock.** The solver sees your lock and locks the stablecoin in `FerryHTLC` on the EVM chain under the same hash lock.
5. **Claim.** Ferry claims the EVM lock to your address by revealing the secret. The solver relays the claim, so you pay no gas; if the relay is down, your wallet can send the claim itself.
6. **Done.** The solver claims your Bitcoin Cash lock with the revealed secret.

## Lanes

On the **fast** lane (up to $25) the solver counter-locks as soon as your Bitcoin Cash lock is in the mempool and no double-spend proof appears within a few seconds. On the **safe** lane it waits for one block, about ten minutes on average.

## Refunds

Your Bitcoin Cash lock can be refunded to your address after its refund height (144 blocks, about 24 hours, by default). The solver's EVM lock expires earlier, so the solver can never be left holding your tokens while you hold the secret. See [Timeouts and refunds](/docs/timing).
