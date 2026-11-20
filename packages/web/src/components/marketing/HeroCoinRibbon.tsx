import { useEffect, useRef, useState } from 'react';
import { cn } from '../../lib/cn';
import { createCoinRibbonScene } from './three/coin-ribbon/scene';

/**
 * Full-bleed Three.js / WebGL hero animation of Ferry's five stablecoins
 * (USDT, USDC, USDG, MUSD, PUSD) rolling along a brushed-chrome S-ribbon
 * over a luminous Ferry lime studio gradient backdrop.
 */
export function HeroCoinRibbon({ className }: { className?: string }) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [webglFailed, setWebglFailed] = useState(false);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    let controller: { dispose: () => void } | null = null;
    try {
      controller = createCoinRibbonScene(el);
    } catch {
      setWebglFailed(true);
    }
    return () => {
      controller?.dispose();
    };
  }, []);

  return (
    <div
      className={cn('relative size-full overflow-hidden', className)}
      style={{
        background: [
          'radial-gradient(ellipse 74% 64% at 88% 8%, rgba(198, 242, 25, 0.78) 0%, rgba(154, 224, 58, 0.34) 46%, transparent 78%)',
          'radial-gradient(ellipse 68% 54% at 82% 96%, rgba(164, 212, 72, 0.68) 0%, rgba(206, 234, 134, 0.34) 52%, transparent 80%)',
          'radial-gradient(ellipse 66% 72% at 14% 48%, rgba(252, 254, 246, 0.96) 0%, rgba(244, 249, 232, 0.62) 60%, transparent 100%)',
          'linear-gradient(155deg, #dff87c 0%, #f8fbf0 46%, #edf6d4 78%, #cbe682 100%)',
        ].join(', '),
      }}
    >
      {webglFailed ? (
        <div
          className="flex size-full items-center justify-center p-8 text-center"
          role="img"
          aria-label="Ferry stablecoin bridge connecting USDT, USDC, USDG, MUSD, and PUSD"
        >
          <span className="rounded-pill bg-lime-ink/10 px-4 py-2 text-xs font-semibold tracking-wide text-lime-ink">
            USDT · USDC · USDG · MUSD · PUSD
          </span>
        </div>
      ) : (
        <div
          ref={stageRef}
          role="img"
          aria-label="3D animation of USDT, USDC, USDG, MUSD, and PUSD coins rolling along a chrome wave ribbon"
          className="size-full"
        />
      )}
    </div>
  );
}
