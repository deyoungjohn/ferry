# Ferry

**A ferry, not a bridge.** Ferry is a two-way, trust-minimised atomic swap between stablecoins on EVM chains (USDC first, USDT on supported chains) and native PUSD / MUSD CashTokens on Bitcoin Cash, plus cross-chain pay links and send links. Nothing is wrapped, minted, or held by a custodian: every swap is a pair of hash-time-locked contracts (HTLCs) unlocked by the same secret, with an independent solver supplying liquidity.

> **Status: built for BCH BLAZE 2026.** The swap contract is deployed on Base (`0x8b968625F983420B571C102eC0b57F7e509c916e`, source verified on the explorer) and the first small mainnet swaps are starting. Other chains are enabled one at a time. Nothing here has had an outside security audit. Live site: <https://ferry.incepture.dev>.

## How a swap works (30-second picture)

```text
  User (holds secret S, hashLock H = sha256(S))               Solver (supplies liquidity)
  ----------------------------------------------               ---------------------------
  1. Request quote (or compare multiple solvers)  ---------->  Returns signed OrderTerms (orderId)
  2. Lock funds on source chain with H, T_src     ---------->  Watches source lock finality
                                                               Locks counter-funds on target chain
                                                  <----------  with H, T_dst (shorter timeout)
  3. Claim target funds by revealing S            ---------->  Reads S from chain/mempool/reveal
  4. (Done: user has native target stablecoins)                Claims source funds using S

  Abort path: if either side stalls past its timeout, each party permissionlessly refunds its own lock.
```

Because the user holds the secret and always has the longer timeout on the first lock (`T_src > T_dst`), the solver cannot steal funds or force an asymmetric stall.

## Trust model: trust-minimised, not trustless

**What you do not trust the solver with:**

- **Custody:** funds sit only in on-chain HTLCs on Bitcoin Cash (CashScript P2SH32 covenant) and the EVM chain (`FerryHTLC.sol`). Neither contract has an admin, owner, upgrade proxy, or pause switch.
- **Settlement:** BCH claims and refunds are **keyless** (any caller can broadcast a valid transaction because outputs are covenant-enforced to the fixed payee), and EVM `claim`/`refund` are open to any caller.
- **Exit:** if the solver or website disappears mid-swap, your downloaded `ferry-<orderId>.json` recovery file contains everything needed to build and verify your own claim or refund transaction offline.

**What you still trust / rely on:**

- **Liveness and pricing:** at least one solver must be online to quote and fund the counter-lock. Multi-solver quoting (`@ferry/solver-client`) lets you query multiple solver URLs, verify each EIP-191 signature and pricing evidence locally, and pick the best payout.
- **Gasless relays (optional convenience):** the solver can relay EIP-2612/EIP-712 `lockWithIntent` and EVM `claim` so users do not need native gas; if a relay refuses, you can submit the transaction directly.
- **Public chain endpoints:** reading chain state relies on public Fulcrum/Electrum servers (quorum-checked across two servers in `@ferry/solver`) and EVM RPCs.

## Package map

| Package                                                  | Purpose                                                                                                                                                                                                                                               |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`@ferry/core`](packages/core)                           | Canonical CBOR `OrderTerms` & `orderId`, JSON codec, EIP-191 signing, timing invariants (`F` and `R`), pricing & liquidity math, recovery file schema & action planner, pay-link/send-link logic, and `@ferry/core/api` schemas                       |
| [`@ferry/htlc-bch`](packages/htlc-bch)                   | CashScript BCH covenant (`FerryHTLC.cash`), P2SH32 derivation, keyless claim/refund/recovery builders with libauth VM verification, WizardConnect signing request builder, BCH chain activity reader, send-link lock builder, and XO template helpers |
| [`@ferry/htlc-evm`](packages/htlc-evm)                   | Solidity `FerryHTLC.sol` (`lock`, `lockWithIntent`, `claim`, `refund`), deterministic CREATE2 deployment scripts, and ABI exports                                                                                                                     |
| [`@ferry/chain-config`](packages/chain-config)           | Verified chain metadata and fail-closed route configuration for Base, Ethereum, BNB Chain, Arbitrum, Robinhood Chain, and Arc                                                                                                                         |
| [`@ferry/chain-evm`](packages/chain-config/../chain-evm) | EVM `ChainAdapter`, permit/intent relay validation, chunked event log scanning, and activity reader                                                                                                                                                   |
| [`@ferry/solver`](packages/solver)                       | Solver engine: pricing, exposure/inventory limits, SQLite WAL state machine, action executor, and Fulcrum quorum checks                                                                                                                               |
| [`@ferry/solver-client`](packages/solver-client)         | Typed HTTP client over `@ferry/core/api`, local EIP-191 + pricing + timing quote verification, multi-solver `bestQuote`, and recovery download helpers                                                                                                |
| [`@ferry/web`](packages/web)                             | React frontend for swaps, status tracking, pay links (`/p/<id>`), send links (`/s/<id>#<secret>`), My Activity (`/activity`), and recovery                                                                                                            |

More detail: [Architecture](docs/ARCHITECTURE.md) · [Security & Threat Model](docs/SECURITY.md)

## Run locally

Requires **Node 22** (`.nvmrc`) and **pnpm 9** (plus Foundry `forge`/`anvil` if running Solidity contract or EVM adapter tests).

```bash
pnpm install
pnpm format:check && pnpm typecheck && pnpm lint
pnpm -r exec rm -rf dist && pnpm test:unit
pnpm check:private
```

Run tests for an individual package:

```bash
pnpm --filter @ferry/core test:coverage
pnpm --filter @ferry/htlc-bch test
pnpm --filter @ferry/solver-client test:coverage
```

## The website

One single-page app at the root of the domain. Public pages need no wallet; the tool pages ask you to connect one.

| Path               | What it is                                                           | Wallet needed         |
| ------------------ | -------------------------------------------------------------------- | --------------------- |
| `/`                | Landing page                                                         | No                    |
| `/features`        | What Ferry does                                                      | No                    |
| `/how-it-works`    | The swap in four steps, and the FAQ                                  | No                    |
| `/stats`           | Live swap numbers, deployed contracts, what was tested, what was not | No                    |
| `/user-guide`      | Step-by-step guide (also at `/app/user-guide`)                       | No                    |
| `/status`          | Route check for the maintainer                                       | No                    |
| `/pay/<hash>`      | A pay link, as the payer sees it                                     | Opened from a link    |
| `/send/<hash>`     | A send link, as the recipient sees it                                | Opened from a link    |
| `/app/swap`        | Swap                                                                 | Yes                   |
| `/app/swap/<hash>` | Status page of one swap                                              | Opened from a receipt |
| `/app/pay-link`    | Create pay links and send links                                      | Yes                   |
| `/app/my-activity` | Your swaps, rebuilt from the chains                                  | Yes                   |
| `/app/recover`     | Finish or refund a swap from a recovery file                         | No                    |

The navigation shows Features, How it works and Proof until a wallet is connected, then Swap, Pay link, My activity, Recover and User guide.

The server proxies `/v1/*` to the solver API and serves every other path as the app (`deploy/`). Earlier paths (`/swap`, `/pay-link`, `/my-activity`, `/recover`, `/help`, `/activity`, `/pay-links`, `/p/<id>`, `/s/<id>`) redirect.

To see the interface locally without a solver or real wallets:

```bash
VITE_NETWORK=testnet VITE_MOCK=1 pnpm --filter @ferry/web dev
```

Without those variables the default is the mainnet profile, which shows what is still missing until contracts are deployed and a solver URL is set (`VITE_SOLVER_URLS`, an origin that serves `/v1/*`). The dev server must be restarted after package changes.

## Verify a claim yourself

1. **Recovery transaction & local VM check (`@ferry/core` + `@ferry/htlc-bch`):**
   - `parseRecoveryFileJson(json)` and `recoveryActions(file, chainState)` in `@ferry/core` determine your exact claim or refund action (or name what you are waiting for).
   - `buildBchRecoveryTransaction({ file, utxos })` in `@ferry/htlc-bch` builds the raw BCH spend and verifies it locally inside the `@bitauth/libauth` VM before you broadcast.
   - `buildEvmRecoveryCalldata(file)` in `@ferry/core` builds the exact EVM `claim` or `refund` calldata without touching any RPC or wallet.
2. **XO template byte-identity (`@ferry/htlc-bch`):**
   - Inspect the XO template address and invitation JSON offline (proving byte-identical locking bytecode to the CashScript covenant):
     ```bash
     pnpm --filter @ferry/htlc-bch xo:debug
     ```
3. **Read your swap history directly from Bitcoin Cash (`My Activity`):**
   - `fetchBchActivity({ electrum, userLockingBytecode, categories, limit })` in `@ferry/htlc-bch` scans your BCH address history, parses covenant redeem scripts directly from chain transactions, and reconstructs your swaps without querying any solver database.

## Prior work & build disclosure

- **Prior testnet work:** [`ferry-testnet`](https://github.com/deyoungjohn/ferry-testnet) is a public testnet implementation built before BCH BLAZE 2026. This repository was started fresh on 15 November 2026 and is not a fork of `ferry-testnet`. Design notes and measured spike results from that testnet work live in [`preparation/`](preparation/).
- **AI-assisted development:** this repository was written by a small swarm of AI coding agents (Claude) working in parallel under human direction, as recorded in the `Co-Authored-By` git commit trailers.

## Credits

The swap card's layout and token picker are adapted from the Swap block at <https://beui.dev/components/blocks/swap>, used with the maintainer's permission.
The pagination control and the date range picker (under `packages/web/src/components/ui`) are adapted from beui.dev components, also used with the maintainer's permission.

## Known limitations

- **Unaudited, early mainnet:** the contracts and the solver were tested on local simulators and forks of the live chains; only a few small real swaps have run. No external security audit has been performed. Swap sizes are capped.
- **Foundry tests require local toolchain:** `forge` and `anvil` tests in `@ferry/htlc-evm` and `@ferry/chain-evm` require Foundry installed locally.
- **Pay-link index:** open (unpaid) pay links are stored by the solver; paid swaps and all send links remain verifiable on chain.
- **Browser-side secret storage:** the secret preimage is generated in the browser and stored locally; if a user clears browser storage without saving `ferry-<orderId>.json`, they must wait for the refund timeout rather than claiming.
