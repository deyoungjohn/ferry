# Pay links

A pay link asks for money. You choose the Bitcoin Cash address that receives it and the token (PUSD or MUSD); the payer pays with any supported stablecoin on any of the six EVM chains. Every payment is an ordinary forward swap, so it is atomic and refundable like any other.

## Create a pay link

1. Open [Pay link](/app/pay-link).
2. Enter your Bitcoin Cash token address (it starts with `bitcoincash:z`), or use your connected wallet's address.
3. Choose PUSD or MUSD.
4. Choose a **fixed amount** (the payer pays exactly that, plus the fee shown to them) or an **open amount** (the payer types it).
5. Add an optional note for the payer, up to 140 characters.
6. Press **Generate pay link**. Copy the link or show the QR code.

Your links appear under **All pay links** with their status. With your Bitcoin Cash wallet connected, links made in another browser for any of its addresses appear too. You can delete a link that has not been paid from the browser that made it.

## What the payer sees

The payer opens the link, picks the chain and the stablecoin they hold, and sees exactly what they pay and what you receive. They connect an EVM wallet and confirm. Their stablecoin is locked, the solver locks your PUSD or MUSD, and the claim pays your address. The payer does not need a Bitcoin Cash wallet or any BCH.

## Fees

The payer pays the fee on top, so you receive the amount you asked for. The quote shows it before they confirm.

## Privacy

A pay link shows your receiving address and the note to anyone who has the link. Open (unpaid) links are stored by the solver so the link can be opened; paid links are visible on chain like any swap.
