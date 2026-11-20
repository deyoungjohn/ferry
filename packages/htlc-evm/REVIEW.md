# FerryHTLC Independent Review Checklist

Target contract: `packages/htlc-evm/src/FerryHTLC.sol` (Solidity `0.8.28`, `via_ir = true`, OpenZeppelin `5.6.1`)  
Deterministic CREATE2 address: `0xfC28c2596C553353578a5a444d2316514009DAdF` (salt `keccak256("ferry-htlc.v1")`, factory `0x4e59b44847b379578588920cA78FbF26c0B4956C`; superseded address `0x8b968625F983420B571C102eC0b57F7e509c916e` retained for recovery).

Estimated review time: **< 1 hour** (~230 lines, single contract, no inheritance beyond `ReentrancyGuard`).

---

## 1. What the contract guarantees

- **Immutability & zero admin surface:** No owner, no `pause()`, no proxy/upgradeability, no token allow-list, and no fee extraction. Once deployed via CREATE2, the code cannot change.
- **Single settlement per lock:** Every lock is keyed by `id = keccak256(abi.encode(sender, hashLock))` and transitions `None -> Locked -> Claimed | Refunded` at most once. `claim` and `refund` both require `state == State.Locked` and update `state` before transferring tokens (`nonReentrant` + checks-effects-interactions).
- **Permissionless settlement to fixed parties:** Anyone may submit `claim(id, secret)` or `refund(id)`, but tokens only ever transfer to `lockData.recipient` (on `claim`) or `lockData.sender` (on `refund`).
- **Claims remain valid after deadline:** `claim` does not check `block.timestamp < lockData.deadline`. After `deadline`, both `claim` and `refund` are valid, and the first mined transaction wins. `refund` strictly requires `block.timestamp >= lockData.deadline`.
- **SHA-256 preimage compatibility:** `claim` checks `sha256(abi.encodePacked(secret)) == lockData.hashLock` with `bytes32 secret`, matching Bitcoin Cash `OP_SHA256` on 32-byte preimages.
- **Intent & replay protection (`lockWithIntent`):**
  - `DOMAIN_SEPARATOR()` recomputes dynamically if `block.chainid != _CACHED_CHAIN_ID`, preventing cross-chain / hard-fork replay.
  - Signatures are verified via `SignatureChecker.isValidSignatureNow`, supporting both EOAs and ERC-1271 smart-contract wallets.
  - `intentDeadline` bounds signature validity (`block.timestamp <= intentDeadline`).
  - `_tryPermit` wraps `IERC20Permit.permit` in `try/catch` so a front-run permit cannot brick `lockWithIntent` when allowance is already set.
  - Replaying the same `(owner, hashLock)` reverts with `AlreadyExists()`.

## 2. What the contract assumes about tokens

- **Standard ERC-20 conservation (no fee-on-transfer, no rebasing):** `FerryHTLC` records the requested `amount` and transfers via `SafeERC20.safeTransferFrom` / `safeTransfer` without checking `balanceAfter - balanceBefore == amount`.
  - **Fee-on-transfer tokens** leave a balance shortfall, causing later `claim`/`refund` calls to revert.
  - **Rebasing tokens** can cause shortfalls on downward rebases or stranded dust on upward rebases.
  - **Mitigation:** Only canonical stablecoins configured in `@ferry/chain-config` (USDC / verified USDT) are accepted by the solver and UI.
- **Void-return ERC-20s (e.g., Ethereum USDT):** Supported via `SafeERC20`.
- **Tokens without EIP-2612 `permit` (e.g., Ethereum USDT, BNB USDT):** `_tryPermit` catches the revert and falls back to pre-existing allowance (`approve` + `lock` or `approve` + `lockWithIntent`).

## 3. Known caveats per chain (from `GAS.md`)

- **Base (`8453`), Ethereum (`1`, USDC), Arbitrum (`42161`):** Circle native USDC (6 decimals, EIP-2612 `permit` supported). Verified on Anvil mainnet forks for `lock`, `lockWithIntent`, `claim`, and `refund`.
- **Ethereum (`1`, USDT):** 6 decimals, void-return `transfer`/`transferFrom`/`approve`, no `permit`. Verified on Anvil fork via `SafeERC20` (`approve` + `lock` + `claim`).
- **BNB Smart Chain (`56`, USDT / Binance-Peg BSC-USD):** 18 decimals, no `permit` (`approve` + `lock` + `claim` + `refund` verified on Anvil fork). Shipping route is USDT, not Binance-Peg USDC.
- **Arc (`5042`, native USDC `0x3600…0000`):** Native gas is USDC (18 decimals), while the `0x3600…0000` ERC-20 interface uses 6 decimals. Anvil's `revm` lacks the Arc precompile, so `lock()` reverts on Anvil forks; opt-in read-only RPC checks pass (`balanceOf`, `allowance`, `approve` gas), and **Arc `lock` remains unproven** until a human executes one real Arc testnet `lock` + `claim`/`refund`.
- **Robinhood (`4663`):** CREATE2 deploy verified on Anvil fork; no USDC/USDT route configured yet.

## 4. Quick verification commands

```bash
# Run Foundry unit, fuzz, and invariant suites
pnpm --filter @ferry/htlc-evm exec forge test

# Confirm abi.ts matches compiled FerryHTLC.sol
pnpm --filter @ferry/htlc-evm exec node scripts/check-abi.mjs

# Review static analysis triage
cat packages/htlc-evm/SLITHER.md
```
