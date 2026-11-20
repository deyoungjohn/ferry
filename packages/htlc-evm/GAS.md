# FerryHTLC Fork Gas Report

Updated **2026-11-19** for contract release update (`release(bytes32)`).

- **Deterministic CREATE2 factory:** `0x4e59b44847b379578588920cA78FbF26c0B4956C`
- **Salt:** `keccak256("ferry-htlc.v1")`
- **New predicted address (all chains):** `0xfC28c2596C553353578a5a444d2316514009DAdF`
- **New init code hash:** `0x4ca8e6ac893b54008f3c1b9064f6670a9bbf17f55e0f1ef71888c802ce418eea`
- **Superseded address (retained for recovery):** `0x8b968625F983420B571C102eC0b57F7e509c916e`

## Measured Gas Used (USDC / Token Calls)

| Chain           | Chain ID | RPC Used                                  | Address Matched |   `lock` | `lockWithIntent` | `claim` | `refund` | `release` | Notes / Token Quirks                                                                                                                                                                                                                                                 |
| --------------- | -------- | ----------------------------------------- | --------------- | -------: | ---------------: | ------: | -------: | --------: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Base            | 8453     | `https://base-rpc.publicnode.com`         | Predicted       |  212,455 |          256,158 |  78,820 |   63,182 |    44,944 | Native Circle USDC (6 dec, EIP-2612 permit); `release` callable by solver recipient returns funds to sender immediately                                                                                                                                              |
| Ethereum        | 1        | `https://ethereum-rpc.publicnode.com`     | Predicted       |  212,576 |          256,376 |  78,909 |   63,271 |    45,020 | Native Circle USDC (6 dec, EIP-2612 permit)                                                                                                                                                                                                                          |
| Ethereum (USDT) | 1        | `https://ethereum-rpc.publicnode.com`     | Predicted       |  213,014 |              N/A |  80,009 |   64,383 |    46,120 | Void-return `approve`/`transfer`/`transferFrom`, no permit (`SafeERC20` ok)                                                                                                                                                                                          |
| Arbitrum        | 42161    | `https://arb1.arbitrum.io/rpc`            | Predicted       |  212,443 |          256,122 |  78,820 |   63,099 |    44,944 | Native Circle USDC (6 dec, EIP-2612 permit)                                                                                                                                                                                                                          |
| Arbitrum (USDT) | 42161    | `https://arb1.arbitrum.io/rpc`            | Predicted       |  215,074 |          257,673 |  77,778 |   62,057 |    44,180 | Arbitrum USD₮0 (6 dec, EIP-2612 permit; measured 2026-11-16)                                                                                                                                                                                                         |
| Arc             | 5042     | `https://rpc.mainnet.arc.io`              | Predicted       | Unproven |              N/A |     N/A |      N/A |       N/A | `0x3600…0000` native-USDC precompile reverted inside `lock()` on Anvil (`revm` lacks Arc precompile); opt-in read-only RPC check verified `balanceOf`/`allowance`/`approve` gas (`56,241`). **Arc `lock` is unproven until a human runs one real Arc testnet lock.** |
| BNB (USDC)      | 56       | `https://bsc-rpc.publicnode.com`          | Predicted       |  210,837 |              N/A |  75,496 |   59,831 |    43,890 | Binance-Peg USDC (18 dec, no permit; measured 2026-11-16)                                                                                                                                                                                                            |
| BNB (USDT)      | 56       | `https://bsc-rpc.publicnode.com`          | Predicted       |  203,585 |              N/A |  68,228 |   52,563 |    39,210 | Binance-Peg BSC-USD (USDT, 18 dec, no permit; approve+lock ok, measured 2026-11-16)                                                                                                                                                                                  |
| Robinhood       | 4663     | `https://rpc.mainnet.chain.robinhood.com` | Predicted       |      N/A |              N/A |     N/A |      N/A |       N/A | No USDC/USDT token configured yet; CREATE2 deploy predicted                                                                                                                                                                                                          |

## `release(bytes32)` Gas Profile

- **Min:** 28,806 gas
- **Avg:** 44,944 gas
- **Median:** 44,264 gas
- **Max:** 74,317 gas

## Estimated Relay Cost Formula

Relay cost in USD is computed from live/configured inputs (never hard-coded prices):

```text
relayCostUsd(gasUsed, gasPriceWei, nativeTokenPriceUsd, l1DataFeeUsd = 0) =
    (gasUsed * gasPriceWei / 1e18) * nativeTokenPriceUsd + l1DataFeeUsd
```

Where:

- `gasUsed`: measured execution gas for the relayed call (`lockWithIntent` ≈ 258,200 gas, `claim` ≈ 78,900 gas, `refund` ≈ 58,400 gas, `lock` ≈ 212,500 gas).
- `gasPriceWei`: effective gas price (`baseFeePerGas + maxPriorityFeePerGas`) in wei, read from the chain RPC (`eth_gasPrice` / `eth_feeHistory`).
- `nativeTokenPriceUsd`: USD price of the chain's native gas token (`ETH`, `BNB`, or `USDC` = `1.0` on Arc), supplied by the solver's price feed/config.
- `l1DataFeeUsd`: L1 calldata/blob posting fee in USD for OP-Stack / Arbitrum rollups (Base, Arbitrum), `0` on L1s/sidechains.

## L2 Data Fees (Measured 2026-11-16)

Measured read-only for `claim(bytes32,bytes32)` calldata against live public RPCs via `estimateRelayCostUsd` / `estimateArbitrumGasComponents`:

| Chain                | Predeploy / Precompile                                                               | RPC Used                       | Gas Price / Base Fee | L1 Data Fee (wei) | Notes                                                                         |
| -------------------- | ------------------------------------------------------------------------------------ | ------------------------------ | -------------------- | ----------------: | ----------------------------------------------------------------------------- |
| Base                 | `0x420000000000000000000000000000000000000F` (`GasPriceOracle.getL1Fee`)             | `https://mainnet.base.org`     | `6,000,000` wei      |   `2,322,278,835` | At \$3,000/ETH & 78,808 gas: L2 `\$0.001419` + L1 `\$0.000007` = `\$0.001426` |
| Arbitrum             | `0x00000000000000000000000000000000000000C8` (`NodeInterface.gasEstimateComponents`) | `https://arb1.arbitrum.io/rpc` | `20,144,000` wei     |  `29,712,400,000` | `gasEstimateForL1 = 1,475`, `l1BaseFeeEstimate = 7,869,482` wei               |
| Ethereum / BNB / Arc | None                                                                                 | —                              | —                    |               `0` | No separate L1 data fee component                                             |

## Reproducing

Run the opt-in fork suite (requires outbound RPC access):

```bash
FERRY_FORK_TESTS=1 pnpm --filter @ferry/htlc-evm exec vitest run test/fork.test.ts
```

Run the opt-in L2 data-fee live RPC check:

```bash
FERRY_L2_COST_LIVE=1 pnpm --filter @ferry/chain-evm exec vitest run test/l2-cost.test.ts
```

Print `forge verify-contract` commands per chain (does not execute them):

```bash
pnpm --filter @ferry/htlc-evm exec tsx scripts/verify-commands.ts
```
