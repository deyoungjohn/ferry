# @ferry/probe

Headless Ferry user for end-to-end swap and refund probes with strict safety rails.

## Safety rails

- **Testnet by default:** `--network testnet` is the default.
- **Dry-run by default:** builds and verifies quotes, recovery files, and transactions without broadcasting. Sending transactions requires `--execute`.
- **Mainnet gate:** `--network mainnet` is refused unless `PROBE_MAINNET_CONFIRM` is set to the exact string `I approve this mainnet probe` **and** `--amount-usd` is within `--max-usd` (default `$1`, hard cap `$5`).
- **Disposable env keys:** reads `PROBE_EVM_PRIVATE_KEY` and `PROBE_BCH_WIF` (or `PROBE_BCH_PRIVATE_KEY`) from environment variables and never prints or writes them.

## Flow

1. Request a quote via `@ferry/solver-client` and verify it (`verifyQuote`).
2. Save the recovery file **before** any lock transaction is sent.
3. Lock on the source chain (`@ferry/chain-evm` permit-intent or approve+lock; `@ferry/htlc-bch` with local signer).
4. Wait with named waits for counterparty lock (or refund deadline/height in `--mode refund`).
5. Claim (or refund) and print a JSON evidence record plus a short text summary.
