# Solver API

The solver serves a JSON API under `/v1`. On the live site it is at `https://ferry.incepture.dev/v1`. Request and response shapes are Zod schemas in `@ferry/core/api`, and `@ferry/solver-client` is a typed client that also verifies quotes.

## Conventions

- Amounts are integer strings in the token's smallest unit. Times are Unix seconds.
- Errors use one envelope: `{ "error": { "code", "message" } }`. Quote refusals (HTTP 422) say why and with which numbers.
- The secret is never sent on a `GET` or in a URL; only in the body of `POST /secret` and `POST /relay-claim`.

## Swaps

| Method | Path                              | Purpose                                                                             |
| ------ | --------------------------------- | ----------------------------------------------------------------------------------- |
| POST   | `/v1/quotes`                      | Signed quote (`dryRun: true` prices without reserving)                              |
| GET    | `/v1/orders/:orderId`             | Order state and transaction ids                                                     |
| GET    | `/v1/orders?address=0x…`          | The swaps of one EVM address                                                        |
| GET    | `/v1/orders?bch=0x…,0x…`          | The swaps of any of up to 200 Bitcoin Cash locking bytecodes (a wallet's addresses) |
| POST   | `/v1/orders/:orderId/relay-lock`  | Relay a gasless lock (permit and intent)                                            |
| POST   | `/v1/orders/:orderId/relay-claim` | Relay the user's claim                                                              |
| POST   | `/v1/orders/:orderId/secret`      | Hand the secret to the solver (handoff)                                             |

## Pay links and send links

| Method | Path                                 | Purpose                                                               |
| ------ | ------------------------------------ | --------------------------------------------------------------------- |
| POST   | `/v1/links`                          | Create a pay link                                                     |
| GET    | `/v1/links/:id`                      | Read a pay link                                                       |
| GET    | `/v1/links/by-recipient?bch=0x…,0x…` | Pay links paying any of a wallet's addresses (public fields, no memo) |
| POST   | `/v1/links/:id/quotes`               | Quote a payment                                                       |
| GET    | `/v1/links?owner=&sig=`              | The owner's links (signed)                                            |
| POST   | `/v1/links/:id/cancel`               | Delete an unpaid link (signed)                                        |
| POST   | `/v1/send-quotes`                    | Quote a send link                                                     |
| GET    | `/v1/send-links/:id`                 | Read a send link                                                      |

## Public data

| Method | Path                | Returns                                            |
| ------ | ------------------- | -------------------------------------------------- |
| GET    | `/v1/health`        | Quoting on or off, chain tips                      |
| GET    | `/v1/stats`         | Completed swaps, volume, median time, quote policy |
| GET    | `/v1/orders/recent` | Recent completed swaps                             |
| GET    | `/v1/liquidity`     | Liquidity per route                                |
| GET    | `/v1/chains`        | Supported chains                                   |
| GET    | `/v1/pegs`          | PUSD and MUSD price history                        |

Try it:

```bash
curl https://ferry.incepture.dev/v1/stats
```

Operator routes (`/v1/operator/*`) need a bearer token and are not public. The full reference, including every error code, is `docs/API.md` in the repository.
