# @ferry/user-flow

The user's side of a Ferry swap as a library that runs in a browser. It does the quote, the recovery file, the user's lock, the wait for the solver's lock, the claim, and the refund, in both directions, and it can pick the swap up again from the saved recovery file after a page reload.

The library never imports a wallet library, a Node module, a socket or a file. Everything a wallet or a network does goes through a **port** that the caller provides. The web page implements the ports with its own wallet and network libraries; the tests implement them with in-memory fakes.

## The ports

| Port                | What it does                                                                                                                                                                                                              |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `EvmSignerPort`     | The user's EVM wallet: `getAddress`, `getChainId`, `signTypedData` (the permit and the lock intent), `sendTransaction` (approve then lock for tokens without a permit, and the user's own refund).                        |
| `EvmChainPort`      | EVM reads: `buildUserLock` and `getLock` (an `EvmChainAdapter` from the chain package provides both), `waitForReceipt`, `getBlockTimestamp`.                                                                              |
| `BchSignerPort`     | The user's Bitcoin Cash wallet: `signTransaction` receives a WizardConnect signing request and returns the signed transaction as hex. The library checks it with `inspectSignedTransaction` before anything is broadcast. |
| `BchChainPort`      | Bitcoin Cash reads and broadcast: `getTipHeight`, `getUtxos` for a locking bytecode (token category in explorer order), `broadcast`. In a browser this talks to a public Fulcrum server over `wss`.                       |
| `RecoveryStorePort` | Where the secret and the recovery file live: `save`, `load`, `list`. IndexedDB or localStorage in a browser. `createMemoryStore` is included.                                                                             |
| `SolverPort`        | The slice of `SolverClient` the session calls: `quote`, `getOrder`, `relayLock`, `relayClaim`, `health`.                                                                                                                  |

## The session

`UserSwapSession` moves through named steps. `state` says which step the user is on, whether it is `ready`, `running`, `waiting` or `failed`, and, while waiting, what it is waiting for in plain words.

1. `quote`: a fresh 32-byte secret and its hash lock for every quote, then the real request: the wallet's chain id, the token address and the user's locking bytecode taken from their CashAddress. A wallet on the wrong chain, an empty address, a zero amount or an address for the wrong network stops the quote before anything is sent. The answer is verified with the solver client before it is trusted. `dryRun: true` asks for a price only; nothing is reserved and the session cannot go on to lock.
2. `saveRecovery`: the recovery file, with the real covenant addresses, redeem script and locking bytecode, is saved before any lock. `lock` refuses to run until it is.
3. `lock`: forward, two typed-data signatures relayed through the solver (or approve then lock where the token has no permit); reverse, the lock transaction is built, signed by the wallet, checked, and only then broadcast.
4. `waitCounterLock`: looks at the chain first and at the solver second, so it still works when the solver stops answering. On timeout the error says the user's own lock is safe and the refund path is open.
5. `claim`: forward, the user's Bitcoin Cash claim, built from the recovery file and broadcast; reverse, the EVM claim relayed through the solver.
6. `done`, or `refund` then `refunded`. `plan()` asks the recovery planner what the user can do now, from the chains; `refund()` only runs when the planner says its deadline has passed.

`UserSwapSession.resume(deps, orderId)` rebuilds a session from the saved file and works out the current step from the chains. `run(input, wait)` does the whole flow in order and stops at the first failure.

The Bitcoin Cash tip height comes from the solver's `/v1/health` (`tips.bchHeight`), with `BchChainPort.getTipHeight` as the fallback.

## A minimal example

```ts
import { SolverClient } from '@ferry/solver-client';
import { UserSwapSession, createMemoryStore } from '@ferry/user-flow';

const session = new UserSwapSession({
  solver: new SolverClient({ baseUrl: 'https://solver.example' }),
  evmSigner, // implements EvmSignerPort with your wallet library
  evmChain, // implements EvmChainPort (an EvmChainAdapter works)
  bchSigner, // implements BchSignerPort with WizardConnect
  bchChain, // implements BchChainPort with a Fulcrum client
  store: createMemoryStore(), // use IndexedDB in a browser
  bchNetwork: 'mainnet',
  bchCashAddress: 'bitcoincash:q...', // the user's own address
});

session.subscribe((state) => render(state.step, state.status, state.waiting));

await session.run(
  {
    direction: 'EVM_TO_BCH',
    token: 'PUSD',
    chainId: 8453,
    evmToken: '0x...', // the stablecoin on that chain
    amountIn: 10_000_000n, // base units of what the user pays
    evmTokenDecimals: 6,
    bchTokenDecimals: 2,
  },
  { pollIntervalMs: 15_000, timeoutMs: 20 * 60_000 },
);
```

After a reload, `UserSwapSession.resume(deps, orderId)` returns a session at the right step; call `claim()` or `refund()` on it as `state.step` says.

## Errors

Every failure the page should explain is a `UserFlowError` with a `code` (`WRONG_CHAIN`, `INVALID_INPUT`, `DRY_RUN_QUOTE`, `NO_QUOTE`, `RECOVERY_NOT_SAVED`, `WALLET_REJECTED`, `SIGNED_TRANSACTION_REJECTED`, `COUNTER_LOCK_TIMEOUT`, `NOTHING_TO_SPEND`, `NOT_READY`), a message in plain words, and `refundPossible`.
