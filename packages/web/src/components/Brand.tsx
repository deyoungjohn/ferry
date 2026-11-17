/** The Ferry mark and name. Used by the navigation bar and the footer. */
export function Brand({ className = 'h-8' }: { className?: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <img
        src="/brand/ferry.svg"
        alt=""
        aria-hidden="true"
        className={`${className} w-auto`}
      />
      <span className="text-[1.35rem] leading-none font-semibold tracking-[-0.04em] text-text">
        Ferry
      </span>
    </span>
  );
}
