import { useEffect, useState } from 'react';
import { useSolver } from '../lib/solver/useSolver';
import { PEG_SOURCES, formatPegSources } from '../lib/copy';
import type { PegPrice } from '../lib/solver/types';
import { CountUp } from './marketing/MotionPrimitives';

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
    const load = () => {
      solver.getPegPrices().then((res) => {
        if (active) setPegPrices(res);
      });
    };
    load();
    // Live: the prices refresh while the page is open.
    const timer = setInterval(load, 30_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [solver]);

  if (pegPrices.length === 0) return null;

  const sourcesLabel = formatPegSources(pegPrices);

  return (
    <section
      aria-label="Peg Health"
      className="mx-auto mt-16 max-w-5xl px-4 sm:px-6"
    >
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-text">{PEG_SOURCES.title}</h2>
        <p className="text-xs text-text-muted">
          {PEG_SOURCES.description}{' '}
          <span data-testid="peg-sources-label" className="text-text-dim">
            ({sourcesLabel})
          </span>
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
                  <CountUp
                    value={peg.change24hPercent}
                    decimals={2}
                    prefix={peg.change24hPercent >= 0 ? '+' : ''}
                    suffix="%"
                  />
                </span>
              </div>
              <p className="mt-1 font-mono text-2xl font-semibold text-text">
                <CountUp value={peg.priceUsd} decimals={2} prefix="$" />
              </p>
              <div className="mt-1 flex items-center gap-2 text-[11px] text-text-dim">
                <span>Target $1.00 USD</span>
                {peg.source && (
                  <>
                    <span>·</span>
                    <span
                      data-testid="peg-source-tag"
                      className="font-mono text-xs text-text-muted"
                    >
                      {peg.source}
                    </span>
                  </>
                )}
              </div>
            </div>
            <div className="flex flex-col items-end">
              <Sparkline points={peg.sparkline} />
              <span className="mt-2 text-xs text-text-dim">24h History</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
