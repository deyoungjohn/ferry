# Chain and token facts

Baseline date: **2026-11-16**. This file records the facts the EVM routes depend
on. The machine-readable copy is `src/data/chains.json`; the tables below record
the value, source, date and status for the facts that gate a route. Chain and
token facts were first verified on 2026-11-15; the S-17 price feeds and the RPC
refreshes were verified on 2026-11-16.

## Status legend

- ✔ **verified**: read from the issuer's documentation and/or the chain itself.
- ◇ **reported but unconfirmed**: a third party or a testnet experiment reports
  it, but no issuer document or mainnet probe confirms it.
- ✗ **not available**: the thing does not exist on that chain, or the checked
  contract rejects the call. For a feature such as EIP-2612, ✗ means the absence
  was verified on-chain; it is not an unverified fact.

Nothing is marked ✔ unless it was checked for this baseline. A route is enabled
only when its token address, decimals, EIP-712 domain (or verified absence),
permit facts, at least two RPC URLs and finality policy are all verified.

## Source and command keys

| Key | Source                                                                                                                 |
| --- | ---------------------------------------------------------------------------------------------------------------------- |
| C1  | Circle, USDC contract addresses: https://developers.circle.com/stablecoins/usdc-contract-addresses                     |
| T1  | Tether, supported protocols and integration guidelines: https://tether.to/en/supported-protocols/                      |
| A1  | Arc, contract addresses: https://docs.arc.io/arc/references/contract-addresses                                         |
| A2  | Arc, RPC endpoints and network parameters: https://docs.arc.io/arc/references/rpc-endpoints                            |
| U1  | USDT0, contract deployments: https://docs.usdt0.to/technical-documentation/deployments                                 |
| B1  | Binance, Proof of Collateral for B-tokens: https://www.binance.com/en/collateral-btokens                               |
| B2  | BscScan, verified Binance-Peg BSC-USD contract: https://bscscan.com/token/0x55d398326f99059fF775485246999027B3197955   |
| R1  | Robinhood Chain, token contracts: https://docs.robinhood.com/chain/contracts/                                          |
| R2  | Robinhood Chain, connecting and network parameters: https://docs.robinhood.com/chain/connecting/                       |
| O1  | Base network documentation: https://docs.base.org/get-started/connect-to-base                                          |
| O2  | Arbitrum documentation: https://docs.arbitrum.io/                                                                      |
| O3  | BNB Chain wallet and network documentation: https://docs.bnbchain.org/bnb-smart-chain/developers/wallet-configuration/ |
| O4  | Ethereum networks: https://ethereum.org/en/developers/docs/networks/                                                   |
| L1  | Chainlink reference data, Base: https://reference-data-directory.vercel.app/feeds-ethereum-mainnet-base-1.json         |
| L2  | Chainlink reference data, Ethereum: https://reference-data-directory.vercel.app/feeds-mainnet.json                     |
| L3  | Chainlink reference data, Arbitrum: https://reference-data-directory.vercel.app/feeds-ethereum-mainnet-arbitrum-1.json |
| L4  | Chainlink reference data, Arc: https://reference-data-directory.vercel.app/feeds-arc-mainnet.json                      |
| L5  | Chainlink reference data, BNB Chain: https://reference-data-directory.vercel.app/feeds-bsc-mainnet.json                |
| L6  | Chainlink reference data, Robinhood Chain: https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json    |

On-chain commands use these forms:

| Key      | Command                                                                                                                                                            |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| CHAIN_ID | `eth_chainId` JSON-RPC call to the listed URL                                                                                                                      |
| CALL     | `cast call <token> "<signature>" --rpc-url <url>`                                                                                                                  |
| CODE     | `cast codesize <address> --rpc-url <url>`                                                                                                                          |
| BLOCK    | `cast block <safe\|finalized\|latest> --field number --rpc-url <url>`                                                                                              |
| LOGS     | `eth_getLogs` over the last N blocks for `0x0000000000000000000000000000000000000001`; N is increased until the endpoint rejects it                                |
| FEED     | `cast call <feed> "latestRoundData()(uint80,int256,uint256,uint256,uint80)" --rpc-url <url>` and the same call for `description()(string)` and `decimals()(uint8)` |

## Chain facts

### Base

| Network | Fact                      | Value                                                                           | Source                                             | Date       | Status |
| ------- | ------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------- | ---------- | ------ |
| mainnet | Chain ID                  | 8453 (`0x2105`)                                                                 | CHAIN_ID via `https://base-rpc.publicnode.com`; O1 | 2026-11-15 | ✔      |
| mainnet | Public RPC 1              | `https://base-rpc.publicnode.com`; `eth_getLogs` cap 50,000 blocks              | LOGS; CHAIN_ID                                     | 2026-11-16 | ✔      |
| mainnet | Public RPC 2              | `https://1rpc.io/base`; `eth_getLogs` cap 50 blocks                             | LOGS; CHAIN_ID                                     | 2026-11-16 | ✔      |
| mainnet | Other public RPC          | `https://mainnet.base.org`; `eth_getLogs` cap 200 blocks but rate-limits bursts | LOGS; CHAIN_ID                                     | 2026-11-16 | ◇      |
| mainnet | Explorer                  | `https://basescan.org`                                                          | O1                                                 | 2026-11-15 | ✔      |
| mainnet | Native gas token          | ETH                                                                             | O1                                                 | 2026-11-15 | ✔      |
| mainnet | `safe` block tag          | works; safe block 57,937,206                                                    | BLOCK                                              | 2026-11-15 | ✔      |
| mainnet | `finalized` block tag     | works; finalized block 57,933,212                                               | BLOCK                                              | 2026-11-15 | ✔      |
| mainnet | Typical block time        | 0.2 s (50-block sample)                                                         | CHAIN_ID + block timestamps                        | 2026-11-15 | ✔      |
| mainnet | Canonical CREATE2 factory | `0x4e59b44847b379578588920cA78FbF26c0B4956C`; 69 bytes of code                  | CODE                                               | 2026-11-15 | ✔      |
| testnet | Chain ID                  | 84532 (`0x14a34`)                                                               | CHAIN_ID via `https://sepolia.base.org`; O1        | 2026-11-15 | ✔      |
| testnet | Public RPC 1              | `https://sepolia.base.org`; `eth_getLogs` cap 200 blocks                        | LOGS; CHAIN_ID                                     | 2026-11-15 | ✔      |
| testnet | Public RPC 2              | `https://base-sepolia-rpc.publicnode.com`; `eth_getLogs` cap 50,000 blocks      | LOGS; CHAIN_ID                                     | 2026-11-15 | ✔      |
| testnet | Explorer                  | `https://sepolia.basescan.org`                                                  | O1                                                 | 2026-11-15 | ✔      |
| testnet | Native gas token          | ETH                                                                             | O1                                                 | 2026-11-15 | ✔      |
| testnet | `safe` block tag          | works; safe block 59,279,851                                                    | BLOCK                                              | 2026-11-15 | ✔      |
| testnet | `finalized` block tag     | works; finalized block 59,274,179                                               | BLOCK                                              | 2026-11-15 | ✔      |
| testnet | Typical block time        | 0.2 s (50-block sample)                                                         | block timestamps                                   | 2026-11-15 | ✔      |
| testnet | Canonical CREATE2 factory | `0x4e59b44847b379578588920cA78FbF26c0B4956C`; 69 bytes of code                  | CODE                                               | 2026-11-15 | ✔      |

### Ethereum

| Network | Fact                      | Value                                                                                     | Source                                                         | Date       | Status |
| ------- | ------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ---------- | ------ |
| mainnet | Chain ID                  | 1 (`0x1`)                                                                                 | CHAIN_ID via `https://ethereum-rpc.publicnode.com`; O4         | 2026-11-15 | ✔      |
| mainnet | Public RPC 1              | `https://ethereum-rpc.publicnode.com`; `eth_getLogs` cap 10,000 blocks on the public tier | LOGS; CHAIN_ID                                                 | 2026-11-15 | ✔      |
| mainnet | Public RPC 2              | `https://rpc.flashbots.net`; `eth_getLogs` cap 2,000 blocks                               | LOGS; CHAIN_ID                                                 | 2026-11-15 | ✔      |
| mainnet | Explorer                  | `https://etherscan.io`                                                                    | O4                                                             | 2026-11-15 | ✔      |
| mainnet | Native gas token          | ETH                                                                                       | O4                                                             | 2026-11-15 | ✔      |
| mainnet | `safe` block tag          | works; safe block 26,423,043                                                              | BLOCK                                                          | 2026-11-15 | ✔      |
| mainnet | `finalized` block tag     | works; finalized block 26,423,011                                                         | BLOCK                                                          | 2026-11-15 | ✔      |
| mainnet | Typical block time        | 12 s (50-block sample)                                                                    | block timestamps                                               | 2026-11-15 | ✔      |
| mainnet | Canonical CREATE2 factory | `0x4e59b44847b379578588920cA78FbF26c0B4956C`; 69 bytes of code                            | CODE                                                           | 2026-11-15 | ✔      |
| testnet | Chain ID                  | 11155111 (`0xaa36a7`)                                                                     | CHAIN_ID via `https://ethereum-sepolia-rpc.publicnode.com`; O4 | 2026-11-15 | ✔      |
| testnet | Public RPC 1              | `https://ethereum-sepolia-rpc.publicnode.com`; `eth_getLogs` cap 10,000 blocks            | LOGS; CHAIN_ID                                                 | 2026-11-15 | ✔      |
| testnet | Public RPC 2              | `https://rpc.sepolia.ethpandaops.io`; `eth_getLogs` cap 10,000 blocks                     | LOGS; CHAIN_ID                                                 | 2026-11-16 | ✔      |
| testnet | Explorer                  | `https://sepolia.etherscan.io`                                                            | O4                                                             | 2026-11-15 | ✔      |
| testnet | Native gas token          | ETH                                                                                       | O4                                                             | 2026-11-15 | ✔      |
| testnet | `safe` block tag          | works; safe block 12,142,819                                                              | BLOCK                                                          | 2026-11-15 | ✔      |
| testnet | `finalized` block tag     | works; finalized block 12,142,788                                                         | BLOCK                                                          | 2026-11-15 | ✔      |
| testnet | Typical block time        | 12.5 s (50-block sample)                                                                  | block timestamps                                               | 2026-11-15 | ✔      |
| testnet | Canonical CREATE2 factory | `0x4e59b44847b379578588920cA78FbF26c0B4956C`; 69 bytes of code                            | CODE                                                           | 2026-11-15 | ✔      |

### Arbitrum One

| Network | Fact                      | Value                                                                          | Source                                                    | Date       | Status |
| ------- | ------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------- | ---------- | ------ |
| mainnet | Chain ID                  | 42161 (`0xa4b1`)                                                               | CHAIN_ID via `https://arb1.arbitrum.io/rpc`; O2           | 2026-11-15 | ✔      |
| mainnet | Public RPC 1              | `https://arb1.arbitrum.io/rpc`; `eth_getLogs` accepts 100,000 blocks           | LOGS; CHAIN_ID                                            | 2026-11-15 | ✔      |
| mainnet | Public RPC 2              | `https://arbitrum.gateway.tenderly.co`; `eth_getLogs` accepts 100,000 blocks   | LOGS; CHAIN_ID                                            | 2026-11-16 | ✔      |
| mainnet | Explorer                  | `https://arbiscan.io`                                                          | O2                                                        | 2026-11-15 | ✔      |
| mainnet | Native gas token          | ETH                                                                            | O2                                                        | 2026-11-15 | ✔      |
| mainnet | `safe` block tag          | works; safe block 524,565,907                                                  | BLOCK                                                     | 2026-11-15 | ✔      |
| mainnet | `finalized` block tag     | works; finalized block 524,564,785                                             | BLOCK                                                     | 2026-11-15 | ✔      |
| mainnet | Typical block time        | 0.25 s (50-block sample)                                                       | block timestamps                                          | 2026-11-15 | ✔      |
| mainnet | Canonical CREATE2 factory | `0x4e59b44847b379578588920cA78FbF26c0B4956C`; 69 bytes of code                 | CODE                                                      | 2026-11-15 | ✔      |
| testnet | Chain ID                  | 421614 (`0x66eee`)                                                             | CHAIN_ID via `https://sepolia-rollup.arbitrum.io/rpc`; O2 | 2026-11-15 | ✔      |
| testnet | Public RPC 1              | `https://sepolia-rollup.arbitrum.io/rpc`; `eth_getLogs` accepts 100,000 blocks | LOGS; CHAIN_ID                                            | 2026-11-15 | ✔      |
| testnet | Public RPC 2              | `https://arbitrum-sepolia-rpc.publicnode.com`; `eth_getLogs` cap 50,000 blocks | LOGS; CHAIN_ID                                            | 2026-11-15 | ✔      |
| testnet | Explorer                  | `https://sepolia.arbiscan.io`                                                  | O2                                                        | 2026-11-15 | ✔      |
| testnet | Native gas token          | ETH                                                                            | O2                                                        | 2026-11-15 | ✔      |
| testnet | `safe` block tag          | works; safe block 329,577,553                                                  | BLOCK                                                     | 2026-11-15 | ✔      |
| testnet | `finalized` block tag     | works; finalized block 329,575,856                                             | BLOCK                                                     | 2026-11-15 | ✔      |
| testnet | Typical block time        | 0.3 s (50-block sample)                                                        | block timestamps                                          | 2026-11-15 | ✔      |
| testnet | Canonical CREATE2 factory | `0x4e59b44847b379578588920cA78FbF26c0B4956C`; 69 bytes of code                 | CODE                                                      | 2026-11-15 | ✔      |

### Arc

| Network | Fact                      | Value                                                              | Source                                        | Date       | Status |
| ------- | ------------------------- | ------------------------------------------------------------------ | --------------------------------------------- | ---------- | ------ |
| mainnet | Chain ID                  | 5042 (`0x13b2`)                                                    | CHAIN_ID via `https://rpc.mainnet.arc.io`; A2 | 2026-11-15 | ✔      |
| mainnet | Public RPC 1              | `https://rpc.mainnet.arc.io`; `eth_getLogs` cap 10,000 blocks      | LOGS; CHAIN_ID                                | 2026-11-15 | ✔      |
| mainnet | Public RPC 2              | `https://rpc.drpc.mainnet.arc.io`; free tier rejects `eth_getLogs` | LOGS; CHAIN_ID                                | 2026-11-15 | ✔      |
| mainnet | Explorer                  | `https://explorer.arc.io`                                          | A2                                            | 2026-11-15 | ✔      |
| mainnet | Native gas token          | USDC (18 decimals in balances and fees)                            | A2                                            | 2026-11-15 | ✔      |
| mainnet | `safe` block tag          | works; safe block 31,434,280                                       | BLOCK                                         | 2026-11-15 | ✔      |
| mainnet | `finalized` block tag     | works; finalized block 31,434,282                                  | BLOCK                                         | 2026-11-15 | ✔      |
| mainnet | Typical block time        | 0.5 s (50-block sample); deterministic sub-second finality         | block timestamps; A2                          | 2026-11-15 | ✔      |
| mainnet | Canonical CREATE2 factory | `0x4e59b44847b379578588920cA78FbF26c0B4956C`; 69 bytes of code     | CODE                                          | 2026-11-15 | ✔      |
| testnet | Chain ID                  | 5042002 (`0x4cef52`)                                               | CHAIN_ID via `https://rpc.testnet.arc.io`; A2 | 2026-11-15 | ✔      |
| testnet | Public RPC 1              | `https://rpc.testnet.arc.io`; `eth_getLogs` cap 10,000 blocks      | LOGS; CHAIN_ID                                | 2026-11-15 | ✔      |
| testnet | Public RPC 2              | `https://rpc.drpc.testnet.arc.io`; free tier rejects `eth_getLogs` | LOGS; CHAIN_ID                                | 2026-11-15 | ✔      |
| testnet | Explorer                  | `https://explorer.testnet.arc.io`                                  | A2                                            | 2026-11-15 | ✔      |
| testnet | Native gas token          | USDC (18 decimals in balances and fees)                            | A2                                            | 2026-11-15 | ✔      |
| testnet | `safe` block tag          | works; safe block 72,477,925                                       | BLOCK                                         | 2026-11-15 | ✔      |
| testnet | `finalized` block tag     | works; finalized block 72,477,926                                  | BLOCK                                         | 2026-11-15 | ✔      |
| testnet | Typical block time        | 0.66 s (50-block sample); deterministic sub-second finality        | block timestamps; A2                          | 2026-11-15 | ✔      |
| testnet | Canonical CREATE2 factory | `0x4e59b44847b379578588920cA78FbF26c0B4956C`; 69 bytes of code     | CODE                                          | 2026-11-15 | ✔      |

### BNB Chain

| Network | Fact                      | Value                                                                                | Source                                                    | Date       | Status |
| ------- | ------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------- | ---------- | ------ |
| mainnet | Chain ID                  | 56 (`0x38`)                                                                          | CHAIN_ID via `https://bsc-rpc.publicnode.com`; O3         | 2026-11-15 | ✔      |
| mainnet | Public RPC 1              | `https://bsc-rpc.publicnode.com`; `eth_getLogs` cap 50,000 blocks                    | LOGS; CHAIN_ID                                            | 2026-11-15 | ✔      |
| mainnet | Public RPC 2              | `https://1rpc.io/bnb`; `eth_getLogs` cap 50 blocks                                   | LOGS; CHAIN_ID                                            | 2026-11-15 | ✔      |
| mainnet | Other public RPC          | `https://bsc-dataseed.binance.org` rejects `eth_getLogs` with `-32005`               | LOGS; CHAIN_ID                                            | 2026-11-15 | ✔      |
| mainnet | Explorer                  | `https://bscscan.com`                                                                | O3                                                        | 2026-11-15 | ✔      |
| mainnet | Native gas token          | BNB                                                                                  | O3                                                        | 2026-11-15 | ✔      |
| mainnet | `safe` block tag          | works; safe block 133,807,237                                                        | BLOCK                                                     | 2026-11-15 | ✔      |
| mainnet | `finalized` block tag     | works; finalized block 133,807,239                                                   | BLOCK                                                     | 2026-11-15 | ✔      |
| mainnet | Typical block time        | 0.45 s (50-block sample)                                                             | block timestamps                                          | 2026-11-15 | ✔      |
| mainnet | Canonical CREATE2 factory | `0x4e59b44847b379578588920cA78FbF26c0B4956C`; 69 bytes of code                       | CODE                                                      | 2026-11-15 | ✔      |
| testnet | Chain ID                  | 97 (`0x61`)                                                                          | CHAIN_ID via `https://bsc-testnet-rpc.publicnode.com`; O3 | 2026-11-15 | ✔      |
| testnet | Public RPC 1              | `https://bsc-testnet-rpc.publicnode.com`; `eth_getLogs` cap 50,000 blocks            | LOGS; CHAIN_ID                                            | 2026-11-15 | ✔      |
| testnet | Public RPC 2              | `https://bsc-testnet.publicnode.com`; `eth_getLogs` cap 50,000 blocks                | LOGS; CHAIN_ID                                            | 2026-11-16 | ✔      |
| testnet | Other public RPC          | `https://data-seed-prebsc-1-s1.binance.org:8545` rejects `eth_getLogs` with `-32005` | LOGS; CHAIN_ID                                            | 2026-11-16 | ✔      |
| testnet | Explorer                  | `https://testnet.bscscan.com`                                                        | O3                                                        | 2026-11-15 | ✔      |
| testnet | Native gas token          | BNB                                                                                  | O3                                                        | 2026-11-15 | ✔      |
| testnet | `safe` block tag          | works; safe block 142,944,812                                                        | BLOCK                                                     | 2026-11-15 | ✔      |
| testnet | `finalized` block tag     | works; finalized block 142,944,813                                                   | BLOCK                                                     | 2026-11-15 | ✔      |
| testnet | Typical block time        | 0.44 s (50-block sample)                                                             | block timestamps                                          | 2026-11-15 | ✔      |
| testnet | Canonical CREATE2 factory | `0x4e59b44847b379578588920cA78FbF26c0B4956C`; 69 bytes of code                       | CODE                                                      | 2026-11-15 | ✔      |

### Robinhood Chain

| Network | Fact                      | Value                                                                           | Source                                                     | Date       | Status |
| ------- | ------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------- | ---------- | ------ |
| mainnet | Chain ID                  | 4663 (`0x1237`)                                                                 | CHAIN_ID via `https://rpc.mainnet.chain.robinhood.com`; R2 | 2026-11-15 | ✔      |
| mainnet | Public RPC 1              | `https://rpc.mainnet.chain.robinhood.com`; `eth_getLogs` accepts 100,000 blocks | LOGS; CHAIN_ID                                             | 2026-11-15 | ✔      |
| mainnet | Public RPC 2              | `https://robinhood.drpc.org`; free tier rejects `eth_getLogs`                   | LOGS; CHAIN_ID                                             | 2026-11-15 | ✔      |
| mainnet | Explorer                  | `https://robinhoodchain.blockscout.com`                                         | R2                                                         | 2026-11-15 | ✔      |
| mainnet | Native gas token          | ETH                                                                             | R2                                                         | 2026-11-15 | ✔      |
| mainnet | `safe` block tag          | works; safe block 115,251,190                                                   | BLOCK                                                      | 2026-11-15 | ✔      |
| mainnet | `finalized` block tag     | works; finalized block 115,246,875                                              | BLOCK                                                      | 2026-11-15 | ✔      |
| mainnet | Typical block time        | 0.1 s (50-block sample)                                                         | block timestamps                                           | 2026-11-15 | ✔      |
| mainnet | Canonical CREATE2 factory | `0x4e59b44847b379578588920cA78FbF26c0B4956C`; 69 bytes of code                  | CODE                                                       | 2026-11-15 | ✔      |
| testnet | Chain ID                  | 46630 (`0xb626`)                                                                | CHAIN_ID via `https://rpc.testnet.chain.robinhood.com`; R2 | 2026-11-15 | ✔      |
| testnet | Public RPC 1              | `https://rpc.testnet.chain.robinhood.com`; `eth_getLogs` accepts 100,000 blocks | LOGS; CHAIN_ID                                             | 2026-11-15 | ✔      |
| testnet | Public RPC 2              | `https://robinhood-testnet.drpc.org`; free tier rejects `eth_getLogs`           | LOGS; CHAIN_ID                                             | 2026-11-15 | ✔      |
| testnet | Explorer                  | `https://explorer.testnet.chain.robinhood.com`                                  | R2                                                         | 2026-11-15 | ✔      |
| testnet | Native gas token          | ETH                                                                             | R2                                                         | 2026-11-15 | ✔      |
| testnet | `safe` block tag          | works; safe block 153,799,509                                                   | BLOCK                                                      | 2026-11-15 | ✔      |
| testnet | `finalized` block tag     | works; finalized block 153,799,509                                              | BLOCK                                                      | 2026-11-15 | ✔      |
| testnet | Typical block time        | 0.25 s (50-block sample)                                                        | block timestamps                                           | 2026-11-15 | ✔      |
| testnet | Canonical CREATE2 factory | `0x4e59b44847b379578588920cA78FbF26c0B4956C`; 69 bytes of code                  | CODE                                                       | 2026-11-15 | ✔      |

AppKit custom-chain configuration uses the chain ID, RPC URL, explorer URL and
native gas token recorded in each network table above. Arc is a custom chain
with USDC gas (A2); Robinhood Chain is a custom Arbitrum L2 with ETH gas (R2).
Both values are present for mainnet and testnet.

## Token facts

### Base

| Asset        | Fact                         | Value                                                                  | Source                                                  | Date       | Status |
| ------------ | ---------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------- | ---------- | ------ |
| USDC mainnet | Contract                     | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`                           | C1; CODE = 1852 bytes                                   | 2026-11-15 | ✔      |
| USDC mainnet | Decimals                     | 6                                                                      | CALL `decimals()(uint8)` via `https://mainnet.base.org` | 2026-11-15 | ✔      |
| USDC mainnet | `name()`                     | `USD Coin`                                                             | CALL via `https://mainnet.base.org`                     | 2026-11-15 | ✔      |
| USDC mainnet | `version()`                  | `2`                                                                    | CALL via `https://mainnet.base.org`                     | 2026-11-15 | ✔      |
| USDC mainnet | `DOMAIN_SEPARATOR()`         | `0x02fa7265e7c5d81118673727957699e4d68f74cd74b7db77da710fe8a2c7834f`   | CALL                                                    | 2026-11-15 | ✔      |
| USDC mainnet | EIP-2612 `permit`            | available; invalid signature reverts with `EIP2612: invalid signature` | CALL `permit(...)` dummy values                         | 2026-11-15 | ✔      |
| USDC mainnet | EIP-2612 `nonces`            | available; `nonces(0x0)` returns 0                                     | CALL                                                    | 2026-11-15 | ✔      |
| USDC mainnet | Native or bridged            | Native Circle USDC                                                     | C1                                                      | 2026-11-15 | ✔      |
| USDC mainnet | Issuer                       | Circle                                                                 | C1                                                      | 2026-11-15 | ✔      |
| USDC testnet | Contract                     | `0x036CbD53842c5426634e7929541eC2318f3dCF7e`                           | C1; CODE = 1798 bytes                                   | 2026-11-15 | ✔      |
| USDC testnet | Decimals                     | 6                                                                      | CALL via `https://sepolia.base.org`                     | 2026-11-15 | ✔      |
| USDC testnet | `name()`                     | `USDC`                                                                 | CALL                                                    | 2026-11-15 | ✔      |
| USDC testnet | `version()`                  | `2`                                                                    | CALL                                                    | 2026-11-15 | ✔      |
| USDC testnet | `DOMAIN_SEPARATOR()`         | `0x71f17a3b2ff373b803d70a5a07c046c1a2bc8e89c09ef722fcb047abe94c9818`   | CALL                                                    | 2026-11-15 | ✔      |
| USDC testnet | EIP-2612 `permit` / `nonces` | available; `nonces(0x0)` returns 0                                     | CALL                                                    | 2026-11-15 | ✔      |
| USDC testnet | Native or bridged            | Native Circle test USDC                                                | C1                                                      | 2026-11-15 | ✔      |

### Ethereum

| Asset        | Fact                               | Value                                                                | Source                                         | Date       | Status |
| ------------ | ---------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------- | ---------- | ------ |
| USDC mainnet | Contract                           | `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48`                         | C1; CODE = 2186 bytes                          | 2026-11-15 | ✔      |
| USDC mainnet | Decimals                           | 6                                                                    | CALL via `https://ethereum-rpc.publicnode.com` | 2026-11-15 | ✔      |
| USDC mainnet | `name()` / `version()`             | `USD Coin` / `2`                                                     | CALL                                           | 2026-11-15 | ✔      |
| USDC mainnet | `DOMAIN_SEPARATOR()`               | `0x06c37168a7db5138defc7866392bb87a741f9b3d104deb5094588ce041cae335` | CALL                                           | 2026-11-15 | ✔      |
| USDC mainnet | EIP-2612 `permit` / `nonces`       | available; `nonces(0x0)` returns 0                                   | CALL                                           | 2026-11-15 | ✔      |
| USDC mainnet | Native or bridged                  | Native Circle USDC                                                   | C1                                             | 2026-11-15 | ✔      |
| USDT mainnet | Contract                           | `0xdAC17F958D2ee523a2206206994597C13D831ec7`                         | T1; CODE = 11,075 bytes                        | 2026-11-15 | ✔      |
| USDT mainnet | Decimals                           | 6                                                                    | CALL                                           | 2026-11-15 | ✔      |
| USDT mainnet | `name()`                           | `Tether USD`                                                         | CALL                                           | 2026-11-15 | ✔      |
| USDT mainnet | `version()` / `DOMAIN_SEPARATOR()` | not available; both revert                                           | CALL                                           | 2026-11-15 | ✗      |
| USDT mainnet | EIP-2612 `permit` / `nonces`       | not available; both revert                                           | CALL                                           | 2026-11-15 | ✗      |
| USDT mainnet | Native or bridged                  | Native Tether USDT                                                   | T1                                             | 2026-11-15 | ✔      |
| USDT mainnet | Transfer behaviour                 | `transfer` and `transferFrom` return no value                        | T1; mainnet fork test                          | 2026-11-15 | ✔      |
| USDC testnet | Contract                           | `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`                         | C1; CODE = 1798 bytes                          | 2026-11-15 | ✔      |
| USDC testnet | Decimals                           | 6                                                                    | CALL                                           | 2026-11-15 | ✔      |
| USDC testnet | `name()` / `version()`             | `USDC` / `2`                                                         | CALL                                           | 2026-11-15 | ✔      |
| USDC testnet | `DOMAIN_SEPARATOR()`               | `0xb90e5057db141a932946e64d09ccb7ffc9b00bd79fec26f698d29af0c83320a6` | CALL                                           | 2026-11-15 | ✔      |
| USDC testnet | EIP-2612 `permit` / `nonces`       | available; `nonces(0x0)` returns 0                                   | CALL                                           | 2026-11-15 | ✔      |
| USDT testnet | Canonical contract                 | none found in Tether's issuer documentation                          | T1                                             | 2026-11-15 | ✗      |

### Arbitrum One

| Asset        | Fact                         | Value                                                                  | Source                                  | Date       | Status |
| ------------ | ---------------------------- | ---------------------------------------------------------------------- | --------------------------------------- | ---------- | ------ |
| USDC mainnet | Contract                     | `0xaf88d065e77c8cC2239327C5EDb3A432268e5831`                           | C1; CODE = 1852 bytes                   | 2026-11-15 | ✔      |
| USDC mainnet | Decimals                     | 6                                                                      | CALL via `https://arb1.arbitrum.io/rpc` | 2026-11-15 | ✔      |
| USDC mainnet | `name()` / `version()`       | `USD Coin` / `2`                                                       | CALL                                    | 2026-11-15 | ✔      |
| USDC mainnet | `DOMAIN_SEPARATOR()`         | `0x08d11903f8419e68b1b8721bcbe2e9fc68569122a77ef18c216f10b3b5112c78`   | CALL                                    | 2026-11-15 | ✔      |
| USDC mainnet | EIP-2612 `permit` / `nonces` | available; `nonces(0x0)` returns 0                                     | CALL                                    | 2026-11-15 | ✔      |
| USDC mainnet | Native or bridged            | Native Circle USDC                                                     | C1                                      | 2026-11-15 | ✔      |
| USDT mainnet | Contract                     | `0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9`                           | U1; CODE = 2141 bytes                   | 2026-11-15 | ✔      |
| USDT mainnet | Decimals                     | 6                                                                      | CALL                                    | 2026-11-15 | ✔      |
| USDT mainnet | `name()`                     | `USD₮0`                                                                | CALL                                    | 2026-11-15 | ✔      |
| USDT mainnet | EIP-712 version              | `1`, derived from the domain separator; `version()` itself reverts     | CALL; domain reconstruction             | 2026-11-15 | ✔      |
| USDT mainnet | `DOMAIN_SEPARATOR()`         | `0x566af68fb471b22d6421762f84aa7bd761c670a2e4d5c8a47d4085d5957b127c`   | CALL                                    | 2026-11-15 | ✔      |
| USDT mainnet | EIP-2612 `permit` / `nonces` | available; `nonces(0x0)` returns 0                                     | CALL                                    | 2026-11-15 | ✔      |
| USDT mainnet | Native or bridged            | USDT0 omnichain representation, 1:1 backed by Tether USDT              | U1                                      | 2026-11-15 | ✔      |
| USDT mainnet | Issuer                       | USDT0 (Everdawn Labs); Tether transitioned contract ownership to USDT0 | U1                                      | 2026-11-15 | ✔      |
| USDC testnet | Contract                     | `0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d`                           | C1; CODE = 1798 bytes                   | 2026-11-15 | ✔      |
| USDC testnet | Decimals                     | 6                                                                      | CALL                                    | 2026-11-15 | ✔      |
| USDC testnet | `name()` / `version()`       | `USD Coin` / `2`                                                       | CALL                                    | 2026-11-15 | ✔      |
| USDC testnet | `DOMAIN_SEPARATOR()`         | `0x85944e1292d007732838d6eadfa67589b78ffcededbd4df60488d0af251308bb`   | CALL                                    | 2026-11-15 | ✔      |
| USDC testnet | EIP-2612 `permit` / `nonces` | available; `nonces(0x0)` returns 0                                     | CALL                                    | 2026-11-15 | ✔      |
| USDT testnet | Canonical contract           | none found in USDT0 or Tether issuer documentation                     | U1; T1                                  | 2026-11-15 | ✗      |

### Arc

| Asset                | Fact                         | Value                                                                | Source                                    | Date       | Status |
| -------------------- | ---------------------------- | -------------------------------------------------------------------- | ----------------------------------------- | ---------- | ------ |
| USDC mainnet         | Contract                     | `0x3600000000000000000000000000000000000000`                         | A1; C1; CODE = 1798 bytes                 | 2026-11-15 | ✔      |
| USDC mainnet         | Decimals                     | 6 (ERC-20 interface; native gas balances use 18 decimals)            | CALL via `https://rpc.mainnet.arc.io`; A2 | 2026-11-15 | ✔      |
| USDC mainnet         | `name()` / `version()`       | `USDC` / `2`                                                         | CALL                                      | 2026-11-15 | ✔      |
| USDC mainnet         | `DOMAIN_SEPARATOR()`         | `0x940506929bba468048a19b567f4f0d534714bc06604b5c3017e5d16785ccdf84` | CALL                                      | 2026-11-15 | ✔      |
| USDC mainnet         | EIP-2612 `permit` / `nonces` | available; `nonces(0x0)` returns 0                                   | CALL                                      | 2026-11-15 | ✔      |
| USDC mainnet         | Native or bridged            | Native Arc USDC; the ERC-20 interface wraps the native balance       | A1; A2                                    | 2026-11-15 | ✔      |
| USDC testnet         | Contract                     | `0x3600000000000000000000000000000000000000`                         | A1; C1; CODE = 1798 bytes                 | 2026-11-15 | ✔      |
| USDC testnet         | Decimals                     | 6 (ERC-20 interface; native gas balances use 18 decimals)            | CALL via `https://rpc.testnet.arc.io`; A2 | 2026-11-15 | ✔      |
| USDC testnet         | `name()` / `version()`       | `USDC` / `2`                                                         | CALL                                      | 2026-11-15 | ✔      |
| USDC testnet         | `DOMAIN_SEPARATOR()`         | `0x361191522483d32a83e70ae7183b4b9629442c13a78bc9921d6f707911c8c6b0` | CALL                                      | 2026-11-15 | ✔      |
| USDC testnet         | EIP-2612 `permit` / `nonces` | available; `nonces(0x0)` returns 0                                   | CALL                                      | 2026-11-15 | ✔      |
| USDT mainnet/testnet | Canonical contract           | none; USDC is the native dollar asset                                | A1; A2                                    | 2026-11-15 | ✗      |

### BNB Chain

| Asset                              | Fact                         | Value                                           | Source                                                          | Date       | Status |
| ---------------------------------- | ---------------------------- | ----------------------------------------------- | --------------------------------------------------------------- | ---------- | ------ |
| USDC mainnet (Circle canonical)    | Contract                     | none; Circle's USDC list has no BNB Chain entry | C1                                                              | 2026-11-15 | ✗      |
| USDC mainnet (Binance-Peg)         | Contract                     | `0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d`    | BscScan verified contract; on-chain CODE = 1596 bytes           | 2026-11-15 | ◇      |
| USDC mainnet (Binance-Peg)         | Decimals                     | 18                                              | CALL via `https://bsc-rpc.publicnode.com`                       | 2026-11-15 | ✔      |
| USDC mainnet (Binance-Peg)         | `name()`                     | `USD Coin`                                      | CALL                                                            | 2026-11-15 | ✔      |
| USDC mainnet (Binance-Peg)         | EIP-2612 `permit` / `nonces` | not available; both revert                      | CALL                                                            | 2026-11-15 | ✗      |
| USDC mainnet (Binance-Peg)         | Native or bridged            | Bridged Binance-Peg token, not Circle-issued    | BscScan; C1                                                     | 2026-11-15 | ◇      |
| USDT mainnet (Binance-Peg BSC-USD) | Contract                     | `0x55d398326f99059fF775485246999027B3197955`    | B1; B2; CODE = 4413 bytes                                       | 2026-11-15 | ✔      |
| USDT mainnet (Binance-Peg BSC-USD) | Decimals                     | 18                                              | CALL                                                            | 2026-11-15 | ✔      |
| USDT mainnet (Binance-Peg BSC-USD) | `name()`                     | `Tether USD`                                    | CALL                                                            | 2026-11-15 | ✔      |
| USDT mainnet (Binance-Peg BSC-USD) | EIP-2612 `permit` / `nonces` | not available; both revert                      | CALL                                                            | 2026-11-15 | ✗      |
| USDT mainnet (Binance-Peg BSC-USD) | Native or bridged            | Binance-Peg wrapped token; not Tether-issued    | B1; B2; T1                                                      | 2026-11-15 | ✔      |
| USDT mainnet (Binance-Peg BSC-USD) | Issuer                       | Binance                                         | B1; B2                                                          | 2026-11-15 | ✔      |
| USDT testnet                       | Contract                     | `0x337610d27c682E347C9cD60BD4b3b107C9d34dDd`    | On-chain only; no issuer documentation found; CODE = 3969 bytes | 2026-11-15 | ◇      |
| USDT testnet                       | Decimals                     | 18                                              | CALL via `https://bsc-testnet-rpc.publicnode.com`               | 2026-11-15 | ✔      |
| USDT testnet                       | `name()`                     | `USDT Token`                                    | CALL                                                            | 2026-11-15 | ◇      |
| USDT testnet                       | EIP-2612 `permit` / `nonces` | not available; both revert                      | CALL                                                            | 2026-11-15 | ✗      |

### Robinhood Chain

| Asset                              | Fact                   | Value                                                                                                                  | Source                                                 | Date       | Status |
| ---------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ---------- | ------ |
| USDC mainnet/testnet               | Canonical contract     | none; the official token page lists WETH and USDG only                                                                 | R1                                                     | 2026-11-15 | ✗      |
| USDT mainnet/testnet               | Canonical contract     | none; the official token page lists WETH and USDG only                                                                 | R1                                                     | 2026-11-15 | ✗      |
| USDC mainnet (third-party bridged) | Contract               | `0x80e0e24718dbFcad49ECAA6F1e6C89A190586cA8` reported by a third-party payment integration; 835 bytes of code on-chain | Third-party documentation, not an issuer page; CODE    | 2026-11-15 | ◇      |
| USDC mainnet (third-party bridged) | Decimals, symbol, name | 6; `USDC`; `USD Coin`                                                                                                  | CALL via `https://rpc.mainnet.chain.robinhood.com`     | 2026-11-15 | ✔      |
| USDG mainnet (not a Ferry asset)   | Contract               | `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`; 6 decimals; `name()` = `Global Dollar`; EIP-2612 domain present          | R1; CALL via `https://rpc.mainnet.chain.robinhood.com` | 2026-11-15 | ✔      |

## Decision memo: Robinhood Chain and BNB Chain

### Robinhood Chain: skip the route

Robinhood Chain is live at chain ID 4663 (mainnet) and 46630 (testnet), with
ETH as gas and a public RPC at `https://rpc.mainnet.chain.robinhood.com` (R2).
The chain facts are usable, and the canonical CREATE2 factory is present.

The blocker is the asset. Robinhood's official token-contract page lists only
WETH (`0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73`) and USDG
(`0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`) (R1). Circle's USDC contract list
has no Robinhood Chain entry (C1). Tether's supported protocols list has no
Robinhood Chain entry (T1). Third-party pages report a bridged USDC at
`0x80e0e24718dbFcad49ECAA6F1e6C89A190586cA8`; the contract exists on-chain with
6 decimals, but no issuer document confirms it, and a bridged representation is
not the canonical token Ferry requires.

**Recommendation: skip.** Do not show the route. Revisit only if Circle or
Tether publishes a contract on Robinhood Chain and a testnet round trip passes
the route's finality and permit checks. USDG is a Paxos-issued dollar token, not
USDC or USDT, so it is not a substitute for this route without a product
decision.

Re-checked with the paid Robinhood endpoint on 2026-11-16: host
`robinhood-mainnet.g.alchemy.com`, chain ID 4663 ok, canonical CREATE2 factory
present, no USDC token contract in the configuration, and a 10-block
`eth_getLogs` cap. Circle and Tether still list no Robinhood contract.

A Chainlink **USDC/USD feed does exist** on Robinhood Chain:
`0x9e6f4605992a899eE2999999F3Ec80C41F452546`, 8 decimals, 86,400 s heartbeat,
0.5% deviation. The on-chain read returned `99976000` and `updatedAt`
1794758045 on 2026-11-16. A price source is therefore not the blocker; the
issuer-documented token is. Keep the route skipped.

### Arc: paid endpoint check

The paid Arc endpoint `arc-mainnet.g.alchemy.com` returned chain ID 5042, the
canonical factory, the USDC token, and a 10-block `eth_getLogs` cap on
2026-11-16. Circle lists Arc USDC; Tether does not. A Chainlink USDC/USD feed is
present. The route stays enabled, but wide log scans should use the public Arc
primary endpoint because the paid endpoint's 10-block cap is tip-only.

### BNB Chain: ship USDT, skip USDC

USDC: Circle's USDC contract list has no BNB Chain entry (C1). The token
commonly called USDC on BNB Chain is Binance-Peg USDC at
`0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d`, a bridged token with 18 decimals
and no permit. It is not the canonical Circle USDC. **Skip the USDC route.**

USDT: Tether's supported protocols page lists BNB Smart Chain, but the only
contract it gives there is XAU₮; it gives no USD₮ contract (T1). The token used
as USDT on BNB Chain is Binance-Peg BSC-USD at
`0x55d398326f99059fF775485246999027B3197955`, issued by Binance, with 18 decimals
and no EIP-2612 (B1, B2). Binance documents it as a wrapped BEP20 token in its
Proof of Collateral page (B1). It is therefore the de facto canonical USDT on
BNB Chain, but not a Tether-issued token.

**Recommendation: ship USDT · BNB with the Binance-Peg disclosure, and keep USDC
· BNB disabled.** The 18-decimal path is already exercised by the property
tests, and the route uses approve plus lock. If the product decides that only
Tether-issued USDT is acceptable, **wait** instead; the chain facts are ready,
but the asset gate is not met.

## Deployment data

`htlcAddress`, `deployBlock` and `relayCostUsd` live in this package. They are
`null` in the data file until a reviewed deployment change fills them.

| Fact                               | Value                                                                                    | Source                                                                                                    | Date       | Status |
| ---------------------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ---------- | ------ |
| Salt                               | `keccak256("ferry-htlc.v1")`                                                             | `packages/htlc-evm/script/Deploy.s.sol`; `packages/htlc-evm/README.md`                                    | 2026-11-16 | ✔      |
| Init-code hash                     | `0xd17effec64b5a29aadba48b4f69268a12e2316c04fbef16877c43b2595d0e430`                     | `packages/htlc-evm/README.md`; `preparation/Ferry_Blueprint.md` §18                                       | 2026-11-16 | ✔      |
| Predicted CREATE2 address          | `0x8b968625F983420B571C102eC0b57F7e509c916e` on every network with the canonical factory | `packages/htlc-evm/README.md`; `preparation/Ferry_Blueprint.md` §18; recomputed by `predictHtlcAddress()` | 2026-11-16 | ✔      |
| Mainnet and testnet `htlcAddress`  | `null` until a reviewed deployment                                                       | No deployment of the current bytecode                                                                     | 2026-11-16 | ✗      |
| Mainnet and testnet `deployBlock`  | `null` until a reviewed deployment                                                       | No deployment of the current bytecode                                                                     | 2026-11-16 | ✗      |
| Mainnet and testnet `relayCostUsd` | `null` until measured after deployment                                                   | No mainnet deployment                                                                                     | 2026-11-16 | ✗      |

`loadChainConfig().chains` keeps both networks so the deploy scripts can look up
a mainnet or testnet entry by `id` and `network`. `loadChainConfig().facts` and
`loadChainConfig().coreChains` follow `FERRY_NETWORK` (mainnet by default).
`coreChains` is the strict core shape; `facts` keeps the evidence, price feeds
and deployment fields. A configured address that does not match the prediction
is rejected. The core shape is strict and accepts `deployBlock` only when it is
a positive integer. The core output uses `0` for `relayCostUsd` while the
deployment fact is null; treat `0` as unmeasured, not as a real cost.

## RPC overrides and preflight

Paid RPC endpoints are optional and live only in `.env.local`. The names are
`RPC_URL_BASE`, `RPC_URL_ETHEREUM`, `RPC_URL_ARBITRUM`, `RPC_URL_ARC`,
`RPC_URL_BNB` and `RPC_URL_ROBINHOOD`; each is a comma list. They are placed
before the public URLs for the selected `FERRY_NETWORK`. The value is never
written to a file and never printed: errors name the variable, and logs print
only the host name with the path and query removed.

The scripts do not auto-load `.env.local`, because that file also holds keys.
Export only the `RPC_URL_*` lines before running them:

```bash
while IFS= read -r line; do
  case "$line" in RPC_URL_*=*) export "$line" ;; esac
done < ../.env.local
```

Never `cat`, copy or print the file.

`loadChainConfig()` exposes `rpcEndpoints` with `host`, `source` and the measured
`maxLogRange` for an override. `verify` probes the override cap and reports the
host only. The preflight script uses the same data to print a go/no-go table,
read solver balances and print the Minimum-tier funding gaps. The funding
template is `preparation/PREFLIGHT_FUNDING_CHECKLIST.md`.

Run the preflight with:

```bash
pnpm --dir scripts/preflight preflight
# or
pnpm --filter @ferry/chain-config preflight
```

A root `pnpm preflight` alias needs a one-line change in the root
`package.json`, which this package does not own.

## Paid endpoints (measured)

Measured on 2026-11-16 from the paid RPC overrides with
`pnpm --filter @ferry/chain-config measure-rpc`. Only host names are recorded;
no URL, path, query or key is written.

| Chain           | Host                              | Chain ID | `eth_getLogs` cap | Median latency (20 calls) | Burst (20 parallel) | `safe` | `finalized` |
| --------------- | --------------------------------- | -------: | ----------------: | ------------------------: | ------------------- | ------ | ----------- |
| Base            | `rpc.ankr.com` (Base key)         |     8453 |           100,000 |                  156.8 ms | 20/20 in 1,050 ms   | yes    | yes         |
| Ethereum        | `eth-mainnet.nodereal.io`         |        1 |            50,000 |                  337.2 ms | 20/20 in 2,038 ms   | yes    | yes         |
| Arbitrum One    | `rpc.ankr.com` (Arbitrum key)     |    42161 |           500,000 |                  221.2 ms | 16/20 in 2,028 ms   | yes    | yes         |
| Arc             | `arc-mainnet.g.alchemy.com`       |     5042 |                10 |                  156.5 ms | 20/20 in 2,718 ms   | yes    | yes         |
| BNB Chain       | `bsc-mainnet.nodereal.io`         |       56 |            50,000 |                  279.4 ms | 20/20 in 1,641 ms   | yes    | yes         |
| Robinhood Chain | `robinhood-mainnet.g.alchemy.com` |     4663 |                10 |                  153.8 ms | 20/20 in 1,952 ms   | yes    | yes         |

Notes:

- The Base Ankr cap varied between 100,000 and 1,000 blocks in later runs. Treat
  1,000 as the conservative floor until repeated measurements settle.
- Arbitrum Ankr answered 16 of 20 burst calls; four were rate-limited. The
  normal path still works, but the solver should retry and keep the public
  fallback.
- Arc and Robinhood Alchemy expose a **10-block** `eth_getLogs` cap on this plan.
  That is suitable for watching the tip, not for wide historical scans; keep the
  public primary endpoints for those.
- All six hosts returned the expected chain ID and both `safe` and `finalized`
  block tags.
- The first-position public caps in `src/data/chains.json` remain the measured
  public values (Base 50,000; Ethereum 10,000; Arbitrum 100,000; Arc 10,000;
  BNB 50,000; Robinhood 100,000). Paid caps stay at runtime in `rpcEndpoints`.
- The paid-override `verify` run also returned 230 checked, 17 skipped,
  0 differences. One Base Ankr cap probe was unknown because of a transient
  rate limit, so the table above uses the dedicated `measure-rpc` run.

## S-17 price feeds

For each enabled mainnet chain, the table records a documented Chainlink
USDC/USD or USDT/USD feed. The address, decimals, `description()` and
`latestRoundData()` were read on chain on 2026-11-16. The heartbeat and
deviation threshold come from Chainlink's reference data directory. Testnets
and Robinhood Chain have no recorded feed and use the fallback source.

| Chain            | Pair     | Address                                      | Decimals | Heartbeat | Deviation | Latest answer            | `updatedAt` | Read at                   | Source                             | Date       | Status |
| ---------------- | -------- | -------------------------------------------- | -------- | --------- | --------- | ------------------------ | ----------- | ------------------------- | ---------------------------------- | ---------- | ------ |
| Base             | USDC/USD | `0x7e860098F58bBFC8648a4311b374B1D669a2bc6B` | 8        | 86,400 s  | 0.3%      | `99976257` ($0.99976257) | 1794747564  | 2026-11-16T00:39:20+01:00 | L1; on-chain                       | 2026-11-16 | ✔      |
| Ethereum         | USDC/USD | `0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6` | 8        | 82,800 s  | 0.25%     | `99978160` ($0.99978160) | 1794704099  | 2026-11-16T00:39:20+01:00 | L2; on-chain                       | 2026-11-16 | ✔      |
| Ethereum         | USDT/USD | `0x3E7d1eAB13ad0104d2750B8863b489D65364e32D` | 8        | 86,400 s  | 0.25%     | `99932677` ($0.99932677) | 1794754343  | 2026-11-16T00:39:20+01:00 | L2; on-chain                       | 2026-11-16 | ✔      |
| Arbitrum One     | USDC/USD | `0x50834F3163758fcC1Df9973b6e91f0F0F0434aD3` | 8        | 255 s     | 0.1%      | `99972538` ($0.99972538) | 1794785693  | 2026-11-16T00:39:20+01:00 | L3; on-chain                       | 2026-11-16 | ✔      |
| Arbitrum One     | USDT/USD | `0x3f3f5dF88dC9F13eac63DF89EC16ef6e7E25DdE7` | 8        | 255 s     | 0.1%      | `99943948` ($0.99943948) | 1794785849  | 2026-11-16T00:39:20+01:00 | L3; on-chain                       | 2026-11-16 | ✔      |
| Arc              | USDC/USD | `0x84EA90AC252Dc437031461836DB5164219147905` | 8        | 86,400 s  | 0.5%      | `99979737` ($0.99979737) | 1794756506  | 2026-11-16T00:39:20+01:00 | L4; on-chain                       | 2026-11-16 | ✔      |
| BNB Chain        | USDC/USD | `0x51597f405303C4377E36123cBc172b13269EA163` | 8        | 900 s     | 0.1%      | `99972468` ($0.99972468) | 1794785459  | 2026-11-16T00:39:20+01:00 | L5; on-chain                       | 2026-11-16 | ✔      |
| BNB Chain        | USDT/USD | `0xB97Ad0E74fa7d920791E90258A6E2085088b4320` | 8        | 900 s     | 0.1%      | `99946275` ($0.99946275) | 1794785127  | 2026-11-16T00:39:20+01:00 | L5; on-chain                       | 2026-11-16 | ✔      |
| Base Sepolia     | USDC/USD | none recorded                                | —        | —         | —         | —                        | —           | 2026-11-16                | No testnet feed recorded; fallback | 2026-11-16 | ✗      |
| Ethereum Sepolia | USDC/USD | none recorded                                | —        | —         | —         | —                        | —           | 2026-11-16                | No testnet feed recorded; fallback | 2026-11-16 | ✗      |
| Arbitrum Sepolia | USDC/USD | none recorded                                | —        | —         | —         | —                        | —           | 2026-11-16                | No testnet feed recorded; fallback | 2026-11-16 | ✗      |
| Arc Testnet      | USDC/USD | none recorded                                | —        | —         | —         | —                        | —           | 2026-11-16                | No testnet feed recorded; fallback | 2026-11-16 | ✗      |
| BNB Testnet      | USDT/USD | none recorded                                | —        | —         | —         | —                        | —           | 2026-11-16                | No testnet feed recorded; fallback | 2026-11-16 | ✗      |
| Robinhood Chain  | USDC/USD | `0x9e6f4605992a899eE2999999F3Ec80C41F452546` | 8        | 86,400 s  | 0.5%      | `99976000` ($0.99976000) | 1794758045  | 2026-11-16T12:39:48Z      | L6; paid endpoint                  | 2026-11-16 | ✔      |

The latest answer is a snapshot and changes. `verify` re-reads
`latestRoundData()` and checks the answer is positive, `updatedAt` is present
and the feed is younger than twice its heartbeat. The display view exposes only
the source name ("Chainlink USDC/USD", "Chainlink USDT/USD" or the fallback),
never the feed address.

Robinhood Chain has a Chainlink feed but no issuer-documented USDC/USDT token,
so the route remains skipped; the feed is recorded here for the watch only.

## Verification run

The opt-in `verify` script re-read every ✔ fact over public RPCs on 2026-11-16:

```
Checked 230 facts, skipped 17, differences 0.

Routes:
  usdc:base: eligible
  usdc:ethereum: eligible
  usdt:ethereum: eligible
  usdc:arbitrum: eligible
  usdt:arbitrum: eligible
  usdc:arc: eligible
  usdc:bnb: disabled (token address is reported)
  usdt:bnb: eligible
```

The 17 skips are 12 undeployed HTLC checks, the four Arc and Robinhood dRPC
endpoints that reject `eth_getLogs`, and the USDT0 `version()` check whose
value is reconstructed from the domain separator instead. The Arc and Robinhood
dRPC endpoints remain listed as read-only fallbacks because no free public
log-capable endpoint was found. The Base `mainnet.base.org` endpoint is recorded
as reported because it rate-limits bursts; the publicnode and 1RPC endpoints are
the verified log sources. The script sends no transaction.

## Limitations and follow-ups

- `FerryHTLC` is not deployed. The facts record `htlcAddress: null`; the
  core-shaped output resolves the CREATE2 prediction and rejects a configured
  address that does not match it. Add the deployment address and block after a
  reviewed mainnet deployment.
- `relayCostUsd` is `null` in the facts. The core-shaped output uses `0` until it
  is measured; the quote layer must treat `0` as unmeasured and use a live gas
  estimate.
- Testnet price feeds are not recorded. The display view uses the fallback
  source on testnets, and the solver must use the fallback price path there.
- The core-shaped `coreChains` omit reported or unverified assets; those remain
  visible in `facts` and `chains` with their evidence. This keeps a reported
  token such as BNB USDC out of an adapter's asset list even though it is
  documented in the facts.
- Block times are typical measured values, not guarantees. Re-run `verify`
  before mainnet.
- Public RPC limits change. Re-probe `eth_getLogs` before relying on a wide scan.
- BNB Chain USDT is Binance-Peg, not Tether-issued. Any UI or FAQ must say so.
- Arc's native gas token is USDC with 18 decimals; the ERC-20 interface used by
  the contract is 6 decimals. Do not mix the two.
- Robinhood Chain's third-party bridged USDC is not issuer-documented. Keep the
  route hidden until a primary source exists.
