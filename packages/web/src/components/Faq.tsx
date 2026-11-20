import { FAQ_ITEMS } from '../lib/copy';
import { BouncyAccordion } from './ui/bouncy-accordion';

/** The questions people ask, on the landing and features pages. */
export function Faq() {
  return (
    <section
      id="faq"
      aria-label="Frequently asked questions"
      className="mx-auto mt-20 max-w-3xl scroll-mt-24 px-4 sm:px-6"
    >
      <div className="mb-8 text-center">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-lime">
          Transparency
        </p>
        <h2 className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-text sm:text-3xl">
          Frequently asked questions and honest risks
        </h2>
      </div>
      <BouncyAccordion
        items={FAQ_ITEMS.map((item, index) => ({
          id: `faq-${index}`,
          title: item.question,
          description: item.answer,
        }))}
      />
    </section>
  );
}
