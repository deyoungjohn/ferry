import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '../../lib/cn';

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return true;
  return (
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  );
}

function canObserveIntersection(): boolean {
  return (
    typeof window !== 'undefined' && typeof IntersectionObserver !== 'undefined'
  );
}

/**
 * Fade + slide-in reveal triggered once when an element enters the viewport.
 * Renders immediately visible under reduced motion or in test environments
 * without IntersectionObserver so accessibility and contrast checks always pass.
 */
export function ScrollReveal({
  children,
  className,
  delay = 0,
  y = 22,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  y?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const immediate = !canObserveIntersection() || prefersReducedMotion();
  const [visible, setVisible] = useState(immediate);

  useEffect(() => {
    if (immediate) {
      setVisible(true);
      return;
    }
    const el = ref.current;
    if (!el) return;

    // If already within viewport on initial paint, reveal cleanly right away
    const rect = el.getBoundingClientRect();
    if (rect.top < window.innerHeight * 0.96 && rect.bottom > 0) {
      setVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.08, rootMargin: '0px 0px -32px 0px' },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [immediate]);

  return (
    <div
      ref={ref}
      className={cn('will-change-[opacity,transform]', className)}
      style={{
        opacity: visible ? 1 : 0,
        transform: visible
          ? 'translate3d(0, 0, 0)'
          : `translate3d(0, ${y}px, 0)`,
        transition: immediate
          ? undefined
          : `opacity 620ms cubic-bezier(0.22, 1, 0.36, 1) ${delay}ms, transform 620ms cubic-bezier(0.22, 1, 0.36, 1) ${delay}ms`,
      }}
    >
      {children}
    </div>
  );
}

export interface CountUpProps {
  /** Target numeric value to count up to. */
  value: number;
  /** Number of decimal places (default 0). */
  decimals?: number | undefined;
  /** Minimum integer digits for zero-padding (e.g., 2 -> "01", "02"). */
  padInteger?: number | undefined;
  /** Include thousands separators (default true). */
  useGrouping?: boolean | undefined;
  /** Optional prefix such as "$", "+", or "~". */
  prefix?: string | undefined;
  /** Optional suffix such as "%", " s", "+", or "m". */
  suffix?: string | undefined;
  /** Animation duration in milliseconds (default 1050). */
  duration?: number | undefined;
  className?: string | undefined;
}

function formatNumber(
  num: number,
  decimals: number,
  padInteger: number | undefined,
  useGrouping: boolean,
): string {
  if (padInteger !== undefined && decimals === 0) {
    return String(Math.round(num)).padStart(padInteger, '0');
  }
  return num.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    useGrouping,
  });
}

/**
 * Scroll-triggered count-up number animation.
 * Plays smoothly from 0 to `value` when scrolled into view; immediately renders
 * the exact target value under `prefers-reduced-motion` or headless/jsdom tests.
 */
export function CountUp({
  value,
  decimals = 0,
  padInteger,
  useGrouping = true,
  prefix = '',
  suffix = '',
  duration = 1050,
  className,
}: CountUpProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const immediate = !canObserveIntersection() || prefersReducedMotion();
  const [display, setDisplay] = useState<number>(value);
  const hasAnimatedRef = useRef(false);

  useEffect(() => {
    if (immediate) {
      setDisplay(value);
      return;
    }

    const el = ref.current;
    if (!el) return;

    let rafId = 0;

    const startAnimation = () => {
      if (hasAnimatedRef.current) {
        setDisplay(value);
        return;
      }
      hasAnimatedRef.current = true;
      const startTime = performance.now();

      const step = (now: number) => {
        const progress = Math.min(1, (now - startTime) / duration);
        // Smooth ease-out quintic curve
        const eased = 1 - Math.pow(1 - progress, 4);
        setDisplay(value * eased);
        if (progress < 1) {
          rafId = requestAnimationFrame(step);
        } else {
          setDisplay(value);
        }
      };

      setDisplay(0);
      rafId = requestAnimationFrame(step);
    };

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          startAnimation();
          observer.disconnect();
        }
      },
      { threshold: 0.15 },
    );

    observer.observe(el);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(rafId);
    };
  }, [value, duration, immediate]);

  return (
    <span ref={ref} className={cn('tabular-nums', className)}>
      {prefix}
      {formatNumber(display, decimals, padInteger, useGrouping)}
      {suffix}
    </span>
  );
}
