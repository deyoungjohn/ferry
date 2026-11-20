import { useEffect, useRef, useState } from 'react';

/**
 * The hero clip: coins rolling along a ribbon, looped without sound. A person who asked for less
 * motion sees the still frame instead.
 */
export function HeroVideo({ className }: { className?: string }) {
  const base = import.meta.env.BASE_URL;
  const ref = useRef<HTMLVideoElement>(null);
  const [still, setStill] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false,
  );

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setStill(query.matches);
    query.addEventListener?.('change', onChange);
    return () => query.removeEventListener?.('change', onChange);
  }, []);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    if (still) video.pause();
    else {
      // Older browsers (and test DOMs) return nothing from play(); newer ones a promise that can
      // reject when autoplay is blocked. Neither may break the page.
      const started = video.play?.() as Promise<void> | undefined;
      if (started && typeof started.catch === 'function') {
        started.catch(() => undefined);
      }
    }
  }, [still]);

  return (
    <video
      ref={ref}
      className={className}
      poster={`${base}media/hero-coins.jpg`}
      autoPlay={!still}
      muted
      loop
      playsInline
      preload="metadata"
      aria-hidden="true"
      data-testid="hero-video"
    >
      <source src={`${base}media/hero-coins.webm`} type="video/webm" />
      <source src={`${base}media/hero-coins.mp4`} type="video/mp4" />
    </video>
  );
}
