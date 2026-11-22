# Wallet-derived recovery key

A swap's secret has to survive a closed tab or a lost laptop. Ferry derives it from your wallet, so signing one message on any device recovers every swap.

## How it works

1. The first time you swap, your wallet signs one fixed message. EVM wallets sign an EIP-712 message with no chain id, so it is the same on every chain. Bitcoin Cash wallets sign a plain text message.
2. The signature is turned into a **root key** with HKDF-SHA256. The root never leaves your browser.
3. Swap number `n` uses the secret `HMAC(root, n)`. Its hash lock is `sha256(secret)`, which is what both contracts are locked with.
4. To recover, Ferry asks for the same signature again, rebuilds the root, and walks `n = 0, 1, 2, …`, computing each hash lock and looking it up on the chains, until it finds a run of unused numbers.

Ordinary wallets produce the same signature for the same message (deterministic ECDSA, RFC 6979), so the same root comes back on any device.

## What else the root makes

- A short **tag** written in a Bitcoin Cash lock's transaction, so your swaps can be found from Bitcoin Cash too. The tag reveals nothing about the root or the secret.
- A **cancel key** for each send link, used only to cancel an unclaimed link. It is domain-separated, so revealing it opens nothing else.

## Limits

- A few wallets refuse a typed message without a chain id (the error mentions a chain id of NaN). Ferry then uses a random secret and a recovery file for each swap, as for wallets below.
- Some smart-contract wallets do not sign deterministically. Ferry signs twice to check; if the two differ, it uses a recovery file for each swap instead.
- Anyone who obtains that one signature could recompute your secrets. They could not steal funds (claims only pay the addresses in the terms) but could see your swaps. Ferry asks for the signature only on its own domain and only for this purpose.
