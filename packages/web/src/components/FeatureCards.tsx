import { ShieldIcon, LockIcon, KeyIcon, InfoIcon } from './icons';

const FEATURES = [
  {
    icon: LockIcon,
    title: 'No bridge, no custodian',
    description:
      'Native smart contracts on EVM chains and CashTokens covenants on Bitcoin Cash. Nobody holds your funds.',
  },
  {
    icon: ShieldIcon,
    title: 'Refunds are automatic',
    description:
      'Every swap has a cryptographic timeout. If the counterparty does not claim, your funds refund directly to your wallet.',
  },
  {
    icon: KeyIcon,
    title: 'Gas-free where permits work',
    description:
      'Gas-free approvals via EIP-2612 typed signatures on supported stablecoins. No need to hold native gas on EVM chains.',
  },
  {
    icon: InfoIcon,
    title: '0.4% spread',
    description:
      'Transparent flat spread covering relayer fee carry and liquidity rebalancing. No hidden slippage.',
  },
] as const;

export function FeatureCards() {
  return (
    <section
      aria-label="Key features"
      className="mx-auto mt-16 max-w-5xl px-4 sm:px-6"
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {FEATURES.map((feature) => {
          const Icon = feature.icon;
          return (
            <div
              key={feature.title}
              className="rounded-card border border-hairline bg-surface-1/40 p-5 transition-colors hover:border-hairline/80 hover:bg-surface-1/70"
            >
              <div className="flex size-10 items-center justify-center rounded-xl bg-surface-2 text-lime mb-4">
                <Icon className="size-5" />
              </div>
              <h3 className="text-sm font-semibold text-text">
                {feature.title}
              </h3>
              <p className="mt-2 text-xs leading-relaxed text-text-muted">
                {feature.description}
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
