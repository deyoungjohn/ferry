# `@ferry/core`

Shared protocol types, validation schemas, canonical CBOR hashing, timing invariants, pricing math, reveal policy, and EVM/BCH helpers used by all Ferry packages.

## Exported API

- **Order terms and canonical hashing (`terms.ts`, `signing.ts`)**: `OrderTermsSchema`, `parseOrderTerms`, `unixTimestampSeconds`, `canonicalCBOR`, `orderId`, `signOrderId`, `verifyOrderSignature`, `assertHex32`. `unixTimestampSeconds` rejects values at or above `1e11` to prevent millisecond misuse. `canonicalCBOR` uses deterministic RFC 8949 encoding via `cborg` with byte-string encoding for hashes/categories/BCH scripts and tag-2 bignums for `uint256` amounts.
- **Timing invariants (`timing.ts`)**: `invariantF`, `invariantR`, `erlangQuantile`, `DEFAULT_TIMING_CONFIG`. Pure functions taking swap deadlines, BCH tip height, `solverReactionSeconds`, `safetySeconds`, and `blockMeanSeconds`, returning a `TimingDecision` with a typed `reason`.
- **Reveal policy (`reveal.ts`)**: `revealPolicy`, `DEFAULT_REVEAL_CONFIG`. Decision function enforcing fast-lane opt-in, USD cap, BCH double-spend-proof window, and per-chain finality thresholds.
- **Pricing and peg guard (`pricing.ts`)**: `convertFloor`, `convertCeil`, `quoteExactIn`, `quoteExactOut`, `checkLimits`, `pegGuard`, `effectiveSpreadBps`. Integer-only rational arithmetic with floor rounding in the solver's favour across arbitrary token decimals (such as 6, 18, and 2).
- **Secrets (`secret.ts`)**: `isValidSecret`, `assertValidSecret`. Enforces 32-byte preimages whose SHA-256 equals `hashLock` with no zero-secret fallback.
- **Chain configuration and adapters (`chains.ts`)**: `EvmChainConfigSchema`, `parseEvmChainConfig`, `validateEvmChainConfig`, `EVM_CHAIN_IDS`, `ChainAdapter`, and lock state/event types. Fails closed if any required token address or contract address is missing or zero.
- **EVM and BCH helpers (`evm.ts`, `category.ts`, `vectors.ts`)**: `evmLockId`, `LOCK_INTENT_TYPES`, `LOCK_INTENT_TYPEHASH`, `lockIntentTypedData`, `lockIntentDomainSeparator`, `categoryDisplayToInternal`, `categoryInternalToDisplay`, and `CROSS_CHECK_VECTORS` (also exported via `@ferry/core/vectors`).
- **API schemas and error codes (`api/index.ts`, exported via `@ferry/core/api`)**: `API_ERROR_CODES`, `API_ERROR_HTTP_STATUS`, `ApiErrorCodeSchema`, `ApiErrorResponseSchema`, `HealthResponseSchema`.
