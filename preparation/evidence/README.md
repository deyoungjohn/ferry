# Mainnet Acceptance Evidence Template

This template maps the JSON evidence record emitted by `@ferry/probe` to the four mainnet acceptance runs in `preparation/Ferry_Blueprint.md` §11.4.

## Acceptance runs

1. **Run 1 — Forward USDC to PUSD (fast lane, ~$5):**
   - `network`: `"mainnet"`, `direction`: `"EVM_TO_BCH"`, `mode`: `"swap"`, `status`: `"claimed"`.
   - `amounts.bchToken`: `"PUSD"`, with `amounts.evmAmount` and `amounts.bchTokenAmount` recorded in base units.
   - `txids.userLockTxid` + `explorerLinks.userLock`: Base EVM lock transaction.
   - `txids.solverLockTxid` + `explorerLinks.solverLock`: BCH HTLC lock transaction.
   - `txids.claimTxid` + `explorerLinks.claim`: User BCH claim transaction.
   - `pricing`: `spreadBps`, `fixedFeeBase`, `rounding`, and `refs` (source, `usdPrice`, `asOf`).
   - `durationsMs` and `waits`: end-to-end duration and named wait durations.
   - `recoverySavedBeforeLock`: `true`, with `recoveryFilePath` recorded.

2. **Run 2 — Reverse PUSD to USDC (safe lane, ~$5):**
   - `network`: `"mainnet"`, `direction`: `"BCH_TO_EVM"`, `mode`: `"swap"`, `status`: `"claimed"`.
   - `amounts.bchToken`: `"PUSD"`.
   - `txids.userLockTxid` + `explorerLinks.userLock`: BCH HTLC lock transaction.
   - `txids.solverLockTxid` + `explorerLinks.solverLock`: Base EVM lock transaction.
   - `txids.claimTxid` + `explorerLinks.claim`: User EVM claim transaction.
   - `pricing`, `durationsMs`, `waits`, and `recoverySavedBeforeLock` (`true`).

3. **Run 3 — Forward USDC to MUSD (~$5):**
   - `network`: `"mainnet"`, `direction`: `"EVM_TO_BCH"`, `mode`: `"swap"`, `status`: `"claimed"`.
   - `amounts.bchToken`: `"MUSD"`.
   - Same `txids`, `explorerLinks`, `pricing`, `durationsMs`, `waits`, and `recoverySavedBeforeLock` fields as Run 1.

4. **Run 4 — Pre-expired refund drill:**
   - `network`: `"mainnet"`, `mode`: `"refund"`, `status`: `"refunded"`.
   - `txids.userLockTxid` + `explorerLinks.userLock`: Initial HTLC lock transaction.
   - `txids.refundTxid` + `explorerLinks.refund`: Post-expiry refund transaction.
   - `txids.claimTxid`: `null`.
   - `waits`: includes the named refund-window wait (`waiting for EVM refund deadline` or `waiting for BCH refund height`).
