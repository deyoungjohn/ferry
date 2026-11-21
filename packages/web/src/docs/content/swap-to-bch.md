# Swap into Bitcoin Cash

A forward swap turns USDC, USDT or USDG on an EVM chain into PUSD or MUSD on Bitcoin Cash. You only need an EVM wallet and a Bitcoin Cash token address; no Bitcoin Cash wallet has to be connected.

## Steps

1. **Quote.** Choose the chain, the stablecoin and the amount, then the token you want on Bitcoin Cash. Ferry asks the solver for a signed quote and checks it in your browser: the signature, every term, the price and the timeouts. A quote is valid for 60 seconds.
2. **Recovery.** Before anything is locked, Ferry makes this swap's secret from your [recovery key](/docs/recovery-key), so the swap can be found and finished from your wallet on any device. You can also download a recovery file.
3. **Lock.** You sign a permit and a lock request. The solver relays them to `FerryHTLC` on your chain, so you pay no gas. Tokens without a permit ask for an approve and send the lock from your wallet.
4. **Counter-lock.** When your lock is final, the solver locks the PUSD or MUSD in a covenant on Bitcoin Cash under the same hash lock.
5. **Claim.** Ferry claims the covenant to your address by revealing the secret. Covenant claims need no signature, so your Bitcoin Cash wallet does not have to be connected.
6. **Done.** The solver uses the revealed secret to claim your lock on the EVM chain.

## Lanes

| Lane | What it means                                                                | Time                 |
| ---- | ---------------------------------------------------------------------------- | -------------------- |
| Fast | The solver acts on your lock as soon as it is safe for that chain, up to $25 | under a minute       |
| Safe | The solver waits for more confirmations                                      | about 1 to 2 minutes |

## If the solver does not lock

Your lock names the solver as recipient, but only the secret can move it there. If the solver decides not to counter-lock (for example the price moved past the quote), it returns your deposit at once with `release`. If it does nothing at all, you refund after your deadline (24 hours by default). See [Timeouts and refunds](/docs/timing).

## Finish with your wallet, or let Ferry finish

If you close the page after the solver's lock, the swap waits for your claim. You can:

- open the swap from [My activity](/docs/my-activity) or [Recover](/docs/recovery) and press **Finish with your wallet**, which rebuilds the secret from your wallet and claims; or
- choose the optional handoff on the swap page, which gives the solver the claim for this one swap. The page explains the trade before you choose: see [Trust model](/docs/trust-model#the-optional-handoff).
