# Security model

Ferry is built so that neither the solver nor the website can take custody of your funds. This page lists the main threats and what stops them.

> **Warning:** Ferry has not had an external security audit. It is new on mainnet, and swap sizes are capped at $50 for that reason.

## Custody and contracts

- No admin keys, owners, pause switches or proxies in either contract.
- Claims and refunds pay only the addresses fixed when the lock was made.
- The Bitcoin Cash covenant allows exactly one input and one output and checks token category, amount and fee on every path.

## Timing

- The first lock always outlives the second by a statistical margin (invariants F and R); both the solver and the browser check it. See [Timeouts and refunds](/docs/timing).
- Refunds are tested one second before and at the deadline.

## Quotes and prices

- The browser recomputes the order id, recovers the solver's signature, checks every requested field, the timeouts and the price before you sign anything.
- The peg guard stops quoting when a stablecoin is off its peg or price sources disagree.

## Signatures and relays

- Lock intents are bound to the order, the chain id and the contract address, with a deadline and nonce: they cannot be replayed elsewhere.
- A front-run permit does not stop a relayed lock.
- If a relay refuses, the user sends the transaction directly.

## Secrets

- Secrets are made in the browser (or derived from the wallet) and never put in URLs, query strings or logs; a lint rule and tests enforce it.
- Send links keep the secret after `#`, which browsers do not send to servers.
- Every claim path checks `sha256(secret) == hashLock` before using a secret.

## Operations

- The solver writes every intended transaction before sending it, so a crash cannot double-send.
- Bitcoin Cash reads need agreement between independent servers.
- Operator routes need a long bearer token compared in constant time; there is a kill switch for quoting that leaves refunds working.

What was tested, and how, is on [How Ferry was tested](/docs/testing).
