# Ferry Security & Threat Model

Ferry is designed so that **neither the solver nor the web frontend can take custody of user funds**. Below is a summary of the primary threats, protocol mitigations, and residual risks.

> **Note:** Ferry has been tested on testnets and local simulators only and has not undergone an external security audit.

## 1. Custody & smart contract risks

- **No admin keys or upgradeability:** `FerryHTLC.sol` and `FerryHTLC.cash` have no owner, pause switch, or proxy upgrade path.
- **Fixed payees & keyless BCH covenant:** on BCH, `FerryHTLC.cash` enforces the exact recipient locking bytecode, token category, and token amount on output 0. Even if a third party broadcasts a claim or refund transaction, funds can only land at the agreed destination.
- **Token decimal & byte-order safety:**
  - BCH CashTokens `tokenCategory` is reversed between display byte order and VM/wire internal byte order (`categoryDisplayToInternal` / `categoryInternalToDisplay`); mismatches are tested against libauth VM execution.
  - EVM stablecoin decimals vary by chain and token (e.g., 6 vs 18 decimals). `@ferry/chain-config` fails closed on unconfigured assets, and `@ferry/core` pricing performs explicit `fromDecimals` -> `toDecimals` integer conversions with floor rounding in the solver's favour.

## 2. Timing & race-condition threats

- **Asymmetric timeout attack (user griefing or fund loss):**
  - Prevented by `invariantF` (forward) and `invariantR` (reverse) using 99.99% and 0.01% Erlang quantiles of BCH block arrival times plus `solverReactionSeconds` and `safetySeconds`.
  - The party that locks first always gets the longer timeout, ensuring the counter-lock expires strictly earlier with high statistical margin.
- **Non-atomic reveal / empty-secret bug:**
  - Every claim builder and solver reveal path verifies `sha256(secret) === hashLock` before using or storing a secret.
- **EVM nonce collisions:**
  - `@ferry/chain-evm` serializes transactions per signer through a send queue so concurrent claims, locks, and refunds do not collide on nonce.

## 3. Quote & pricing manipulation

- **Tampered solver quote:**
  - `@ferry/solver-client` (`verifyQuote`) independently recomputes `orderId = sha256(canonicalCBOR(terms))`, recovers the EIP-191 signer over `orderId`, verifies every requested field, checks timing invariants, checks per-source `pricing.refs` freshness, and recomputes `quoteOut` from `terms.pricing` before the user signs or locks anything.
- **Single-solver censorship or bad pricing:**
  - `bestQuote` queries multiple independent solver URLs in parallel and selects the best verified quote.
- **Millisecond vs second timestamp confusion:**
  - `unixTimestampSeconds` across `@ferry/core`, `@ferry/core/api`, and recovery schemas strictly rejects values `>= 1e11`.

## 4. Secret & key hygiene

- **Secret preimage exposure:**
  - For swaps, the secret is generated locally and never placed in URLs, query parameters, or logs (enforced by tests and an ESLint rule).
  - For send links (`/s/<id>#<secret>`), the secret lives exclusively in the URL fragment (`#...`), which browsers do not transmit in HTTP requests.
- **Solver / chain-endpoint availability:**
  - If a solver goes offline mid-swap, `ferry-<orderId>.json` allows the user to claim or refund permissionlessly via `@ferry/core` and `@ferry/htlc-bch` against public Fulcrum and EVM RPCs.
  - In `@ferry/solver`, BCH tip reads cross-check two independent Fulcrum servers (verifying genesis hash and liveness) and halt new quotes if quorum is lost.
