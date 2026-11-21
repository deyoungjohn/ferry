# Wallets

Ferry works with the wallets you already have. It never asks for a seed phrase or a private key.

## EVM wallets

Connect with any wallet supported by WalletConnect or a browser extension: MetaMask, Rabby, Binance Wallet, OKX Wallet, Coinbase Wallet and others. Ferry asks for typed-data signatures (permits, lock intents, claim requests) and, on tokens without a permit, an approve and a lock transaction.

> **Note:** Smart-contract wallets that do not give the same signature twice cannot derive a recovery key. Ferry detects this and falls back to a recovery file for each swap.

## Bitcoin Cash wallets and WizardConnect

Bitcoin Cash wallets connect with **WizardConnect**: Ferry shows a QR code, your phone wallet (for example Paytaca) scans it, and the two talk through a relay with end-to-end encrypted messages. The wallet signs the lock transaction; Ferry never sees its keys.

You need a Bitcoin Cash wallet only to swap **out of** Bitcoin Cash, or to create a send link. Swapping **into** Bitcoin Cash or paying a pay link needs only an address.

## Pairing relay

WizardConnect messages go through a Nostr relay. Today Ferry uses WizardConnect's public relays (`relay.riften.net`, `relay.cauldron.quest`).

Ferry also has its own relay ready (`deploy/ferry-ops.sh relay install`), switched off until it has been tested with phone wallets. When it is switched on (`VITE_WIZARD_RELAY=on`), the app checks before each pairing that Ferry's relay answers and otherwise uses the public relays; a pairing is kept while the phone wallet is asleep, and the wallet picks up its messages when its app is opened. A phone still has to be awake to sign.
