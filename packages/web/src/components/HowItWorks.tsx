import { HOW_IT_WORKS_STEPS } from '../lib/copy';
import { LockIcon, KeyIcon, ArrowRightIcon } from './icons';

const STEP_ICONS = [LockIcon, LockIcon, KeyIcon] as const;

export function HowItWorks() {
  return (
    <section
      id="how-it-works"
      aria-label="How it works"
      className="mx-auto mt-20 max-w-5xl px-4 sm:px-6"
    >
      <div className="text-center mb-10">
        <p className="text-[11px] font-semibold tracking-wider text-lime uppercase">
          Mechanism
        </p>
        <h2 className="mt-2 text-2xl sm:text-3xl font-semibold tracking-[-0.03em] text-text">
          How Ferry Swaps Work
        </h2>
        <p className="mt-2 text-xs sm:text-sm text-text-muted max-w-lg mx-auto">
          Trust-minimised atomic swaps. No wrapped assets. Neither party can
          take funds without fulfilling their half of the swap.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-3 relative">
        {HOW_IT_WORKS_STEPS.map((step, idx) => {
          const Icon = STEP_ICONS[idx] ?? LockIcon;
          return (
            <div
              key={step.number}
              className="relative flex flex-col rounded-card border border-hairline bg-surface-1/60 p-6"
            >
              <div className="flex items-center justify-between mb-4">
                <span className="font-mono text-xs font-bold text-lime">
                  STEP {step.number}
                </span>
                <div className="flex size-9 items-center justify-center rounded-xl bg-surface-2 text-text">
                  <Icon className="size-4 text-lime" />
                </div>
              </div>
              <h3 className="text-base font-semibold text-text">
                {step.title}
              </h3>
              <p className="text-xs font-medium text-text-muted mb-2">
                {step.subtitle}
              </p>
              <p className="text-xs leading-relaxed text-text-muted">
                {step.description}
              </p>
              {idx < HOW_IT_WORKS_STEPS.length - 1 && (
                <div
                  className="hidden md:flex absolute -right-3 top-1/2 -translate-y-1/2 z-10 size-6 items-center justify-center rounded-full bg-surface-3 text-text-muted"
                  aria-hidden="true"
                >
                  <ArrowRightIcon className="size-3" />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
