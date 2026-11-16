import { useEffect, useState } from 'react';
import { useSolver } from '../lib/solver/useSolver';
import { PEG_SOURCES } from '../lib/copy';
import type { PegPrice } from '../lib/solver/types';

function Sparkline({ points }: { points: readonly number[] }) {
  if (points.length < 2) return null;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 0.01;

  const width = 120;
  const height = 36;
  const padding = 4;

  const path = points
    .map((val, idx) => {
      const x = (idx / (points.length - 1)) * (width - padding * 2) + padding;
      const y =
        height - padding - ((val - min) / range) * (height - padding * 2);
      return `${idx === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="overflow-visible"
      aria-hidden="true"
    >
      <path
        d={path}
        fill="none"
        stroke="var(--lime)"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function PegCards() {
  const solver = useSolver();
  const [pegPrices, setPegPrices] = useState<readonly PegPrice[]>([]);

  useEffect(() => {
    let active = true;
    solver.getPegPrices().then((res) => {
      if (active) setPegPrices(res);
    });
    return () => {
      active = false;
    };
  }, [solver]);

  if (pegPrices.length === 0) return null;

  return (
    <section
      aria-label="Peg Health"
      className="mx-auto mt-16 max-w-5xl px-4 sm:px-6"
    >
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-text">{PEG_SOURCES.title}</h2>
        <p className="text-xs text-text-muted">
          {PEG_SOURCES.description}{' '}
          <span className="text-text-dim">({PEG_SOURCES.sourcesLabel})</span>
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {pegPrices.map((peg) => (
          <div
            key={peg.symbol}
            className="flex items-center justify-between rounded-card border border-hairline bg-surface-1 p-5"
          >
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-text">
                  {peg.symbol}
                </span>
                <span
                  className={`text-[11px] font-mono font-medium ${
                    peg.change24hPercent >= 0 ? 'text-ok' : 'text-danger'
                  }`}
                >
                  {peg.change24hPercent >= 0 ? '+' : ''}
                  {peg.change24hPercent.toFixed(2)}%
                </span>
              </div>
              <p className="mt-1 font-mono text-2xl font-bold text-text">
                ${peg.priceUsd.toFixed(4)}
              </p>
              <p className="mt-1 text-[11px] text-text-dim">Target $1.00 USD</p>
            </div>
            <div className="flex flex-col items-end">
              <Sparkline points={peg.sparkline} />
              <span className="mt-2 text-[10px] text-text-dim">
                24h History
              </span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
