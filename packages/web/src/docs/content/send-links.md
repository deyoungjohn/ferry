# Send links

A send link sends PUSD or MUSD to someone who only has an EVM wallet. You lock the tokens on Bitcoin Cash; the receiver opens the link and gets USDC, USDT or USDG on their chain. If they never claim, the money comes back to you.

## Create a send link

1. Open [Send link](/app/pay-link?type=send) and connect your Bitcoin Cash wallet.
2. Enter the receiver's EVM address, their default chain and token, and the amount they should receive. Ferry adds its fee on top, so the receiver gets exactly that amount.
3. Choose the claim window: 24 hours, 3 days or 7 days.
4. Add an optional note for the receiver (up to 140 characters; anyone with the link can read it).
5. Press **Generate send link**. Your Bitcoin Cash wallet signs the lock.
6. Copy the link and send it to the receiver privately.

## What the receiver does

The receiver opens the link and connects the wallet for the address you entered. They can keep the default chain or pick another route the solver can pay. They press **Connect and claim** and sign one short message, which costs nothing. The solver locks the stablecoin and Ferry claims it to their address; the solver pays the gas.

## Security

- The link carries the claim secret in the part after `#`, which browsers never send to a server.
- Even with the link, the money can only go to the address you entered.
- Do not post a send link publicly: anyone with it can see the amount and note.

## If it is not claimed

When the window ends, your Bitcoin Cash lock is refunded to you. You can also cancel an unclaimed link: the cancel key is derived from your recovery key and opens nothing else.
