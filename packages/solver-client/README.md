# `@ferry/solver-client`

Typed HTTP client, quote verifier, multi-solver selector, and recovery-file download helpers for Ferry solvers.

## Usage

### Single-solver client

Create a `SolverClient` with a solver base URL (and an optional `fetch` implementation, timeout in milliseconds, or operator bearer token):

```ts
import { SolverClient } from '@ferry/solver-client';

const client = new SolverClient({
  baseUrl: 'https://solver.example.com',
  timeoutMs: 8000,
});

const health = await client.health();
const quote = await client.quote({
  direction: 'EVM_TO_BCH',
  token: 'PUSD',
  chainId: 84532,
  evmToken: '0x...',
  amountIn: 10_000_000n,
  userEvmAddress: '0x...',
  userBchLockingBytecode: '0x...',
  hashLock: '0x...',
  lane: 'fast',
});
```

All responses are parsed against `@ferry/core/api` schemas (with Unix timestamps strictly in seconds). Failures raise typed errors: `SolverRefusalError` (HTTP 422 `QuoteRefusal`), `SolverHttpError`, `SolverTimeoutError`, `SolverNetworkError`, and `SolverSchemaError`.

### Quote verification

`verifyQuote(quote, request, context)` checks that:

1. `orderId` matches the canonical CBOR hash of `terms`.
2. The EIP-191 signature over `orderId` recovers `terms.solverEvmAddress` and `quote.signerAddress` (plus `expectedSolverAddress` when supplied).
3. All requested fields (`direction`, `bchToken`, `evmChainId`, `evmToken`, `userEvmAddress`, `userBchLockingBytecode`, `hashLock`, and input amount) match the request.
4. `quoteExpiry` is in the future and the deadlines satisfy the forward (`invariantF`) or reverse (`invariantR`) timing invariant against `bchTipHeight`.
5. `pricing.refs` are within the configured per-source max age (`maxRefAgeBySource` / `defaultMaxRefAgeSeconds`) and `quoteOut` reproduces the quoted receive amount.

Any mismatch throws `QuoteVerificationError` naming the failing `field`.

### Multi-solver selection

`bestQuote(solvers, request, options)` queries every solver URL in parallel, verifies each quote, records refusals, timeouts, network errors, and verification rejections in `failures` for display, and selects the verified quote with the highest receive amount (breaking ties by lower latency):

```ts
import { bestQuote } from '@ferry/solver-client';

const { best, quotes, failures } = await bestQuote(
  ['https://solver-a.example.com', 'https://solver-b.example.com'],
  request,
  {
    bchTipHeight: 500_000,
    evmTokenDecimals: 6,
    defaultMaxRefAgeSeconds: 120,
    maxRefAgeBySource: { pyth: 60, cauldron: 180 },
  },
);
```

### Pay links, send links, and recovery download

`SolverClient` also provides typed methods for pay links (`createPayLink`, `getPayLink`, `quotePayLink`, `listOwnerPayLinks`, `cancelPayLink`) and send links (`quoteSendLink`, `getSendLink`), plus `prepareRecoveryDownload` and `triggerRecoveryDownload` to build and download `ferry-<orderId>.json`.
