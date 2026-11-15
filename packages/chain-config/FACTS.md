# Chain and token facts

Baseline date: **2026-11-15**. This file records the facts the EVM routes depend
on. The machine-readable copy is `src/data/chains.json`; every value there has a
source and a status here.

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

On-chain commands use these forms:

| Key      | Command                                                                                                                             |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| CHAIN_ID | `eth_chainId` JSON-RPC call to the listed URL                                                                                       |
| CALL     | `cast call <token> "<signature>" --rpc-url <url>`                                                                                   |
| CODE     | `cast codesize <address> --rpc-url <url>`                                                                                           |
| BLOCK    | `cast block <safe\|finalized\|latest> --field number --rpc-url <url>`                                                               |
| LOGS     | `eth_getLogs` over the last N blocks for `0x0000000000000000000000000000000000000001`; N is increased until the endpoint rejects it |

## Chain facts

### Base

| Network | Fact                      | Value                                                                      | Source                                      | Date       | Status |
| ------- | ------------------------- | -------------------------------------------------------------------------- | ------------------------------------------- | ---------- | ------ |
| mainnet | Chain ID                  | 8453 (`0x2105`)                                                            | CHAIN_ID via `https://mainnet.base.org`; O1 | 2026-11-15 | ✔      |
| mainnet | Public RPC 1              | `https://mainnet.base.org`; `eth_getLogs` cap 200 blocks                   | LOGS; CHAIN_ID                              | 2026-11-15 | ✔      |
| mainnet | Public RPC 2              | `https://base-rpc.publicnode.com`; `eth_getLogs` cap 50,000 blocks         | LOGS; CHAIN_ID                              | 2026-11-15 | ✔      |
| mainnet | Explorer                  | `https://basescan.org`                                                     | O1                                          | 2026-11-15 | ✔      |
| mainnet | Native gas token          | ETH                                                                        | O1                                          | 2026-11-15 | ✔      |
| mainnet | `safe` block tag          | works; safe block 57,937,206                                               | BLOCK                                       | 2026-11-15 | ✔      |
| mainnet | `finalized` block tag     | works; finalized block 57,933,212                                          | BLOCK                                       | 2026-11-15 | ✔      |
| mainnet | Typical block time        | 0.2 s (50-block sample)                                                    | CHAIN_ID + block timestamps                 | 2026-11-15 | ✔      |
| mainnet | Canonical CREATE2 factory | `0x4e59b44847b379578588920cA78FbF26c0B4956C`; 69 bytes of code             | CODE                                        | 2026-11-15 | ✔      |
| testnet | Chain ID                  | 84532 (`0x14a34`)                                                          | CHAIN_ID via `https://sepolia.base.org`; O1 | 2026-11-15 | ✔      |
| testnet | Public RPC 1              | `https://sepolia.base.org`; `eth_getLogs` cap 200 blocks                   | LOGS; CHAIN_ID                              | 2026-11-15 | ✔      |
| testnet | Public RPC 2              | `https://base-sepolia-rpc.publicnode.com`; `eth_getLogs` cap 50,000 blocks | LOGS; CHAIN_ID                              | 2026-11-15 | ✔      |
| testnet | Explorer                  | `https://sepolia.basescan.org`                                             | O1                                          | 2026-11-15 | ✔      |
| testnet | Native gas token          | ETH                                                                        | O1                                          | 2026-11-15 | ✔      |
| testnet | `safe` block tag          | works; safe block 59,279,851                                               | BLOCK                                       | 2026-11-15 | ✔      |
| testnet | `finalized` block tag     | works; finalized block 59,274,179                                          | BLOCK                                       | 2026-11-15 | ✔      |
| testnet | Typical block time        | 0.2 s (50-block sample)                                                    | block timestamps                            | 2026-11-15 | ✔      |
| testnet | Canonical CREATE2 factory | `0x4e59b44847b379578588920cA78FbF26c0B4956C`; 69 bytes of code             | CODE                                        | 2026-11-15 | ✔      |

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
| testnet | Public RPC 2              | `https://1rpc.io/sepolia`; `eth_getLogs` cap 50 blocks                                    | LOGS; CHAIN_ID                                                 | 2026-11-15 | ✔      |
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
| mainnet | Public RPC 2              | `https://1rpc.io/arb`; `eth_getLogs` cap 50 blocks                             | LOGS; CHAIN_ID                                            | 2026-11-15 | ✔      |
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
| testnet | Public RPC 2              | `https://data-seed-prebsc-1-s1.binance.org:8545` rejects `eth_getLogs` with `-32005` | LOGS; CHAIN_ID                                            | 2026-11-15 | ✔      |
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

| Asset                              | Fact               | Value                                                                                                         | Source                                                 | Date       | Status |
| ---------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ---------- | ------ |
| USDC mainnet/testnet               | Canonical contract | none; the official token page lists WETH and USDG only                                                        | R1                                                     | 2026-11-15 | ✗      |
| USDT mainnet/testnet               | Canonical contract | none; the official token page lists WETH and USDG only                                                        | R1                                                     | 2026-11-15 | ✗      |
| USDC mainnet (third-party bridged) | Contract           | `0x80e0e24718dbFcad49ECAA6F1e6C89A190586cA8` reported by a third-party payment integration                    | Third-party documentation, not an issuer page          | 2026-11-15 | ◇      |
| USDG mainnet (not a Ferry asset)   | Contract           | `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`; 6 decimals; `name()` = `Global Dollar`; EIP-2612 domain present | R1; CALL via `https://rpc.mainnet.chain.robinhood.com` | 2026-11-15 | ✔      |

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
`0x80e0e24718dbFcad49ECAA6F1e6C89A190586cA8`, but no issuer document confirms it,
and a bridged representation is not the canonical token Ferry requires.

**Recommendation: skip.** Do not show the route. Revisit only if Circle or
Tether publishes a contract on Robinhood Chain and a testnet round trip passes
the route's finality and permit checks. USDG is a Paxos-issued dollar token, not
USDC or USDT, so it is not a substitute for this route without a product
decision.

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

## Verification run

The opt-in `verify` script re-read every ✔ fact over public RPCs on 2026-11-15:

```
Checked 179 facts, skipped 7, differences 0.

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

The seven skips are endpoints that reject `eth_getLogs` or rate-limit bursts:
the Base primary endpoint, the Arc dRPC endpoints, the BNB testnet data-seed
endpoint and the Robinhood dRPC endpoints. They remain listed as public RPC URLs
with their measured limits; the second endpoint in each case is usable for
reads. The script sends no transaction.

## Limitations and follow-ups

- `FerryHTLC` is not deployed on mainnet. `loadChainConfig()` returns
  `htlcAddress: null`; deployment addresses must be added after mainnet
  acceptance.
- `relayCostUsd` is `null`. The quote layer must measure live gas; no estimate is
  invented here.
- Block times are typical measured values, not guarantees. Re-run `verify`
  before mainnet.
- Public RPC limits change. Re-probe `eth_getLogs` before relying on a wide scan.
- BNB Chain USDT is Binance-Peg, not Tether-issued. Any UI or FAQ must say so.
- Arc's native gas token is USDC with 18 decimals; the ERC-20 interface used by
  the contract is 6 decimals. Do not mix the two.
- Robinhood Chain's third-party bridged USDC is not issuer-documented. Keep the
  route hidden until a primary source exists.
