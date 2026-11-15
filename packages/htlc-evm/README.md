# `@ferry/htlc-evm`

Immutable, ownerless EVM hash-time-locked contract (`FerryHTLC`) for cross-chain stablecoin swaps, plus deterministic CREATE2 deployment scripts and typed ABI exports.

## Contract properties

- **Compiler:** Solidity `0.8.28`, `evm_version = "cancun"`, `via_ir = true`, `optimizer = true`, `optimizer_runs = 200`, `bytecode_hash = "none"`, `cbor_metadata = false`.
- **Dependencies:** `@openzeppelin/contracts` `5.6.1`, `forge-std` `v1.9.7`.
- **No admin:** no owner, no upgrade path, no pause, no token allow-list.
- **Permissionless settlement:** `claim` and `refund` can be called by any address and always transfer to the fixed `recipient` or `sender`. Claims remain valid after `deadline` (first valid transaction wins).
- **Gasless locking:** `lockWithIntent` verifies an EIP-712 `LockIntent` signature via OpenZeppelin `SignatureChecker` (supporting both ECDSA and ERC-1271 smart-contract wallets), wraps `IERC20Permit.permit` in `try/catch`, and uses `SafeERC20` for non-standard tokens. `DOMAIN_SEPARATOR()` recomputes dynamically if `block.chainid` changes on a chain fork.
- **Unsupported tokens:** fee-on-transfer tokens are unsupported; a lock records the requested amount, so the solver and the UI accept only the configured canonical tokens.

## Deterministic CREATE2 deployment

- **Canonical factory:** `0x4e59b44847b379578588920cA78FbF26c0B4956C`
- **Salt:** `keccak256("ferry-htlc.v1")`
- **Init code hash:** `0xd17effec64b5a29aadba48b4f69268a12e2316c04fbef16877c43b2595d0e430`
- **Predicted CREATE2 address:** `0x8b968625F983420B571C102eC0b57F7e509c916e`

To print the predicted address and init code hash without broadcasting:

```bash
forge script script/Deploy.s.sol:Deploy --sig "predict()"
```

## Scripts

- `pnpm --filter @ferry/htlc-evm build` — compile contracts (`forge build`)
- `pnpm --filter @ferry/htlc-evm test` — run Foundry tests, ABI staleness check, and Vitest ABI tests
- `pnpm --filter @ferry/htlc-evm abi` — regenerate `abi.ts` (typed ABI + bytecode hashes)
- `pnpm --filter @ferry/htlc-evm snapshot` — update `.gas-snapshot`
- `pnpm --filter @ferry/htlc-evm slither` — run Slither static analysis on `src/`
