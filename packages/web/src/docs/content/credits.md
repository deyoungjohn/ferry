# Credits and license

## Built for BCH BLAZE 2026

Ferry was built for BCH BLAZE 2026 (14 to 22 November 2026). Earlier testnet work is public as [ferry-testnet](https://github.com/deyoungjohn/ferry-testnet).

## How it was built

The code was written by a small team of AI coding agents (Claude) working in parallel under human direction; commits carry `Co-Authored-By` trailers that record it.

## Built on

- [CashScript](https://cashscript.org) and [libauth](https://libauth.org) for the Bitcoin Cash covenant and transaction checks.
- [Foundry](https://getfoundry.sh) and [OpenZeppelin Contracts](https://openzeppelin.com/contracts) for the EVM contract.
- [viem](https://viem.sh), [wagmi](https://wagmi.sh) and [Reown AppKit](https://reown.com) for EVM wallets.
- WizardConnect for Bitcoin Cash wallets, and [nostr-rs-relay](https://github.com/scsibug/nostr-rs-relay) for the pairing relay.
- Price data from Chainlink, Cauldron and Paryon.
- PUSD by [Paryon](https://paryonusd.com) and MUSD by [Moria](https://moria.money).

The swap card's layout and token picker, the pagination control and the date range picker are adapted from [beui.dev](https://beui.dev) components, used with the maintainer's permission.

## License

Ferry is released under the MIT License (`LICENSE` in the repository).
