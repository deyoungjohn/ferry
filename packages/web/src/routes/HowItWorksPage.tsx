import { HowItWorks } from '../components/HowItWorks';
import { Faq } from '../components/Faq';

export function HowItWorksPage() {
  return (
    <div className="pb-16">
      <section className="mx-auto max-w-3xl px-4 pt-14 pb-2 text-center sm:px-6">
        <h1 className="text-3xl font-semibold tracking-[-0.03em] text-text sm:text-5xl">
          How it works
        </h1>
      </section>
      <HowItWorks />
      <Faq />
    </div>
  );
}
