# Known limitations

Said plainly, so nobody is surprised.

- **No external audit.** The contracts and the solver are tested heavily (see [How Ferry was tested](/docs/testing)) but have not been audited by an outside firm.
- **Small limits.** Swaps are capped at $50 and the fast lane at $25 while Ferry is new on mainnet.
- **One solver today.** The protocol and the web app support several solvers competing on price, but one solver runs today. If it is offline, swaps cannot start; swaps already started can always be refunded.
- **Bitcoin Cash to EVM on the safe lane waits for a block**, about ten minutes on average and sometimes much longer. Send links always use the safe lane.
- **Phone wallets must be awake to sign.** WizardConnect pairings are remembered, but a suspended wallet app cannot answer until it is opened.
- **Gas without a permit.** USDT on Ethereum and both tokens on BNB Chain need an approve transaction, which needs a little native gas.
- **Bridged USDT on BNB Chain.** It is a Binance-issued BEP-20 token, not a native Tether issuance, and carries Binance's bridge risk.
- **Open pay links are stored by the solver** so that the link can be opened; paid links and all send links can be checked on chain.
- **Smart-contract wallets** that do not sign deterministically cannot use the wallet-derived recovery key and fall back to a recovery file per swap.
