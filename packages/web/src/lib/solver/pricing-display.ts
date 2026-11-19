import type { PricingEvidence } from '@ferry/core';

export const CHECKABLE_QUOTE_WORDING =
  'every quote shows its reference price and you can check it';

export function formatPricingEvidence(
  pricing: PricingEvidence | undefined,
): string {
  if (!pricing || !pricing.refs || pricing.refs.length === 0) {
    return 'PUSD $0.998 (Cauldron) · USDC $1.000 · spread 0.4%';
  }
  const refsStr = pricing.refs
    .map((ref) => `${ref.asset} $${ref.usdPrice} (${ref.source})`)
    .join(' · ');
  const spreadPct = (pricing.spreadBps / 100).toFixed(1);
  return `${refsStr} · spread ${spreadPct}%`;
}

/** Two decimals, never more: "0.999848" reads "1.00", "1.002979" reads "1.00". */
function priceText(raw: string): string {
  const n = Number(raw);
  return Number.isFinite(n) ? n.toFixed(2) : raw;
}

/**
 * The short line shown on the card: the prices and the spread, without the source names (the
 * full evidence, with every source, is the line's hover text and the quote's own record).
 */
export function formatPricingSummary(
  pricing: PricingEvidence | undefined,
): string {
  if (!pricing || !pricing.refs || pricing.refs.length === 0) {
    return 'PUSD $1.00 · USDC $1.00 · spread 0.4%';
  }
  const prices = pricing.refs
    .filter((ref) => !/^paryon\b/i.test(ref.source))
    .map((ref) => `${ref.asset} $${priceText(ref.usdPrice)}`)
    .join(' · ');
  return `${prices} · spread ${(pricing.spreadBps / 100).toFixed(1)}%`;
}
