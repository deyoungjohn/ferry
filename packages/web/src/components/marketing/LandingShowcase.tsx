import { useState } from 'react';
import { PREDICTED_FERRY_HTLC_ADDRESS } from '@ferry/chain-config/browser';
import { Check, Link2, ShieldCheck } from 'lucide-react';
import { CountUp, ScrollReveal } from './MotionPrimitives';
import { TokenMark } from './visuals';

const SHORT_HTLC = `${PREDICTED_FERRY_HTLC_ADDRESS.slice(0, 8)}···${PREDICTED_FERRY_HTLC_ADDRESS.slice(-6)}`;

/**
 * Two-column interactive product showcase highlighting Pay/Send Links
 * and deterministic multi-chain HTLC settlement cards.
 */
export function LandingShowcase() {
  const [linkMode, setLinkMode] = useState<'pay' | 'send'>('pay');

  return (
    <section
      aria-label="Links and deterministic settlement"
      className="mx-auto mt-24 max-w-6xl px-4 sm:px-6"
    >
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Left Card: Interactive Pay Link / Send Link preview + floating settlement toast */}
        <ScrollReveal delay={0}>
          <article className="group relative flex h-full flex-col overflow-hidden rounded-card border border-hairline bg-surface-1 p-7 transition-colors hover:border-lime/30 sm:p-10">
            <h2 className="max-w-sm text-2xl font-semibold uppercase leading-[1.08] tracking-[-0.03em] text-text sm:text-[28px]">
              Pay and send links with zero custody
            </h2>
            <p className="mt-3.5 max-w-md text-sm leading-relaxed text-text-muted">
              Ask for an exact PUSD or MUSD amount with a shareable link, or
              lock funds on Bitcoin Cash for a named receiver on any EVM chain.
            </p>

            {/* Layered interactive preview */}
            <div className="relative mt-8 flex-1 pt-2">
              <div className="rounded-well border border-hairline bg-surface-2/80 p-5 shadow-[0_20px_50px_rgba(0,0,0,0.35)]">
                {/* Interactive tab switcher */}
                <div
                  role="tablist"
                  aria-label="Link preview mode"
                  className="grid grid-cols-2 rounded-pill border border-hairline bg-surface-1 p-1"
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={linkMode === 'pay'}
                    onClick={() => setLinkMode('pay')}
                    className={`h-8 rounded-pill text-xs font-semibold transition-colors ${
                      linkMode === 'pay'
                        ? 'bg-lime text-lime-ink'
                        : 'text-text-muted hover:text-text'
                    }`}
                  >
                    Pay with Link
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={linkMode === 'send'}
                    onClick={() => setLinkMode('send')}
                    className={`h-8 rounded-pill text-xs font-semibold transition-colors ${
                      linkMode === 'send'
                        ? 'bg-lime text-lime-ink'
                        : 'text-text-muted hover:text-text'
                    }`}
                  >
                    Send with Link
                  </button>
                </div>

                <div className="mt-5 space-y-3.5">
                  <div>
                    <p className="text-[11px] text-text-muted">
                      {linkMode === 'pay'
                        ? 'Receive amount'
                        : 'Lock on Bitcoin Cash'}
                    </p>
                    <div className="mt-1.5 flex items-center justify-between rounded-xl border border-hairline bg-surface-1 px-3.5 py-2.5">
                      <span className="text-sm font-semibold tabular-nums text-text">
                        <CountUp value={25} decimals={2} /> PUSD
                      </span>
                      <span className="text-xs text-text-dim">Exact out</span>
                    </div>
                  </div>
                  <div>
                    <p className="text-[11px] text-text-muted">
                      {linkMode === 'pay'
                        ? 'Accepted from payer'
                        : 'Named receiver'}
                    </p>
                    <div className="mt-1.5 flex items-center justify-between rounded-xl border border-hairline bg-surface-1 px-3.5 py-2.5">
                      <span className="flex items-center gap-2 text-xs text-text-muted">
                        <Link2 className="size-3.5 text-lime" />
                        {linkMode === 'pay'
                          ? 'Any of 6 EVM chains · USDC, USDT, USDG'
                          : '0x71c9···4a82 on Arbitrum'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Floating glass activity card overlapping bottom-right */}
              <div className="mt-4 rounded-well border border-lime/25 bg-bg/95 p-4 shadow-[0_24px_60px_rgba(0,0,0,0.6)] backdrop-blur-md transition-transform duration-500 ease-out group-hover:-translate-y-1.5 sm:absolute sm:-bottom-2 sm:right-2 sm:mt-0 sm:w-64">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2">
                    <TokenMark token="USDC" chain={8453} size={26} />
                    <span className="text-xs font-medium text-text">
                      Base USDC
                    </span>
                  </span>
                  <span className="font-mono text-xs font-semibold text-lime">
                    +<CountUp value={25} decimals={2} prefix="$" />
                  </span>
                </div>
                <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-hairline pt-2.5">
                  <span className="flex items-center gap-2">
                    <TokenMark token="PUSD" chain="bch" size={26} />
                    <span className="text-xs font-medium text-text">
                      BCH PUSD
                    </span>
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-pill bg-lime/15 px-2 py-0.5 text-[10px] font-semibold text-lime">
                    <Check className="size-3" />
                    Settled
                  </span>
                </div>
              </div>
            </div>
          </article>
        </ScrollReveal>

        {/* Right Card: Overlapping holographic HTLC settlement cards peeking from bottom */}
        <ScrollReveal delay={110}>
          <article className="group relative flex h-full min-h-[430px] flex-col overflow-hidden rounded-card border border-hairline bg-surface-1 p-7 transition-colors hover:border-lime/30 sm:p-10">
            <h2 className="max-w-sm text-2xl font-semibold uppercase leading-[1.08] tracking-[-0.03em] text-text sm:text-[28px]">
              One contract across six EVM chains
            </h2>
            <p className="mt-3.5 max-w-md text-sm leading-relaxed text-text-muted">
              Deterministic deployment places the exact same verified hash-lock
              contract at one address across every EVM chain Ferry supports.
            </p>

            {/* Two overlapping iridescent Ferry settlement cards rising from bottom */}
            <div className="relative mt-auto flex h-56 items-end justify-center pt-10">
              {/* Back left card: emerald-teal-lime holographic */}
              <div
                className="relative -mr-8 h-48 w-52 -rotate-3 overflow-hidden rounded-2xl border border-white/15 p-4 shadow-[0_24px_60px_rgba(0,0,0,0.55)] transition-transform duration-500 ease-out group-hover:-translate-x-2 group-hover:-rotate-6"
                style={{
                  background:
                    'linear-gradient(150deg, #0ac18e 0%, #2674cb 52%, #0c1724 100%)',
                }}
              >
                <div className="flex items-center gap-2">
                  <img
                    src="/brand/ferry.svg"
                    alt=""
                    className="size-6 brightness-0 invert"
                  />
                  <span className="rounded-pill bg-black/35 px-2 py-0.5 font-mono text-[10px] text-white/95">
                    CREATE2
                  </span>
                </div>
                <p className="mt-14 font-mono text-[11px] tracking-wider text-white/85">
                  {SHORT_HTLC}
                </p>
                <p className="mt-1 text-xs font-semibold text-white">
                  <CountUp value={6} /> EVM Chains
                </p>
              </div>

              {/* Front right card: luminous Ferry lime + obsidian iridescent */}
              <div
                className="relative z-10 h-52 w-56 translate-y-4 rotate-2 overflow-hidden rounded-2xl border border-lime/40 p-4 shadow-[0_28px_70px_rgba(0,0,0,0.65)] transition-transform duration-500 ease-out group-hover:translate-x-2 group-hover:translate-y-1 group-hover:rotate-4"
                style={{
                  background:
                    'linear-gradient(155deg, #c6f219 0%, #8de44d 28%, #18230c 58%, #090b08 100%)',
                }}
              >
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-1.5 rounded-pill bg-lime-ink/90 px-2.5 py-1 text-[10px] font-semibold text-lime">
                    <ShieldCheck className="size-3" />
                    HTLC v1
                  </span>
                  <span className="font-mono text-[10px] font-semibold text-lime-ink/85">
                    0% custody
                  </span>
                </div>
                <p className="mt-16 font-mono text-[11px] tracking-wider text-white/90">
                  SHA-256 · Atomic Lock
                </p>
                <p className="mt-1 text-xs font-semibold text-lime">
                  <CountUp value={35} /> / <CountUp value={38} /> mutations
                  caught
                </p>
              </div>
            </div>
          </article>
        </ScrollReveal>
      </div>
    </section>
  );
}
