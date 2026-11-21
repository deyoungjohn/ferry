# FAQ

## How is this different from a bridge?

A bridge holds deposits and issues a wrapped token. Ferry holds nothing: each swap is two contracts, one per chain, opened by the same secret. You receive the real token on the other chain, from a solver who receives yours. See [Atomic swaps](/docs/atomic-swaps).

## Can the solver steal my money?

No. Your lock pays the solver only if the secret is shown, and the secret becomes public only when you claim the solver's lock. If the solver does nothing, your lock is refunded after its deadline. See [Trust model](/docs/trust-model).

## What if the website or the solver goes offline?

Your wallet can find and finish or refund every swap from [Recover](/docs/recovery), and `recover.html` works with a recovery file and no Ferry server at all.

## Do I need gas?

Not on most routes: the solver relays your lock and claim and includes the cost in the quote. Tokens without a permit (USDT on Ethereum, tokens on BNB Chain) need an approve transaction. See [Fees, limits and lanes](/docs/fees-and-limits).

## How long does a swap take?

About a minute into Bitcoin Cash on the fast lane. Out of Bitcoin Cash, under a minute on the fast lane (up to $25) or about ten minutes on the safe lane, which waits for one block.

## Which wallets work?

Most EVM wallets, and Bitcoin Cash wallets that support WizardConnect, such as Paytaca. To swap into Bitcoin Cash you only need a token address (`bitcoincash:z…`). See [Wallets](/docs/wallets).

## What does it cost?

A 0.05% spread today, shown in every quote before you confirm. See [Fees, limits and lanes](/docs/fees-and-limits).

## Is Ferry audited?

No. It is tested heavily ([How Ferry was tested](/docs/testing)) but has had no external audit, which is why swaps are capped at $50.

## Who runs the solver?

Today, the Ferry team. Anyone can run one: the contracts do not know who the solver is, and the app can compare quotes from several. See [The solver](/docs/solver).
