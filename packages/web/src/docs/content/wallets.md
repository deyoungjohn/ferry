# Wallets

Ferry works with the wallets you already have. It never asks for a seed phrase or a private key.

## EVM wallets

Connect with any wallet supported by WalletConnect or a browser extension: MetaMask, Rabby, Binance Wallet, OKX Wallet, Coinbase Wallet and others. Ferry asks for typed-data signatures (permits, lock intents, claim requests) and, on tokens without a permit, an approve and a lock transaction.

> **Note:** Smart-contract wallets that do not give the same signature twice cannot derive a recovery key. Ferry detects this and falls back to a recovery file for each swap.

## Bitcoin Cash wallets and WizardConnect

Bitcoin Cash wallets connect with **WizardConnect**: Ferry shows a QR code, your phone wallet (for example Paytaca) scans it, and the two talk through a relay with end-to-end encrypted messages. The wallet signs the lock transaction; Ferry never sees its keys.

You need a Bitcoin Cash wallet only to swap **out of** Bitcoin Cash, or to create a send link. Swapping **into** Bitcoin Cash or paying a pay link needs only an address.

## Pairing relay

WizardConnect messages go through a Nostr relay. Ferry runs its own relay and uses it first: before each new pairing the app checks that Ferry's relay answers, and if it does not, the pairing uses the public relays (`relay.riften.net`, `relay.cauldron.quest`). A relay that is down costs at most a couple of seconds, never a failed pairing.

## Staying paired

A pairing is remembered. When you come back, Ferry reconnects on the relays it was paired on. If your phone wallet is asleep, the wallet shows as offline but the pairing is kept; Ferry's relay holds the messages, and the wallet picks them up when you open its app, with no new QR. A phone still has to be awake to sign.
