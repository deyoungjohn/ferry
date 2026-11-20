import { useEffect, useRef, useState } from 'react';
import { cn } from '../../lib/cn';
import { ChainTiles } from './visuals';
import { createRotatingCoinsScene } from './three/rotating-coins/scene';

const TILE_GRID_BG = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='44' height='44' viewBox='0 0 44 44'%3E%3Crect x='2.5' y='2.5' width='39' height='39' rx='7' fill='none' stroke='rgba(198,242,25,0.065)' stroke-width='1'/%3E%3C/svg%3E")`;

/**
 * Interactive 3D orbital carousel of Ferry's six supported EVM chains, rendered
 * with Three.js / WebGL and framed inside the bento card. Gracefully falls back
 * to static ChainTiles when WebGL is unavailable.
 */
export function RotatingChainCoins({ className }: { className?: string }) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    let controller: { dispose: () => void } | null = null;
    try {
      controller = createRotatingCoinsScene(el);
    } catch {
      setFailed(true);
    }
    return () => {
      controller?.dispose();
    };
  }, []);

  if (failed) {
    return <ChainTiles />;
  }

  return (
    <div
      className={cn(
        'relative h-[220px] w-full overflow-hidden rounded-well border border-hairline/70 sm:h-[245px]',
        className,
      )}
      style={{
        background: [
          'radial-gradient(ellipse 62% 62% at 8% 8%, rgba(214, 178, 96, 0.24) 0%, transparent 72%)',
          'radial-gradient(ellipse 66% 64% at 92% 10%, rgba(126, 217, 87, 0.32) 0%, rgba(198, 242, 25, 0.14) 36%, transparent 76%)',
          'radial-gradient(ellipse 72% 55% at 50% 98%, rgba(29, 36, 16, 0.55) 0%, transparent 72%)',
          'linear-gradient(180deg, #0b0d09 0%, #090a09 100%)',
        ].join(', '),
      }}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-75"
        style={{
          backgroundImage: TILE_GRID_BG,
          backgroundSize: '44px 44px',
          maskImage:
            'radial-gradient(ellipse 92% 84% at 50% 58%, #000 24%, transparent 88%)',
          WebkitMaskImage:
            'radial-gradient(ellipse 92% 84% at 50% 58%, #000 24%, transparent 88%)',
        }}
      />
      <div
        ref={stageRef}
        role="img"
        aria-label="Six rotating gold-rimmed coins for Ethereum, Base, Arbitrum, BNB Chain, Arc, and Robinhood Chain"
        className="relative size-full"
      />
    </div>
  );
}
