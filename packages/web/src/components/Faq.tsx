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
        <h2 className="text-2xl font-semibold tracking-[-0.03em] text-text sm:text-3xl">
          Frequently Asked Questions
        </h2>
      </div>
      <BouncyAccordion
        items={FAQ_ITEMS.map((item, index) => ({
          id: `faq-${index}`,
          title: item.question,
          description: item.answer,
        }))}
      />
      <p className="mt-6 text-center text-sm text-text-muted">
        More answers in the{' '}
        <a
          href="/docs/faq"
          className="font-medium text-lime underline-offset-4 hover:underline"
        >
          docs
        </a>
        .
      </p>
    </section>
  );
}
