# Ferry Solver HTTP API Contract

Canonical contract defined by `@ferry/core/api` (`packages/core/src/api/index.ts`).

## Conventions

- **Content-Type:** `application/json` for all requests and responses.
- **Timestamps:** All timestamps (`updatedAt`, `createdAt`, `quoteExpiry`, `counterDeadline`, `settledAt`, `expiresAt`, `asOf`, `timestamp`, `lastConfirmedAt`, `at`, `quotedAt`, `evmDeadline`) are integer **Unix timestamps in seconds** (`< 1e11`; millisecond values are rejected).
- **Durations & Ages:** Integer seconds (`ageSeconds`, `durationSeconds`, `medianFastSeconds`).
- **Big integers:** Serialized as base-10 integer strings (e.g. `"1000000"`) in JSON.
- **Hex values:** Lowercase `0x`-prefixed hex strings (`Hex32` = 32 bytes / 66 chars; EVM addresses = 20 bytes / 42 chars).
- **Secrets:** The secret preimage is **never** sent on `GET` routes, URLs, or logs; it is only submitted in `POST /v1/orders/:orderId/secret` and `POST /v1/orders/:orderId/relay-claim` request bodies.
- **Auth:** Operator routes require `Authorization: Bearer <token>`.

## Routes

### Swap & Order Lifecycle

| Method | Path                              | Request Schema / Body                                                                                                                                  | Success (`200`) Response Schema                                                                                                | Error Statuses & Codes                                                                                                                                                                                                                            |
| ------ | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST` | `/v1/quotes`                      | `QuoteRequestSchema`: `{ direction, token, chainId, evmToken, amountIn, userEvmAddress, userBchLockingBytecode, hashLock, lane, fastOptIn?, dryRun? }` | `QuoteResponseSchema`: `{ orderId, terms, signature, signerAddress }`                                                          | `400` `BAD_REQUEST`/`VALIDATION_ERROR`/`AMOUNT_OUT_OF_RANGE`/`UNSUPPORTED_ROUTE`; `422` `QuoteRefusalSchema` or `TIMING_INVARIANT_FAILED`; `429` `RATE_LIMITED`; `503` `QUOTING_DISABLED`/`PEG_DEVIATION`/`BCH_TIP_UNHEALTHY`/`EVM_TIP_UNHEALTHY` |
| `GET`  | `/v1/orders/:orderId`             | Path param `orderId` (`Hex32`)                                                                                                                         | `OrderStatusResponseSchema`: `{ orderId, state, direction?, txids, quoteExpiry, counterDeadline, bchRefundHeight, updatedAt }` | `400` `BAD_REQUEST`; `404` `ORDER_NOT_FOUND`                                                                                                                                                                                                      |
| `POST` | `/v1/orders/:orderId/secret`      | `RevealSecretRequestSchema`: `{ secret }`                                                                                                              | `RevealSecretResponseSchema`: `{ ok, orderId, state?, updatedAt? }`                                                            | `400` `VALIDATION_ERROR`/`INVALID_SIGNATURE`; `404` `ORDER_NOT_FOUND`; `409` `INVALID_ORDER_STATE`; `410` `QUOTE_EXPIRED`; `425` `REVEAL_NOT_READY`                                                                                               |
| `POST` | `/v1/orders/:orderId/relay-lock`  | `RelayLockRequestSchema`: `{ permit?, intent: { orderId, deadline, nonce? }, signature }`                                                              | `RelayLockResponseSchema`: `{ ok, orderId, txHash, updatedAt? }`                                                               | `400` `VALIDATION_ERROR`/`INVALID_SIGNATURE`/`TERMS_MISMATCH`/`INSUFFICIENT_USER_BALANCE`; `404` `ORDER_NOT_FOUND`; `409` `INVALID_ORDER_STATE`; `410` `QUOTE_EXPIRED`; `502` `RELAY_LOCK_REVERTED`/`UPSTREAM_ERROR`                              |
| `POST` | `/v1/orders/:orderId/relay-claim` | `RelayClaimRequestSchema`: `{ secret, lockId? }`                                                                                                       | `RelayClaimResponseSchema`: `{ ok, orderId, txHash, updatedAt? }`                                                              | `400` `VALIDATION_ERROR`; `404` `ORDER_NOT_FOUND`; `409` `INVALID_ORDER_STATE`; `502` `UPSTREAM_ERROR`                                                                                                                                            |

### Health, Discovery & Public Telemetry

| Method | Path                | Request | Success (`200`) Response Schema                                                                                  | Error Statuses & Codes |
| ------ | ------------------- | ------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------- |
| `GET`  | `/v1/health`        | —       | `HealthResponseSchema`: `{ ok, quotingEnabled, timestamp, tips?, tipAges?, inventory? }`                         | `500` `INTERNAL_ERROR` |
| `GET`  | `/v1/liquidity`     | —       | `LiquidityResponseSchema`: `{ routes: RouteLiquiditySchema[], asOf }`                                            | `500` `INTERNAL_ERROR` |
| `GET`  | `/v1/chains`        | —       | `ChainsResponseSchema`: `{ chains: ChainInfoSchema[], asOf? }`                                                   | `500` `INTERNAL_ERROR` |
| `GET`  | `/v1/stats`         | —       | `StatsResponseSchema`: `{ completedSwaps, totalVolumeUsd, medianFastSeconds, quotePolicy?, asOf }`               | `500` `INTERNAL_ERROR` |
| `GET`  | `/v1/orders/recent` | —       | `RecentOrdersResponseSchema`: `{ orders: RecentOrderItemSchema[], asOf? }`                                       | `500` `INTERNAL_ERROR` |
| `GET`  | `/v1/pegs`          | —       | `PegsResponseSchema`: `{ tokens: PegTokenHistorySchema[], asOf }`                                                | `500` `INTERNAL_ERROR` |
| `GET`  | `/v1/metrics`       | —       | `MetricsResponseSchema`: `{ openExposureUsd, unfundedQuotes, tipAges, errorCounts, lastConfirmedAt, timestamp }` | `500` `INTERNAL_ERROR` |

### Operator (Bearer Auth Required)

| Method | Path                           | Request                         | Success (`200`) Response Schema                                         | Error Statuses & Codes |
| ------ | ------------------------------ | ------------------------------- | ----------------------------------------------------------------------- | ---------------------- |
| `GET`  | `/v1/operator/needs-attention` | `Authorization: Bearer <token>` | `OperatorNeedsAttentionResponseSchema`: `{ alerts, orders, timestamp }` | `401` `UNAUTHORIZED`   |

### Pay Links & Send Links

| Method | Path                                   | Request Schema / Query                                                                                                                                         | Success Response Schema                                                                                                                                                                               | Error Statuses & Codes                                                                                                                                        |
| ------ | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST` | `/v1/links`                            | `CreatePayLinkRequestSchema`: `{ token, recipientAddress, amountOut?, memo?, expiresAt?, ownerSig? }`                                                          | `200`/`201` `CreatePayLinkResponseSchema` (`PayLinkJsonSchema`)                                                                                                                                       | `400` `VALIDATION_ERROR`/`INVALID_SIGNATURE`                                                                                                                  |
| `GET`  | `/v1/links/:id`                        | Path param `id`                                                                                                                                                | `200` `PayLinkDetailsResponseSchema` (`PayLinkJsonSchema`)                                                                                                                                            | `404` `LINK_NOT_FOUND`                                                                                                                                        |
| `POST` | `/v1/links/:id/quotes`                 | `PayLinkQuoteRequestSchema`: `{ chainId, evmToken, amountOut?, userEvmAddress, hashLock, lane, fastOptIn? }`                                                   | `200` `QuoteResponseSchema`                                                                                                                                                                           | `400` `VALIDATION_ERROR`/`AMOUNT_OUT_OF_RANGE`; `404` `LINK_NOT_FOUND`; `409` `LINK_RESERVED`/`LINK_CLOSED`; `410` `LINK_EXPIRED`; `422` `QuoteRefusalSchema` |
| `GET`  | `/v1/links?owner=<cashaddr>&sig=<sig>` | `ListPayLinksQuerySchema`: `{ owner, sig }`                                                                                                                    | `200` `OwnerPayLinksResponseSchema`: `{ owner, links, asOf? }`                                                                                                                                        | `400` `VALIDATION_ERROR`/`INVALID_SIGNATURE`; `401` `UNAUTHORIZED`                                                                                            |
| `POST` | `/v1/links/:id/cancel`                 | `CancelPayLinkRequestSchema`: `{ owner, sig }`                                                                                                                 | `200` `CancelPayLinkResponseSchema`: `{ ok, id, status: "cancelled", updatedAt? }`                                                                                                                    | `400` `VALIDATION_ERROR`/`INVALID_SIGNATURE`; `401` `UNAUTHORIZED`; `404` `LINK_NOT_FOUND`; `409` `LINK_CLOSED`                                               |
| `POST` | `/v1/send-quotes`                      | `SendQuoteRequestSchema`: `{ token, chainId, evmToken, amountIn, recipientEvmAddress, userEvmAddress, userBchLockingBytecode, hashLock, windowSeconds, lane }` | `200` `QuoteResponseSchema`                                                                                                                                                                           | `400` `VALIDATION_ERROR`/`AMOUNT_OUT_OF_RANGE`/`UNSUPPORTED_ROUTE`; `422` `QuoteRefusalSchema` or `TIMING_INVARIANT_FAILED`; `429` `RATE_LIMITED`             |
| `GET`  | `/v1/send-links/:id`                   | Path param `id`                                                                                                                                                | `200` `SendLinkDetailsResponseSchema`: `{ id, orderId?, status, token, chainId, evmToken, amountIn?, amountOut?, recipientEvmAddress, hashLock, evmDeadline, bchRefundHeight, createdAt, updatedAt }` | `404` `LINK_NOT_FOUND`                                                                                                                                        |

### Dry-run quotes

`dryRun: true` on `POST /v1/quotes` asks for a price only: the response has the same shape, but the solver reserves no liquidity and creates no order, so the returned `orderId` cannot be locked against. Send the same request without `dryRun` to get a real quote. Omitted or `false` means a normal, reserving quote.

## Error Envelope (`ApiErrorResponseSchema`)

All non-refusal error responses use:

```json
{
  "error": {
    "code": "ORDER_NOT_FOUND",
    "message": "Order not found",
    "details": {}
  }
}
```

`API_ERROR_HTTP_STATUS` in `@ferry/core/api` maps every `ApiErrorCode` to its canonical HTTP status:

| HTTP Status | Codes                                                                                                                                                 |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `400`       | `BAD_REQUEST`, `VALIDATION_ERROR`, `INVALID_SIGNATURE`, `TERMS_MISMATCH`, `AMOUNT_OUT_OF_RANGE`, `UNSUPPORTED_ROUTE`, `INSUFFICIENT_USER_BALANCE`     |
| `401`       | `UNAUTHORIZED`                                                                                                                                        |
| `404`       | `NOT_FOUND`, `ORDER_NOT_FOUND`, `LINK_NOT_FOUND`                                                                                                      |
| `409`       | `CONFLICT`, `LINK_RESERVED`, `LINK_CLOSED`, `INVALID_ORDER_STATE`                                                                                     |
| `410`       | `QUOTE_EXPIRED`, `LINK_EXPIRED`                                                                                                                       |
| `422`       | `TIMING_INVARIANT_FAILED`                                                                                                                             |
| `425`       | `REVEAL_NOT_READY`                                                                                                                                    |
| `429`       | `RATE_LIMITED`                                                                                                                                        |
| `500`       | `INTERNAL_ERROR`                                                                                                                                      |
| `502`       | `RELAY_LOCK_REVERTED`, `UPSTREAM_ERROR`                                                                                                               |
| `503`       | `QUOTING_DISABLED`, `PEG_DEVIATION`, `STALE_CHAIN_TIP`, `BCH_TIP_UNHEALTHY`, `EVM_TIP_UNHEALTHY`, `INSUFFICIENT_INVENTORY`, `EXPOSURE_LIMIT_EXCEEDED` |

## Quote Refusal Envelope (`QuoteRefusalSchema`, HTTP `422`)

Quote endpoints (`POST /v1/quotes`, `POST /v1/links/:id/quotes`, `POST /v1/send-quotes`) return HTTP `422` with `QuoteRefusalSchema` when quoting is refused for liquidity, peg, or policy reasons:

| `reason`                 | Required fields      | Optional fields        |
| ------------------------ | -------------------- | ---------------------- |
| `INSUFFICIENT_LIQUIDITY` | `maxAmount`, `asset` | `message`              |
| `OVER_MAX_SWAP`          | `maxAmount`, `asset` | `message`              |
| `PEG_GUARD`              | `asset`              | `maxAmount`, `message` |
| `PRICE_UNAVAILABLE`      | `asset`              | `maxAmount`, `message` |
| `ROUTE_DISABLED`         | `asset`              | `maxAmount`, `message` |
| `QUOTING_PAUSED`         | `asset`              | `maxAmount`, `message` |

## Contract Verification

`@ferry/solver-client/testing` exports `runContractSuite(baseUrl, options)` which exercises all 20 routes plus negative cases (bad body `400`, unknown order `404`, expired quote `410`, insufficient liquidity `422`) against any live or fake solver server.
