import { lazy, Suspense, type ReactNode } from 'react';
import { cn } from '../../lib/cn';
import {
  ChainTiles,
  PaidCard,
  ReleaseCard,
  SendLinkCard,
  StepsPreview,
  SwapLine,
  UiCard,
} from './visuals';

const RotatingChainCoins = lazy(() =>
  import('./RotatingChainCoins').then((m) => ({
    default: m.RotatingChainCoins,
  })),
);

function Tile({
  title,
  body,
  children,
  className,
  tone = 'plain',
}: {
  title: ReactNode;
  body: string;
  children: ReactNode;
  className?: string;
  tone?: 'plain' | 'deep';
}) {
  return (
    <article
      className={cn(
        'relative flex flex-col overflow-hidden rounded-card border border-hairline p-6 sm:p-8',
        tone === 'deep' ? 'bg-olive-ink' : 'bg-surface-1',
        className,
      )}
    >
      <h3 className="max-w-xs text-2xl font-semibold leading-tight tracking-[-0.03em] text-text sm:text-[28px]">
        {title}
      </h3>
      <p className="mt-3 max-w-sm text-sm leading-relaxed text-text-muted">
        {body}
      </p>
      <div className="mt-6 flex flex-1 items-end justify-center">
        {children}
      </div>
    </article>
  );
}

/** What Ferry does, as five cards: one large picture each. */
export function FeatureBento() {
  return (
    <section
      aria-labelledby="features-heading"
      className="mx-auto mt-24 max-w-6xl px-4 sm:px-6"
    >
      <h2
        id="features-heading"
        className="max-w-2xl text-3xl font-semibold tracking-[-0.03em] text-text sm:text-4xl"
      >
        Everything a stablecoin needs to reach Bitcoin Cash
      </h2>

      <div className="mt-10 grid grid-cols-1 gap-4 md:grid-cols-6">
        <Tile
          tone="deep"
          className="md:col-span-3"
          title={
            <>
              Swap in about <span className="text-lime">a minute</span>
            </>
          }
          body="Lock on your chain, the solver locks on the other, you claim. Each step is on the order page as it happens, with the transaction that proves it."
        >
          <UiCard className="w-full max-w-sm">
            <SwapLine
              from={{ amount: '5.00', token: 'PUSD', chain: 'bch' }}
              to={{ amount: '4.98', token: 'USDC', chain: 42161 }}
            />
            <StepsPreview className="mt-4" />
          </UiCard>
        </Tile>

        <Tile
          className="md:col-span-3"
          title="Six EVM chains, one contract address"
          body="Ethereum, Base, Arbitrum, BNB Chain, Arc and Robinhood Chain. USDC, USDT and USDG on one side; PUSD and MUSD on the other."
        >
          <Suspense fallback={<ChainTiles />}>
            <RotatingChainCoins />
          </Suspense>
        </Tile>

        <Tile
          className="md:col-span-2"
          title="Get paid with a link"
          body="Ask for an amount in PUSD or MUSD. The payer pays in whatever stablecoin and chain they hold."
        >
          <PaidCard />
        </Tile>

        <Tile
          className="md:col-span-2"
          title="Send to someone on another chain"
          body="Lock on Bitcoin Cash and share a link. Only the address you named can claim it."
        >
          <SendLinkCard />
        </Tile>

        <Tile
          className="md:col-span-2"
          title="Your money comes back"
          body="If the solver won't finish a swap from an EVM chain, it returns your lock at once. Every lock also refunds on its own deadline."
        >
          <ReleaseCard />
        </Tile>
      </div>
    </section>
  );
}
