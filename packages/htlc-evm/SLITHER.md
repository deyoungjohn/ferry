# Slither triage

- Slither `0.11.6`
- Solidity `0.8.28`, Foundry `1.9.0`
- Command: `slither . --filter-paths 'node_modules|lib|test|script'` — 7 results, all in `src/FerryHTLC.sol` (re-verified 2026-11-16: 16 contracts, 102 detectors, 0 new findings).

## Contract findings

| Detector               | Location                                                                                 | Disposition                                                                                                                                                                                                                                                                                                           |
| ---------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `arbitrary-send-erc20` | `lockWithIntent` (`src/FerryHTLC.sol#L142`)                                              | Accepted. `owner` is authenticated via an EIP-712 `LockIntent` signature verified with OpenZeppelin `SignatureChecker` (ECDSA and ERC-1271). The signed intent binds `token`, `recipient`, `amount`, `hashLock`, `deadline`, and `intentDeadline`, and `id = keccak256(abi.encode(owner, hashLock))` prevents replay. |
| `timestamp`            | `lockWithIntent` (`intentDeadline`), `refund` (`deadline`), `_validateLock` (`deadline`) | Accepted. Unix-second deadlines are required by the swap protocol; multi-hour safety margins absorb validator timestamp drift.                                                                                                                                                                                        |
| `naming-convention`    | `DOMAIN_SEPARATOR()`, `_CACHED_CHAIN_ID`, `_CACHED_DOMAIN_SEPARATOR`                     | Accepted. `DOMAIN_SEPARATOR()` follows the EIP-712/EIP-2612 convention; `_CACHED_CHAIN_ID` and `_CACHED_DOMAIN_SEPARATOR` are `immutable` constants.                                                                                                                                                                  |

## Forge lint notes

`forge build` reports `arbitrary-send-erc20` on `safeTransferFrom(owner, ...)`, `block-timestamp` on the deadline comparisons, and `reentrancy-events` because `Locked` is emitted inside `_createLock` before the ERC-20 `permit`/`safeTransferFrom` external calls. All three are intentional: `owner` is authenticated by `SignatureChecker`, timestamps implement protocol deadlines, and `nonReentrant` plus checks-effects-interactions prevent reentrancy.
