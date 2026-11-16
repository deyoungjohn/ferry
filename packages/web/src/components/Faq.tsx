import { useState } from 'react';
import { FAQ_ITEMS } from '../lib/copy';
import { ChevronDownIcon } from './icons';

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
