interface MarqueeItem {
  readonly label: string;
  readonly kind: 'EVM' | 'BCH' | 'Stablecoin';
  readonly icon: string;
}

const MARQUEE_ITEMS: readonly MarqueeItem[] = [
  // Six supported EVM chains
  { label: 'Ethereum', kind: 'EVM', icon: '/brand/chains/ethereum.svg' },
  { label: 'Base', kind: 'EVM', icon: '/brand/chains/base.svg' },
  { label: 'Arbitrum', kind: 'EVM', icon: '/brand/chains/arbitrum.svg' },
  { label: 'BNB Chain', kind: 'EVM', icon: '/brand/chains/bnb.svg' },
  { label: 'Arc', kind: 'EVM', icon: '/brand/chains/arc.jpg' },
  { label: 'Robinhood', kind: 'EVM', icon: '/brand/chains/robinhood.png' },
  // Bitcoin Cash
  { label: 'Bitcoin Cash', kind: 'BCH', icon: '/brand/chains/bch.svg' },
  // Five supported stablecoins
  { label: 'USDC', kind: 'Stablecoin', icon: '/brand/tokens/usdc.svg' },
  { label: 'USDT', kind: 'Stablecoin', icon: '/brand/tokens/usdt.svg' },
  { label: 'USDG', kind: 'Stablecoin', icon: '/brand/tokens/usdg.svg' },
  { label: 'PUSD', kind: 'Stablecoin', icon: '/brand/tokens/pusd.svg' },
  { label: 'MUSD', kind: 'Stablecoin', icon: '/brand/tokens/musd.png' },
];

function MarqueePill({ item }: { item: MarqueeItem }) {
  return (
    <div className="flex shrink-0 items-center gap-3 rounded-pill border border-hairline bg-surface-1/85 px-4 py-2.5 shadow-[0_8px_24px_rgba(0,0,0,0.22)] transition-colors hover:border-lime/40">
      <img
        src={item.icon}
        alt=""
        className="size-6 shrink-0 rounded-full object-cover"
      />
      <span className="text-sm font-medium tracking-[-0.01em] text-text">
        {item.label}
      </span>
      <span
        className={`rounded-pill px-2 py-0.5 text-[10px] font-medium ${
          item.kind === 'BCH'
            ? 'bg-lime/15 text-lime'
            : item.kind === 'Stablecoin'
              ? 'bg-surface-3 text-text-muted'
              : 'bg-surface-2 text-text-dim'
        }`}
      >
        {item.kind}
      </span>
    </div>
  );
}

/**
 * Right-to-left continuous marquee showcasing Ferry's six EVM chains,
 * Bitcoin Cash, and five stablecoins right below the hero section.
 */
export function AssetMarquee() {
  return (
    <section
      aria-label="Supported chains and stablecoins"
      className="mx-auto mt-10 max-w-7xl px-4 sm:px-6"
    >
      <div
        className="ferry-marquee relative overflow-hidden py-2"
        style={{
          maskImage:
            'linear-gradient(to right, transparent 0%, #000 8%, #000 92%, transparent 100%)',
          WebkitMaskImage:
            'linear-gradient(to right, transparent 0%, #000 8%, #000 92%, transparent 100%)',
        }}
      >
        <div className="ferry-marquee-track gap-3">
          <div className="flex shrink-0 items-center gap-3 pr-3">
            {MARQUEE_ITEMS.map((item) => (
              <MarqueePill key={`a-${item.label}`} item={item} />
            ))}
          </div>
          <div
            aria-hidden="true"
            className="flex shrink-0 items-center gap-3 pr-3"
          >
            {MARQUEE_ITEMS.map((item) => (
              <MarqueePill key={`b-${item.label}`} item={item} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
