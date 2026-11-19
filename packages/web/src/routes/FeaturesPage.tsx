import { Link } from 'react-router';
import { ROUTES } from '../lib/routes';
import { FeatureCards } from '../components/FeatureCards';
import { PegCards } from '../components/PegCards';

const DETAILS = [
  {
    title: 'Swap',
    body: 'Send a stablecoin on an EVM chain and receive PUSD or MUSD on Bitcoin Cash, or the other way round. A solver provides the liquidity; the contracts make sure you either get the other side or get your own funds back.',
  },
  {
    title: 'Pay links',
    body: 'Share a link and let anyone pay you in the stablecoin and chain they already hold. You receive PUSD or MUSD in your Bitcoin Cash wallet. The payer sees the exact amount you asked for, plus the quoted fee.',
  },
  {
    title: 'Send links',
    body: 'Send stablecoins from Bitcoin Cash to a person who only uses another chain. The link names the chain, the receiving address and a time window; the contract on that chain enforces them.',
  },
  {
    title: 'Recovery without us',
    body: 'Before you lock anything you can download a recovery file. With it, and a command line tool, you can finish or refund a swap even if this website and the solver are offline.',
  },
  {
    title: 'Checkable prices',
    body: 'Every quote carries its reference prices, their sources and timestamps inside the signed terms, so you can see what the price was based on instead of taking our word for it.',
  },
  {
    title: 'Your activity from the chain',
    body: 'My Activity is rebuilt from the Bitcoin Cash chain and the EVM contracts, not from our database.',
  },
] as const;

export function FeaturesPage() {
  return (
    <div className="pb-16">
      <section className="mx-auto max-w-3xl px-4 pt-14 pb-4 text-center sm:px-6">
        <h1 className="text-3xl font-semibold tracking-[-0.03em] text-text sm:text-5xl">
          What Ferry does
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-text-muted sm:text-base">
          A swap protocol for stablecoins between EVM chains and Bitcoin Cash,
          with links for getting paid and for sending money to other chains.
        </p>
      </section>

      <FeatureCards />

      <section
        aria-label="In detail"
        className="mx-auto mt-14 grid max-w-5xl grid-cols-1 gap-5 px-4 sm:grid-cols-2 sm:px-6"
      >
        {DETAILS.map((item) => (
          <article
            key={item.title}
            className="rounded-card border border-hairline bg-surface-1/40 p-6"
          >
            <h2 className="text-base font-semibold text-text">{item.title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-text-muted">
              {item.body}
            </p>
          </article>
        ))}
      </section>

      <PegCards />

      <div className="mt-12 text-center">
        <Link
          to={ROUTES.swap}
          className="inline-flex h-11 items-center rounded-pill bg-lime px-7 text-sm font-semibold text-lime-ink transition-opacity hover:opacity-90"
        >
          Open Ferry
        </Link>
      </div>
    </div>
  );
}
