# Ferry Documentation

Ferry moves stablecoins in and out of Bitcoin Cash. You swap USDC, USDT or USDG on one of six EVM chains for PUSD or MUSD on Bitcoin Cash, and back, with an atomic swap: either both sides happen, or your money comes back.

> **Note:** These pages are for people who use Ferry and for developers who want to check how it works. If you only want to swap, open [Ferry](/app/swap) and follow the [Quickstart](/docs/quickstart).

## Why it exists

Most people hold their dollars as USDC or USDT on Ethereum, Base or another EVM chain. Bitcoin Cash has its own dollar tokens, PUSD and MUSD, but there was no direct way to move between the two worlds without handing money to a bridge or an exchange. Ferry is that direct way, with no custodian in the middle: two contracts, one secret, and a refund if anything stops.

## What you can do

- **Swap** stablecoins into Bitcoin Cash or out of it, in about a minute.
- **Get paid** with a pay link: anyone holding dollars on six chains pays you in PUSD or MUSD.
- **Send** PUSD to someone who only has an EVM wallet, with a send link.
- **Recover** any swap with your wallet, on any device, or with a file and no website at all.

## Where to start

::: cards

- [What Ferry is](/docs/what-is-ferry): the idea in five minutes
- [Quickstart](/docs/quickstart): your first swap
- [Chains, tokens and contracts](/docs/chains-and-tokens): what is supported and where it lives
- [How Ferry was tested](/docs/testing): the evidence behind every number on the site
- [Mainnet record](/docs/mainnet-record): real swaps with explorer links
  :::

## Links

- Live app: [ferry.incepture.dev](https://ferry.incepture.dev)
- Source code: [github.com/deyoungjohn/ferry](https://github.com/deyoungjohn/ferry)
- Testnet build (before BCH BLAZE 2026): [github.com/deyoungjohn/ferry-testnet](https://github.com/deyoungjohn/ferry-testnet)
