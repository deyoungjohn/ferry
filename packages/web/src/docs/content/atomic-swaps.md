# Atomic swaps

A Ferry swap is two hash time-locked contracts (HTLCs) that open with the same secret. That one idea gives the guarantee: both sides happen, or neither does.

## One secret, two locks

1. The person who starts the swap has a 32-byte **secret** and publishes only its hash, the **hash lock** (`sha256(secret)`).
2. **You lock** your funds in a contract on your chain: "pay the solver if someone shows the secret before the deadline; otherwise return it to me."
3. **The solver locks** its funds on the other chain: "pay you if someone shows the secret before an earlier deadline; otherwise return it to the solver."
4. **You claim** the solver's lock. Claiming publishes the secret on chain.
5. **The solver claims** your lock with the secret it just saw.

```text
 You                                         Solver
 ---                                         ------
 lock A on chain X  (hash H, deadline T1)  -->
                                           <--  lock B on chain Y (hash H, deadline T2 < T1)
 claim B with the secret S   (S is now public)
                                           -->  claim A with S
```

## Why it is safe for you

- The solver cannot take your lock without the secret, and the secret becomes public only when you are paid.
- The solver's lock expires first (`T2 < T1`). If you claim at any time before `T2`, the solver still has until `T1` to claim yours, so nobody is left out.
- If the solver never locks, your lock simply expires and you refund it.

## Why it is safe for the solver

- Your claim reveals the secret on a public chain. The solver watches both chains and the mempool, and has until `T1` to use it.
- The terms (amounts, addresses, deadlines) are fixed in the contracts when they are made, and the quote is signed, so neither side can change them later.

## What "atomic" does not mean

Both claims are separate transactions on separate chains, so they do not happen in the same instant. Atomic means the outcome is all or nothing: there is no path where one side is paid and the other is not, as long as each party acts before its deadline. The deadlines are chosen so that a party always has hours to act. See [Timeouts and refunds](/docs/timing).
