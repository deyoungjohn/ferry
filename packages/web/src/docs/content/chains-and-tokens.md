# Chains, tokens and contracts

Bitcoin Cash is on one side of every swap. The other side is one of six EVM chains.

## Supported routes

| Chain           | Chain ID | Stablecoins              | Gasless permit    |
| --------------- | -------- | ------------------------ | ----------------- |
| Base            | 8453     | USDC                     | Yes               |
| Ethereum        | 1        | USDC, USDT               | USDC yes, USDT no |
| Arbitrum One    | 42161    | USDC, USDT               | Yes               |
| BNB Chain       | 56       | USDT, USDC (18 decimals) | No                |
| Arc             | 5042     | USDC                     | Yes               |
| Robinhood Chain | 4663     | USDG                     | Yes               |

On Bitcoin Cash you receive or send **PUSD** (ParyonUSD) or **MUSD** (Moria Protocol v1). MUSD routes are built but had no liquidity at submission; PUSD routes are live. Which routes are open at a given moment depends on the solver's liquidity; the [status page](/status) shows each route live.

> **Note:** Tokens without a gasless permit (USDT on Ethereum, both tokens on BNB Chain) ask for a normal approve transaction first, which needs a little native gas.

## Mainnet contracts

**FerryHTLC** is deployed at the same address on all six EVM chains, through the standard deterministic deployer:

`0xfC28c2596C553353578a5a444d2316514009DAdF`

| Chain           | Explorer                                                                                               | Source verified on |
| --------------- | ------------------------------------------------------------------------------------------------------ | ------------------ |
| Base            | [basescan.org](https://basescan.org/address/0xfC28c2596C553353578a5a444d2316514009DAdF)                | Sourcify           |
| Ethereum        | [etherscan.io](https://etherscan.io/address/0xfC28c2596C553353578a5a444d2316514009DAdF)                | Etherscan          |
| Arbitrum One    | [arbiscan.io](https://arbiscan.io/address/0xfC28c2596C553353578a5a444d2316514009DAdF)                  | Arbiscan           |
| BNB Chain       | [bscscan.com](https://bscscan.com/address/0xfC28c2596C553353578a5a444d2316514009DAdF)                  | Sourcify           |
| Arc             | [explorer.arc.io](https://explorer.arc.io/address/0xfC28c2596C553353578a5a444d2316514009DAdF)          | Sourcify           |
| Robinhood Chain | [blockscout](https://robinhoodchain.blockscout.com/address/0xfC28c2596C553353578a5a444d2316514009DAdF) | Sourcify           |

On Bitcoin Cash there is nothing to deploy. Each swap gets its own CashScript covenant, a pay-to-script-hash address built from that swap's terms. See [The Bitcoin Cash covenant](/docs/bch-covenant).

## Token addresses

| Token | Chain           | Address                                      | Decimals |
| ----- | --------------- | -------------------------------------------- | -------- |
| USDC  | Base            | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | 6        |
| USDC  | Ethereum        | `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` | 6        |
| USDT  | Ethereum        | `0xdAC17F958D2ee523a2206206994597C13D831ec7` | 6        |
| USDC  | Arbitrum One    | `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` | 6        |
| USDT  | Arbitrum One    | `0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9` | 6        |
| USDC  | BNB Chain       | `0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d` | 18       |
| USDT  | BNB Chain       | `0x55d398326f99059fF775485246999027B3197955` | 18       |
| USDC  | Arc             | `0x3600000000000000000000000000000000000000` | 6        |
| USDG  | Robinhood Chain | `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` | 6        |

| Token | Bitcoin Cash category                                              | Decimals |
| ----- | ------------------------------------------------------------------ | -------- |
| PUSD  | `2469acc5afa4b10cb5b5c04afb89c3a3ffd61c5da9c01e26d00951cae2a02544` | 2        |
| MUSD  | `b38a33f750f84c5c169a6f23cb873e6e79605021585d4f3408789689ed87f366` | 2        |

Categories are shown in display byte order, the order explorers and wallets use. The covenant stores them reversed (internal order); the code converts and tests both.
