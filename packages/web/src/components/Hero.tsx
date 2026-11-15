export function Hero() {
  return (
    <section className="mx-auto flex max-w-4xl flex-col items-center px-4 pt-8 pb-6 text-center sm:px-6 sm:pt-12">
      <div className="inline-flex items-center gap-2 rounded-pill border border-hairline bg-surface-2 px-3 py-1 text-xs text-text-muted mb-6">
        <span className="size-1.5 rounded-full bg-lime shadow-[0_0_8px_var(--lime)]" />
        Two-way atomic swaps · No custodian
      </div>
      <h1 className="text-4xl font-semibold tracking-[-0.04em] text-text sm:text-5xl md:text-6xl max-w-3xl leading-[1.12]">
        Move dollars onto Bitcoin Cash{' '}
        <span className="font-accent italic text-lime text-glow">
          without a bridge
        </span>
      </h1>
      <p className="mt-4 max-w-2xl text-base text-text-muted leading-relaxed sm:text-lg">
        Swap USDC or USDT on six chains for PUSD or MUSD, both ways. Nothing
        wrapped. Nobody holds your money.
      </p>
    </section>
  );
}
