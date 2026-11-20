import type { ReactNode } from 'react';
import { Link } from 'react-router';
import {
  ArrowRight,
  BadgeCheck,
  Clock,
  FileDown,
  Gauge,
  Layers,
  Link2,
  Printer,
  Receipt,
  ScanLine,
  ShieldCheck,
  Timer,
  Undo2,
  UserCheck,
  Wallet,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { ROUTES } from '../lib/routes';
import { PegCards } from '../components/PegCards';
import {
  Eyebrow,
  PayLinkQrCard,
  PaidCard,
  RecoveryFileCard,
  ReleaseCard,
  SendLinkCard,
  StepsPreview,
  SwapCardPreview,
  SwapLine,
  UiCard,
} from '../components/marketing/visuals';

interface Point {
  readonly icon: LucideIcon;
  readonly title: string;
  readonly body: string;
}

function FeaturePanel({
  label,
  title,
  body,
  points,
  cta,
  picture,
}: {
  label: string;
  title: string;
  body: string;
  points: readonly Point[];
  cta: { to: string; text: string };
  picture: ReactNode;
}) {
  return (
    <section className="mx-auto mt-6 max-w-6xl px-4 sm:px-6">
      <div className="grid items-center gap-10 overflow-hidden rounded-card border border-hairline bg-surface-1 p-6 sm:p-10 lg:grid-cols-[1.05fr_1fr] lg:p-12">
        <div>
          <Eyebrow>{label}</Eyebrow>
          <h2 className="mt-5 text-3xl font-semibold leading-[1.1] tracking-[-0.03em] text-text sm:text-4xl">
            {title}
          </h2>
          <p className="mt-4 max-w-lg text-sm leading-relaxed text-text-muted sm:text-base">
            {body}
          </p>
          <dl className="mt-8 grid grid-cols-1 gap-x-8 gap-y-6 sm:grid-cols-2">
            {points.map((point) => (
              <div key={point.title}>
                <dt className="flex items-center gap-2.5 text-sm font-semibold text-text">
                  <point.icon className="size-4 text-text-muted" />
                  {point.title}
                </dt>
                <dd className="mt-1.5 text-sm leading-relaxed text-text-muted">
                  {point.body}
                </dd>
              </div>
            ))}
          </dl>
          <Link
            to={cta.to}
            className="mt-9 inline-flex h-11 items-center gap-2 rounded-pill bg-lime px-6 text-sm font-semibold text-lime-ink transition-opacity hover:opacity-90"
          >
            {cta.text}
            <ArrowRight className="size-4" />
          </Link>
        </div>
        <div className="flex min-h-80 items-center justify-center rounded-well bg-surface-2/60 p-6 sm:p-8">
          {picture}
        </div>
      </div>
    </section>
  );
}

export function FeaturesPage() {
  return (
    <div className="pb-20">
      <section className="mx-auto max-w-6xl px-4 pt-14 pb-6 sm:px-6">
        <h1 className="max-w-3xl text-4xl font-semibold leading-[1.05] tracking-[-0.04em] text-text sm:text-6xl">
          Swaps, payment links and send links between EVM chains and Bitcoin
          Cash
        </h1>
        <p className="mt-5 max-w-xl text-base leading-relaxed text-text-muted">
          Each one runs on two contracts and one secret, so nobody holds your
          money in between.
        </p>
      </section>

      <FeaturePanel
        label="Swap"
        title="Two-way swaps between six EVM chains and Bitcoin Cash"
        body="Send a stablecoin on an EVM chain and receive PUSD or MUSD in your Bitcoin Cash wallet, or the other way round. A solver provides the other side."
        points={[
          {
            icon: Layers,
            title: 'Six chains',
            body: 'Ethereum, Base, Arbitrum, BNB Chain, Arc and Robinhood Chain.',
          },
          {
            icon: Gauge,
            title: 'Fast or safe lane',
            body: 'Fast settles in about a minute; safe waits for full finality.',
          },
          {
            icon: Receipt,
            title: 'Prices you can check',
            body: 'Every quote signs its reference prices, sources and times.',
          },
          {
            icon: Wallet,
            title: 'Your wallets only',
            body: 'You sign each lock yourself. Ferry never holds a key of yours.',
          },
        ]}
        cta={{ to: ROUTES.swap, text: 'Open the swap' }}
        picture={
          <div className="flex w-full flex-col items-center gap-4">
            <SwapCardPreview />
          </div>
        }
      />

      <FeaturePanel
        label="Pay links"
        title="Get paid in PUSD by someone who holds USDC on Base"
        body="Create a link for an amount. The payer opens it, picks the stablecoin and chain they already have, and you receive PUSD or MUSD."
        points={[
          {
            icon: Link2,
            title: 'One link, any chain',
            body: 'The payer chooses from every enabled chain and token.',
          },
          {
            icon: BadgeCheck,
            title: 'Exact amount',
            body: 'You receive what you asked for; the payer sees the fee first.',
          },
          {
            icon: Printer,
            title: 'QR and print',
            body: 'Share it as a link, show the code, or print it for a counter.',
          },
          {
            icon: ScanLine,
            title: 'Paid status',
            body: 'Your list shows when each link was paid, with the order behind it.',
          },
        ]}
        cta={{ to: ROUTES.payLink, text: 'Create a pay link' }}
        picture={
          <div className="flex flex-wrap items-center justify-center gap-5">
            <PayLinkQrCard />
            <PaidCard />
          </div>
        }
      />

      <FeaturePanel
        label="Send links"
        title="Send stablecoins to someone who only uses another chain"
        body="Lock PUSD or MUSD on Bitcoin Cash and share a link. The person you named claims USDC on their chain; nobody else can."
        points={[
          {
            icon: UserCheck,
            title: 'Named receiver',
            body: 'Only the address in the link can claim. Other wallets are refused.',
          },
          {
            icon: Timer,
            title: 'Your window',
            body: 'Pick between one hour and seven days to claim.',
          },
          {
            icon: Clock,
            title: 'Unclaimed comes back',
            body: 'If nobody claims in time, your lock refunds to you.',
          },
          {
            icon: Link2,
            title: 'Secret in the link',
            body: 'The key travels in the link itself, never through our server.',
          },
        ]}
        cta={{ to: ROUTES.sendLink, text: 'Create a send link' }}
        picture={<SendLinkCard />}
      />

      <FeaturePanel
        label="Safety"
        title="Built so a stalled swap still ends with your money"
        body="Every lock has a way back that does not depend on this website or on the solver being honest."
        points={[
          {
            icon: Undo2,
            title: 'Early release',
            body: 'If the solver gives up on a swap from an EVM chain, it returns your lock at once.',
          },
          {
            icon: Clock,
            title: 'Deadline refund',
            body: 'Every lock refunds on its own deadline, also when everything else is down.',
          },
          {
            icon: FileDown,
            title: 'Recovery file',
            body: 'Saved before you lock. With it you can finish or refund from any computer.',
          },
          {
            icon: ShieldCheck,
            title: 'Verified contracts',
            body: 'One contract address on all six chains, its source verified on each.',
          },
        ]}
        cta={{ to: ROUTES.recover, text: 'Open recovery' }}
        picture={
          <div className="flex w-full flex-col items-center gap-4">
            <RecoveryFileCard />
            <ReleaseCard />
          </div>
        }
      />

      <section className="mx-auto mt-6 max-w-6xl px-4 sm:px-6">
        <div className="grid items-center gap-10 rounded-card border border-hairline bg-surface-1 p-6 sm:p-10 lg:grid-cols-2 lg:p-12">
          <div>
            <Eyebrow>Order page</Eyebrow>
            <h2 className="mt-5 text-3xl font-semibold leading-[1.1] tracking-[-0.03em] text-text sm:text-4xl">
              Every step, with the transaction that proves it
            </h2>
            <p className="mt-4 max-w-lg text-sm leading-relaxed text-text-muted sm:text-base">
              Each swap has its own page. It ticks the steps as the chains
              confirm them, links each transaction to the chain&apos;s explorer
              and keeps working if you close it and come back.
            </p>
          </div>
          <UiCard className="mx-auto w-full max-w-sm">
            <SwapLine
              from={{ amount: '9.00', token: 'USDC', chain: 42161 }}
              to={{ amount: '8.96', token: 'PUSD', chain: 'bch' }}
            />
            <StepsPreview className="mt-4" done={3} />
          </UiCard>
        </div>
      </section>

      <PegCards />
    </div>
  );
}
