import { useState } from 'react';
import { ChevronDownIcon } from './icons';

const FAQ_ITEMS = [
  {
    question: 'How is this different from a cross-chain bridge?',
    answer:
      'Ferry is not a bridge. There are no wrapped tokens, no custodian, and no central multi-sig pool. Swaps are peer-to-peer Hash Time Locked Contracts (HTLCs). Either both sides claim their native stablecoins, or both sides get their deposits refunded.',
  },
  {
    question: 'What are the honest risks of stablecoins on Bitcoin Cash?',
    answer:
      'PUSD and MUSD are native CashTokens stablecoins on Bitcoin Cash. Ferry executes atomic swaps at the quoted exchange rate, but does not guarantee the secondary market stability of the underlying stablecoins. Always verify DEX liquidity and peg conditions before transacting.',
  },
  {
    question: 'What happens if the counterparty disappears or fails to lock?',
    answer:
      'Every contract is bound by a strict cryptographic deadline. If the solver or counterparty fails to counter-lock before the deadline, your funds unlock automatically and can be refunded back to your wallet. Neither party can steal funds.',
  },
  {
    question: 'How does the Fast Lane (0-conf) work safely?',
    answer:
      'The Fast lane supports amounts up to $25 and accepts unconfirmed (0-conf) Bitcoin Cash transactions accompanied by real-time Double-Spend Proof (DSProof) network monitoring via Electrum. Amounts above $25 automatically use the Safe lane, which requires at least 1 on-chain confirmation.',
  },
  {
    question: 'Can I recover my funds if this website goes offline?',
    answer:
      'Yes. When you initiate a swap, you can download a standalone recovery file before locking funds. Even if this site and the solver go offline, you can claim or refund directly using our standalone recovery page or the @ferry/recover-cli terminal recovery tool (pnpm -w recover) via public RPC nodes without using Ferry servers.',
  },
] as const;

export function Faq() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  function toggle(idx: number) {
    setOpenIndex((cur) => (cur === idx ? null : idx));
  }

  return (
    <section
      id="faq"
      aria-label="Frequently Asked Questions"
      className="mx-auto mt-20 max-w-3xl px-4 sm:px-6"
    >
      <div className="text-center mb-8">
        <p className="text-[11px] font-semibold tracking-wider text-lime uppercase">
          Transparency
        </p>
        <h2 className="mt-2 text-2xl sm:text-3xl font-semibold tracking-[-0.03em] text-text">
          Frequently Asked Questions & Honest Risks
        </h2>
      </div>

      <div className="divide-y divide-hairline rounded-card border border-hairline bg-surface-1">
        {FAQ_ITEMS.map((item, idx) => {
          const isOpen = openIndex === idx;
          return (
            <div key={item.question} className="p-5">
              <button
                type="button"
                onClick={() => toggle(idx)}
                aria-expanded={isOpen}
                className="flex w-full items-center justify-between text-left text-sm font-medium text-text hover:text-lime transition-colors cursor-pointer"
              >
                <span>{item.question}</span>
                <ChevronDownIcon
                  className={`size-4 shrink-0 text-text-muted transition-transform duration-200 ${
                    isOpen ? 'rotate-180 text-lime' : ''
                  }`}
                />
              </button>
              {isOpen && (
                <p className="mt-3 text-xs leading-relaxed text-text-muted pr-4">
                  {item.answer}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
