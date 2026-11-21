# Overview

Ferry has four moving parts: two contracts, a solver, and the user's side, which runs entirely in the browser.

```text
   Browser (web app, user-flow)                Solver (Node, SQLite)
   ----------------------------                ---------------------
   quote request  ------------------------->   price, limits, sign quote
   verify quote locally
   lock (permit + intent)  --------------->   relay to FerryHTLC  ---> EVM chain
                                              watch locks, counter-lock ---> Bitcoin Cash covenant
   claim with secret  -------------------->   relay claim / read secret
                                              claim the other side
```

## Components

- **Contracts.** `FerryHTLC.sol` on each EVM chain and one `FerryHTLC.cash` covenant per swap on Bitcoin Cash. See [The EVM contract](/docs/evm-contract) and [The Bitcoin Cash covenant](/docs/bch-covenant).
- **Solver.** Quotes prices, locks liquidity on the other chain, relays gasless transactions, claims its side, and refunds when it must. See [The solver](/docs/solver).
- **Web app.** A React single-page app. It holds the secret, verifies quotes, builds and signs requests in your wallets, and claims for you. See [Running Ferry](/docs/self-hosting).
- **Recovery tools.** `recover.html` and `@ferry/recover-cli` finish or refund a swap from a file with no server. See [Recovery](/docs/recovery).

## The order and its id

Every swap is described by `OrderTerms`: direction, tokens, chain, contract, both parties' addresses on both chains, the hash lock, both deadlines, Bitcoin Cash fee limits, the quote id and expiry, and the pricing evidence. The **order id** is `sha256` of the terms in deterministic CBOR (RFC 8949), so every implementation gets the same id. The solver signs the order id (EIP-191); the browser recovers the signer and checks every field before locking.

## Repository layout

| Package                                                 | What it does                                                                                                               |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `packages/core`                                         | Order terms and id, signing, timing invariants, pricing, recovery key, recovery file, pay and send link logic, API schemas |
| `packages/htlc-evm`                                     | `FerryHTLC.sol`, Foundry tests, deterministic deploy and verify scripts                                                    |
| `packages/htlc-bch`                                     | `FerryHTLC.cash`, address derivation, keyless claim and refund builders checked in the libauth VM, WizardConnect requests  |
| `packages/chain-config`                                 | Verified chain and token facts, fail-closed route configuration, RPC fallbacks                                             |
| `packages/chain-evm`                                    | EVM adapter: locks, claims, relays, log scanning                                                                           |
| `packages/solver`                                       | The solver daemon and its HTTP API                                                                                         |
| `packages/solver-client`                                | Typed client, local quote verification, best quote across solvers                                                          |
| `packages/user-flow`                                    | The user's side of a swap as a browser-safe library                                                                        |
| `packages/web`                                          | The website, including these docs                                                                                          |
| `packages/recover-page`, `packages/recover-cli`         | Recovery without the website                                                                                               |
| `packages/bch-prices`, `packages/evm-prices`            | Price sources and the peg guard                                                                                            |
| `packages/e2e`, `packages/fork-tests`, `packages/probe` | End-to-end, fork and live probe tests                                                                                      |
