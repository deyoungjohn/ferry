# FerryHTLC Fork Gas Report

Measured on **2026-11-15** against `anvil --fork-url <rpc>` for each mainnet chain configured in `@ferry/chain-config`.

- **Deterministic CREATE2 factory:** `0x4e59b44847b379578588920cA78FbF26c0B4956C`
- **Salt:** `keccak256("ferry-htlc.v1")`
- **Predicted & verified address across all 6 chains:** `0x8b968625F983420B571C102eC0b57F7e509c916e`

## Measured Gas Used (USDC / Token Calls)

| Chain           | Chain ID | RPC Used                                  | Address Matched |   `lock` | `lockWithIntent` | `claim` | `refund` | Notes / Token Quirks                                                                                                                                                                                                                                                 |
| --------------- | -------- | ----------------------------------------- | --------------- | -------: | ---------------: | ------: | -------: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Base            | 8453     | `https://mainnet.base.org`                | Yes             |  212,455 |          258,166 |  78,808 |   58,382 | Native Circle USDC (6 dec, EIP-2612 permit)                                                                                                                                                                                                                          |
| Ethereum        | 1        | `https://ethereum-rpc.publicnode.com`     | Yes             |  212,576 |          258,376 |  78,909 |   58,471 | Native Circle USDC (6 dec, EIP-2612 permit)                                                                                                                                                                                                                          |
| Ethereum (USDT) | 1        | `https://ethereum-rpc.publicnode.com`     | Yes             |  213,014 |              N/A |  80,021 |        — | Void-return `approve`/`transfer`/`transferFrom`, no permit (`SafeERC20` ok)                                                                                                                                                                                          |
| Arbitrum        | 42161    | `https://arb1.arbitrum.io/rpc`            | Yes             |  212,455 |          258,158 |  78,820 |   58,382 | Native Circle USDC (6 dec, EIP-2612 permit)                                                                                                                                                                                                                          |
| Arc             | 5042     | `https://rpc.mainnet.arc.io`              | Yes             | Unproven |              N/A |     N/A |      N/A | `0x3600…0000` native-USDC precompile reverted inside `lock()` on Anvil (`revm` lacks Arc precompile); opt-in read-only RPC check verified `balanceOf`/`allowance`/`approve` gas (`56,241`). **Arc `lock` is unproven until a human runs one real Arc testnet lock.** |
| BNB Smart Chain | 56       | `https://bsc-rpc.publicnode.com`          | Yes             |  203,597 |              N/A |  68,228 |   47,790 | Binance-Peg BSC-USD (USDT, 18 dec, no permit; approve+lock ok, measured 2026-11-16)                                                                                                                                                                                  |
| Robinhood       | 4663     | `https://rpc.mainnet.chain.robinhood.com` | Yes             |      N/A |              N/A |     N/A |      N/A | No USDC/USDT token configured yet; CREATE2 deploy verified                                                                                                                                                                                                           |

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

## Reproducing

Run the opt-in fork suite (requires outbound RPC access):

```bash
FERRY_FORK_TESTS=1 pnpm --filter @ferry/htlc-evm exec vitest run test/fork.test.ts
```

Print `forge verify-contract` commands per chain (does not execute them):

```bash
pnpm --filter @ferry/htlc-evm exec tsx scripts/verify-commands.ts
```
