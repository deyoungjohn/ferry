import type { ReactNode } from 'react';
import { Check, Clock, FileDown, Link2, Undo2 } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { chainIconUrl, tokenIconUrl } from '../../lib/icons';
import { cn } from '../../lib/cn';

/**
 * Product pictures for the public pages, drawn in code from the app's own parts and real
 * figures (amounts, durations and chains taken from swaps the solver has completed).
 */

/** A small label above a heading. */
export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-pill border border-hairline bg-surface-2 px-3 py-1 text-xs text-text-muted">
      <span className="size-1.5 rounded-full bg-lime" aria-hidden="true" />
      {children}
    </span>
  );
}

/** A token's artwork with the chain it sits on as a small badge on its corner. */
export function TokenMark({
  token,
  chain,
  size = 36,
}: {
  token: string;
  chain: number | 'bch';
  size?: number;
}) {
  const art = tokenIconUrl(token);
  const chainArt = chain === 'bch' ? null : chainIconUrl(chain);
  const badge = Math.round(size * 0.44);
  return (
    <span
      className="relative inline-flex shrink-0"
      style={{ width: size, height: size }}
    >
      {art ? (
        <img src={art} alt="" className="size-full rounded-full" />
      ) : (
        <span className="inline-flex size-full items-center justify-center rounded-full bg-surface-3 text-[10px] font-semibold text-text">
          {token.slice(0, 2)}
        </span>
      )}
      <span
        className="absolute -right-1 -top-1 inline-flex items-center justify-center overflow-hidden rounded-full border-2 border-surface-1 bg-lime text-[8px] font-bold text-lime-ink"
        style={{ width: badge, height: badge }}
      >
        {chain === 'bch' ? (
          '₿'
        ) : chainArt ? (
          <img src={chainArt} alt="" className="size-full object-cover" />
        ) : null}
      </span>
    </span>
  );
}

/** A white-on-dark product card, the frame every picture sits in. */
export function UiCard({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'rounded-well border border-hairline bg-surface-1 p-4 shadow-[0_24px_60px_rgba(0,0,0,0.45)]',
        className,
      )}
    >
      {children}
    </div>
  );
}

/** "5.00 USDC on Arbitrum → 4.98 PUSD on Bitcoin Cash", the head of a swap. */
export function SwapLine({
  from,
  to,
}: {
  from: { amount: string; token: string; chain: number | 'bch' };
  to: { amount: string; token: string; chain: number | 'bch' };
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="flex items-center gap-2.5">
        <TokenMark token={from.token} chain={from.chain} size={30} />
        <span className="text-sm font-semibold tabular-nums text-text">
          {from.amount} {from.token}
        </span>
      </span>
      <span className="flex items-center gap-2.5">
        <span className="text-sm font-semibold tabular-nums text-text">
          {to.amount} {to.token}
        </span>
        <TokenMark token={to.token} chain={to.chain} size={30} />
      </span>
    </div>
  );
}

const SWAP_STEPS = [
  { label: 'Price agreed', at: '20:41:02' },
  { label: 'Your funds locked', at: '20:41:09' },
  { label: "The solver's funds locked", at: '20:41:21' },
  { label: 'You claim your funds', at: '20:41:33' },
  { label: 'Done', at: '20:41:40' },
] as const;

/** The order page's steps, every one ticked, with the time each happened. */
export function StepsPreview({
  done = SWAP_STEPS.length,
  className,
}: {
  done?: number;
  className?: string;
}) {
  return (
    <ol className={cn('flex flex-col gap-2', className)}>
      {SWAP_STEPS.map((step, index) => {
        const reached = index < done;
        return (
          <li
            key={step.label}
            className={cn(
              'flex items-center justify-between rounded-xl border px-3 py-2.5',
              reached
                ? 'border-hairline bg-surface-2'
                : 'border-hairline/50 bg-surface-1 opacity-50',
            )}
          >
            <span className="flex items-center gap-2.5">
              <span
                className={cn(
                  'inline-flex size-5 items-center justify-center rounded-full',
                  reached
                    ? 'bg-lime text-lime-ink'
                    : 'border border-hairline text-text-dim',
                )}
              >
                {reached ? (
                  <Check className="size-3" strokeWidth={3} />
                ) : (
                  <span className="text-[10px]">{index + 1}</span>
                )}
              </span>
              <span className="text-xs text-text">{step.label}</span>
            </span>
            {reached && (
              <span className="font-mono text-[10px] text-text-dim">
                {step.at}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

const CHAINS = [
  { id: 1, name: 'Ethereum' },
  { id: 8453, name: 'Base' },
  { id: 42161, name: 'Arbitrum' },
  { id: 56, name: 'BNB Chain' },
  { id: 5042, name: 'Arc' },
  { id: 4663, name: 'Robinhood' },
] as const;

/** The six EVM chains as tiles on a diagonal, the way keys sit on a keyboard. */
export function ChainTiles() {
  return (
    <div className="relative h-56 w-full overflow-hidden" aria-hidden="true">
      <div className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 -rotate-[20deg] gap-3">
        {CHAINS.map((chain, index) => {
          const art = chainIconUrl(chain.id);
          return (
            <span
              key={chain.id}
              className={cn(
                'flex size-16 shrink-0 items-center justify-center rounded-[18px] border border-hairline shadow-[0_14px_0_rgba(0,0,0,0.35),0_24px_40px_rgba(0,0,0,0.4)]',
                index === 2 ? 'bg-lime' : 'bg-surface-3',
              )}
              style={{ transform: `translateY(${index % 2 ? 10 : -10}px)` }}
            >
              {art ? (
                <img
                  src={art}
                  alt=""
                  className="size-9 rounded-full object-cover"
                />
              ) : null}
            </span>
          );
        })}
      </div>
    </div>
  );
}

/** The six chains as a row of artwork with their names, for a quiet list. */
export function ChainRow({ className }: { className?: string }) {
  return (
    <ul
      className={cn('flex flex-wrap items-center gap-x-4 gap-y-2', className)}
    >
      {CHAINS.map((chain) => {
        const art = chainIconUrl(chain.id);
        return (
          <li
            key={chain.id}
            className="flex items-center gap-1.5 text-xs text-text-muted"
          >
            {art ? (
              <img src={art} alt="" className="size-4 rounded-full" />
            ) : null}
            {chain.name}
          </li>
        );
      })}
    </ul>
  );
}

/** A pay link that has been paid. */
export function PaidCard() {
  return (
    <div className="flex flex-col items-center gap-3">
      <UiCard className="w-60 text-center">
        <span className="mx-auto mb-3 inline-flex size-10 items-center justify-center rounded-full bg-lime text-lime-ink">
          <Check className="size-5" strokeWidth={3} />
        </span>
        <p className="text-sm font-semibold text-text">Paid 20.00 PUSD</p>
        <p className="mt-1 text-xs text-text-muted">
          The payer sent USDT on BNB Chain
        </p>
      </UiCard>
      <UiCard className="w-48 py-2.5 text-center">
        <p className="text-[11px] text-text-muted">Invoice 0x3ea… settled</p>
      </UiCard>
    </div>
  );
}

/** A send link, as the receiver sees it before claiming. */
export function SendLinkCard() {
  return (
    <UiCard className="w-64">
      <div className="flex items-center gap-2 text-[11px] text-text-muted">
        <Link2 className="size-3.5" />
        ferry.incepture.dev/send/0x9ed…
      </div>
      <p className="mt-3 text-lg font-semibold tabular-nums text-text">
        25.00 USDC
      </p>
      <p className="text-xs text-text-muted">to 0x87Ea…FaDd on Arbitrum</p>
      <div className="mt-4 flex h-9 items-center justify-center rounded-pill bg-lime text-xs font-semibold text-lime-ink">
        Claim
      </div>
    </UiCard>
  );
}

/** What the order page shows when the solver gives a lock back. */
export function ReleaseCard() {
  return (
    <div className="flex flex-col items-center gap-3">
      <UiCard className="w-64">
        <div className="flex items-center gap-2.5">
          <span className="inline-flex size-8 items-center justify-center rounded-full bg-surface-3 text-lime">
            <Undo2 className="size-4" />
          </span>
          <div>
            <p className="text-sm font-semibold text-text">
              The solver returned your funds
            </p>
            <p className="text-[11px] text-text-muted">
              9.00 USDC back on Arbitrum
            </p>
          </div>
        </div>
      </UiCard>
      <UiCard className="flex items-center justify-center gap-2 px-4 py-2.5">
        <Clock className="size-3.5 text-text-dim" />
        <p className="whitespace-nowrap text-[11px] text-text-muted">
          Otherwise refundable after 4.5 h
        </p>
      </UiCard>
    </div>
  );
}

/** The recovery file a swap saves before anything is locked. */
export function RecoveryFileCard() {
  return (
    <UiCard className="w-64">
      <div className="flex items-center gap-2.5">
        <span className="inline-flex size-8 items-center justify-center rounded-lg bg-surface-3 text-text">
          <FileDown className="size-4" />
        </span>
        <div className="min-w-0">
          <p className="truncate font-mono text-xs text-text">
            ferry-recovery-0x189b34.json
          </p>
          <p className="text-[11px] text-text-muted">
            Finish or refund without this site
          </p>
        </div>
      </div>
    </UiCard>
  );
}

/** The swap card at the moment of a quote. */
export function SwapCardPreview() {
  return (
    <UiCard className="w-full max-w-sm p-3">
      <div className="mb-2 flex items-center justify-between px-1 text-[11px] text-text-muted">
        <span>
          Available: <span className="font-semibold text-text">412 PUSD</span>
        </span>
        <span className="rounded-pill bg-olive-soft px-2.5 py-0.5 text-lime">
          Fast
        </span>
      </div>
      <div className="rounded-xl bg-surface-2 p-3">
        <p className="text-[11px] text-text-muted">You send</p>
        <div className="mt-1 flex items-center justify-between">
          <span className="text-2xl font-semibold tabular-nums text-text">
            8.00
          </span>
          <span className="flex items-center gap-2 rounded-pill border border-hairline bg-surface-1 py-1 pl-1 pr-3 text-xs font-semibold text-text">
            <TokenMark token="USDC" chain={42161} size={22} />
            USDC
          </span>
        </div>
      </div>
      <div className="mt-1.5 rounded-xl bg-surface-2 p-3">
        <p className="text-[11px] text-text-muted">You receive</p>
        <div className="mt-1 flex items-center justify-between">
          <span className="text-2xl font-semibold tabular-nums text-text">
            7.96
          </span>
          <span className="flex items-center gap-2 rounded-pill border border-hairline bg-surface-1 py-1 pl-1 pr-3 text-xs font-semibold text-text">
            <TokenMark token="PUSD" chain="bch" size={22} />
            PUSD
          </span>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between px-1 font-mono text-[10px] text-text-dim">
        <span>USDC $1.00 · PUSD $1.00</span>
        <span>spread 0.4%</span>
      </div>
      <div className="mt-2.5 flex h-10 items-center justify-center rounded-pill bg-lime text-sm font-semibold text-lime-ink">
        Ferry it
      </div>
    </UiCard>
  );
}

/** A pay link's QR, as it is printed or shared. */
export function PayLinkQrCard() {
  return (
    <UiCard className="w-56">
      <div className="rounded-lg bg-white p-3">
        <QRCodeSVG
          value="https://ferry.incepture.dev"
          size={176}
          className="h-auto w-full"
          aria-hidden="true"
        />
      </div>
      <p className="mt-3 text-sm font-semibold text-text">Pay 20.00 PUSD</p>
      <p className="text-[11px] text-text-muted">
        In any stablecoin, on any of six chains
      </p>
    </UiCard>
  );
}
