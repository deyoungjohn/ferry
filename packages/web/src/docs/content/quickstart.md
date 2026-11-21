# Quickstart

This walks you through a first swap of a few dollars from USDC on Base to PUSD on Bitcoin Cash. It takes about a minute.

## What you need

- An EVM wallet with a few USDC on Base (MetaMask, Rabby, Binance Wallet, OKX Wallet and other common wallets work).
- A Bitcoin Cash address that can hold tokens. It starts with `bitcoincash:z`. Paytaca and Cashonize show one.

You do **not** need ETH for gas on most routes: the solver relays your lock and claim, and its cost is in the quote. See [Fees, limits and lanes](/docs/fees-and-limits).

## Your first swap

1. Open [Ferry](/app/swap) and connect your EVM wallet.
2. Choose **USDC on Base** to send and **PUSD** to receive. Type the amount; the minimum is $1.
3. Paste your Bitcoin Cash address. Ferry checks that it is a token address before you can continue.
4. Press **Ferry it** and review the price and fee. The quote is fixed for 60 seconds.
5. Approve in your wallet. You sign once to create your [recovery key](/docs/recovery-key) (only the first time), then a permit and a lock request. Nothing leaves your wallet until the lock.
6. Watch the steps: your funds locked, the solver's funds locked on Bitcoin Cash, your claim, done. PUSD arrives at your address.

> **Note:** If anything stops on the way, nothing is lost. Your lock can only go to the solver if you claimed its PUSD, and otherwise it is refunded after its deadline. [Recovery](/docs/recovery) shows how to finish or refund a swap from any device.

## Going back

To swap PUSD to USDC, choose PUSD to send. You connect a Bitcoin Cash wallet with WizardConnect (scan a QR with Paytaca or another supported wallet) and your EVM wallet receives the USDC. See [Swap out of Bitcoin Cash](/docs/swap-from-bch).

## Next

::: cards

- [Pay links](/docs/pay-links): get paid in PUSD by anyone on six chains
- [Send links](/docs/send-links): send PUSD to someone on an EVM chain
- [Recovery](/docs/recovery): what to do if a swap stops
  :::
