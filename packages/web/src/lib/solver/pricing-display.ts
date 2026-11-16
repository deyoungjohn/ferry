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
