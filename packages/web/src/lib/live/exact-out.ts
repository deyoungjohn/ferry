import type { QuoteInput, UserSwapDependencies } from '@ferry/user-flow';
import { previewSwap } from './run';

/**
 * How much the payer must send for the recipient to get exactly `targetCents` (PUSD or MUSD have 2
 * decimals): ask the solver for prices until the amount received reaches the target without
 * overshooting by more than a cent or two. The solver's own fee is a fixed part plus a share, so
 * a few rounds converge.
 */
export async function amountInForExactOut(
  deps: UserSwapDependencies,
  base: Omit<QuoteInput, 'amountIn'>,
  targetCents: bigint,
  preview: (
    deps: UserSwapDependencies,
    input: QuoteInput,
  ) => Promise<{ terms: { bchTokenAmount: bigint | string } }> = previewSwap,
): Promise<{ amountIn: bigint; receivedCents: bigint }> {
  const unit = 10n ** BigInt(Math.max(0, base.evmTokenDecimals - 2)); // one cent in the payer's units
  let amountIn = targetCents * unit + unit * 10n; // start about ten cents above par
  let receivedCents = 0n;
  for (let round = 0; round < 5; round++) {
    const priced = await preview(deps, { ...base, amountIn });
    receivedCents = BigInt(priced.terms.bchTokenAmount);
    if (receivedCents >= targetCents) {
      // Enough: trim a cent at a time while the recipient still gets the full amount, so the
      // payer does not pay more than the price needs.
      let best = { amountIn, receivedCents };
      for (let trim = 0; trim < 6 && best.receivedCents > targetCents; trim++) {
        const lower = best.amountIn - unit;
        if (lower <= 0n) break;
        const again = await preview(deps, { ...base, amountIn: lower });
        const got = BigInt(again.terms.bchTokenAmount);
        if (got < targetCents) break;
        best = { amountIn: lower, receivedCents: got };
      }
      return best;
    }
    // Move by the shortfall (or the overshoot), plus a cent so rounding does not stall it.
    const diff = targetCents - receivedCents;
    amountIn += diff * unit + (diff >= 0n ? unit : -unit);
    if (amountIn <= 0n) amountIn = unit;
  }
  if (receivedCents >= targetCents) return { amountIn, receivedCents };
  throw new Error(
    'Could not find a price that pays the exact amount. Try again in a moment.',
  );
}
