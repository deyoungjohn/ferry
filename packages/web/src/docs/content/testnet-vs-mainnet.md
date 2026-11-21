# Testnet and mainnet

Ferry was first built on testnets before BCH BLAZE 2026, as [ferry-testnet](https://github.com/deyoungjohn/ferry-testnet). This repository was started fresh on 15 November 2026 and is not a fork of it: the testnet build was the reference for what to keep, what to change and what to drop.

## What changed

The testnet build ran from 22 October to 6 November 2026. Only one route was ever swapped end to end; the table says what was built, and what was actually tested.

|                              | Testnet build                                                                                          | Mainnet build (this one)                                                                                                      |
| ---------------------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| Swaps that worked end to end | Base Sepolia USDC to chipnet tPUSD, and back. Nothing else                                             | Every route in both directions on six chains: 55 real swaps and $475 settled by 21 Nov ([record](/docs/mainnet-record))       |
| Other chains                 | The contract was deployed to some other testnets and poked by scripts; never swapped, never in the app | Base, Ethereum, Arbitrum One, BNB Chain, Arc, Robinhood Chain, all live in the app                                            |
| Bitcoin Cash tokens          | Self-minted test tokens (tPUSD) on chipnet                                                             | Real PUSD (ParyonUSD) and MUSD (Moria v1) on mainnet                                                                          |
| EVM stablecoins              | Test USDC on Base Sepolia                                                                              | USDC, USDT and USDG                                                                                                           |
| EVM contract                 | `FerryHTLC` on Base Sepolia                                                                            | `FerryHTLC` at `0xfC28…DAdF` on six mainnets, source verified                                                                 |
| Pay links                    | A page existed; never tested                                                                           | Live and used: fixed or open amount, any chain and token, delete unpaid links                                                 |
| Send links                   | Not built                                                                                              | Live: receiver chooses the route and signs one free message; unclaimed links refund                                           |
| Recovery                     | A recovery file and a recovery page existed; never tested on a real stuck swap                         | Tested on mainnet: wallet-derived key finds and finishes a swap from another browser; files and `recover.html`                |
| Finishing a swap             | Keep the page open                                                                                     | Finish with your wallet from any device, or the optional handoff                                                              |
| Bitcoin Cash wallets         | Locks signed in testing setups                                                                         | WizardConnect, with Ferry's own relay and fallback to public relays                                                           |
| Pricing                      | Fixed test prices                                                                                      | Live Chainlink, Cauldron and Paryon prices with a peg guard                                                                   |
| Gas for the user             | Permit and relayed lock on Base Sepolia                                                                | Gasless locks and claims on every permit token                                                                                |
| Testing                      | Unit and end-to-end tests on Base Sepolia and chipnet                                                  | Plus fork rehearsals on every chain, 30,000 fuzz runs, 2,700 covenant attacks, a 200-swap load run ([details](/docs/testing)) |

## What stayed

The core idea and its safety rules: two HTLCs and one secret, the first lock outliving the second (invariants F and R), keyless Bitcoin Cash claims and refunds, contracts without owners, and recovery without the website.
