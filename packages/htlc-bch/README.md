# `@ferry/htlc-bch`

Bitcoin Cash CashTokens HTLC covenant (`FerryHTLC.cash`), parameter/address derivation, spend and lock transaction builders, redeem-script parser, XO template, and Fulcrum WebSocket client.

## Exported API

- **Covenant and addresses (`contract.ts`, `byte-order.ts`)**: `artifact` (compiled from `contracts/FerryHTLC.cash` with `cashc` 0.14.0), `encodeHtlcParameters`, `getHtlcContract`, `deriveHtlcAddresses`, `verifyHtlcAddressMatch`, `resolveLockingBytecode`, and category byte-order helpers (`displayHexToInternalHex`, `internalHexToDisplayHex`, `displayToInternalCategory`, `internalToDisplayCategory`). Token categories enter the covenant in internal (reversed) byte order.
- **Spend builders (`spends.ts`)**: `buildClaimTransaction`, `buildRefundTransaction`, `verifyBchTransactionWithVm`. Claim validates the 32-byte secret against `hashLock` before building; refund sets `nLockTime >= refundHeight` and sequence `0xfffffffe`. Every built spend is verified in the Libauth BCH VM against its source output before returning.
- **Lock builder (`lock.ts`)**: `selectLockInputs`, `buildLockTransaction`, `verifySignedLockTransaction`, `estimateLockFee`, `normaliseLockUtxo`. Builds an unsigned funding transaction with per-input derivation path entries (`[inputIndex, 'receive' | 'change', addressIndex]`) and verifies signed transactions locally in the Libauth VM.
- **Script parsers (`parse.ts`)**: `parseHtlcRedeemScript`, `parseHtlcSpendInput`, `covenantNetworkPrefix`. Reads constructor parameters from a revealed redeem script and accepts only if rebuilding the contract yields identical bytes.
- **Electrum client (`electrum.ts`)**: `FulcrumClient`. Browser- and Node-compatible WebSocket JSON-RPC client with configurable timeouts for `server.version`, `blockchain.scripthash.get_history`, `blockchain.scripthash.listunspent`, `blockchain.transaction.get`, `blockchain.headers.subscribe`, and `blockchain.transaction.broadcast`.
- **XO template (`xo/index.ts`, exported via `@ferry/htlc-bch/xo`)**: `ferryHtlcTemplate`, `getParsedFerryHtlcTemplate`, `serializeFerryHtlcTemplate`.
