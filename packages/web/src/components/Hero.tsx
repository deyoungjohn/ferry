export function Hero() {
  return (
    <section className="mx-auto flex max-w-3xl flex-col items-center px-4 pt-3 pb-2 text-center sm:px-6 sm:pt-5 sm:pb-3">
      <h1 className="text-2xl font-semibold tracking-[-0.03em] text-text sm:text-3xl md:text-4xl max-w-2xl leading-tight">
        Move stablecoins onto Bitcoin Cash{' '}
        <span className="font-accent text-lime inline-block whitespace-nowrap">
          without a bridge
        </span>
      </h1>
      <p className="mt-1.5 max-w-xl text-xs text-text-muted leading-relaxed sm:text-sm">
        Swap USDC or USDT on EVM chains for PUSD or MUSD, both ways. Nothing
        wrapped. Nobody holds your money.
      </p>
    </section>
  );
}
