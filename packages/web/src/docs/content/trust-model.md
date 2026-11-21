# Trust model

Ferry is trust-minimised, not trustless. This page says exactly where the line is.

## What you do not trust anyone with

- **Custody.** Funds sit only in two contracts. `FerryHTLC.sol` has no owner, admin, pause switch or upgrade path. The Bitcoin Cash covenant has no key that can redirect funds.
- **Settlement.** Claims and refunds can be sent by anyone, and can only pay the addresses fixed in the terms.
- **The exit.** If the website and the solver disappear, your wallet or recovery file is enough to claim or refund. See [Recovery](/docs/recovery).

## What you rely on

- **A solver to be online** to quote and lock its side. If it is not, you wait for your deadline and refund.
- **Honest pricing at quote time.** Your browser checks the signed quote (terms, price, timeouts) before you lock, and you see the amount you will receive.
- **Public chain servers** to read state and broadcast. Ferry uses several and checks Bitcoin Cash servers against each other.
- **Relays, optionally.** The solver relays gasless locks and claims as a convenience. If it refuses, your wallet can send the transaction itself.

## The optional handoff

On a swap into Bitcoin Cash, the last step is your claim of the solver's covenant. If you will not be around to finish, you can choose to let Ferry finish it: your browser gives the solver this swap's secret, and the solver claims the covenant to your address.

- The covenant can only pay your address, so the solver cannot redirect your PUSD.
- What changes is the **order of steps**: with the secret, a solver could claim your EVM lock and let its own covenant run out to its refund, if you were not around to claim it in time. Ferry's solver is written to claim the covenant to your address before it touches your lock, and fails closed otherwise, but for the hours of the swap you rely on that code.

The swap page explains this before you choose, and the handoff is off unless you turn it on.
