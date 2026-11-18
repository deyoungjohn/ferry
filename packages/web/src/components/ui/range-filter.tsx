import { useState } from 'react';
import { cn } from '../../lib/cn';
import {
  DateRangePicker,
  DateRangePickerCalendar,
  DateRangePickerContent,
  DateRangePickerTrigger,
  type DateRangePickerProps,
} from './date-range-picker';

export type RangePreset = '24h' | '7d' | '30d' | '90d';

/** A time window: a recent period, or two exact moments (Unix seconds). */
export type RangeValue =
  | { readonly kind: RangePreset }
  | { readonly kind: 'custom'; readonly from: number; readonly to: number };

export const DEFAULT_RANGE: RangeValue = { kind: '90d' };

const PRESETS: ReadonlyArray<{
  id: RangePreset;
  label: string;
  seconds: number;
}> = [
  { id: '24h', label: '24h', seconds: 24 * 3600 },
  { id: '7d', label: '7d', seconds: 7 * 24 * 3600 },
  { id: '30d', label: '30d', seconds: 30 * 24 * 3600 },
  { id: '90d', label: '90d', seconds: 90 * 24 * 3600 },
];

/** The window as two Unix-second bounds, counted back from `nowSeconds` for a preset. */
export function rangeBounds(
  value: RangeValue,
  nowSeconds: number,
): { from: number; to: number } {
  if (value.kind === 'custom') return { from: value.from, to: value.to };
  const preset = PRESETS.find((item) => item.id === value.kind)!;
  return { from: nowSeconds - preset.seconds, to: nowSeconds };
}

export function filterByRange<T>(
  items: readonly T[],
  seconds: (item: T) => number,
  value: RangeValue,
  nowSeconds: number,
): T[] {
  const { from, to } = rangeBounds(value, nowSeconds);
  return items.filter((item) => {
    const at = seconds(item);
    return at >= from && at <= to;
  });
}

/** Local date (YYYY-MM-DD) and time (HH:MM) to Unix seconds, in the viewer's own time zone. */
export function localToSeconds(date: string, time: string): number {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  return Math.floor(
    new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1, hh ?? 0, mm ?? 0, 0).getTime() /
      1000,
  );
}

const CHIP =
  'rounded-pill px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

const TIME_INPUT =
  'w-full rounded-lg border border-hairline bg-surface-2 px-2 py-1.5 font-mono text-xs text-text outline-none focus:border-lime/60';

function formatMoment(seconds: number): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(seconds * 1000));
}

export interface RangeFilterProps {
  readonly value: RangeValue;
  readonly onChange: (value: RangeValue) => void;
  readonly label?: string;
  readonly className?: string;
  /** For tests: the dates that may be picked. */
  readonly pickerProps?: Partial<DateRangePickerProps>;
}

/**
 * 24h, 7d, 30d, 90d, or a custom window picked by date and time. Used above
 * every table that lists swaps.
 */
export function RangeFilter({
  value,
  onChange,
  label = 'Time range',
  className,
  pickerProps,
}: RangeFilterProps) {
  const [dates, setDates] = useState<{ from: string; to?: string } | null>(
    null,
  );
  const [startTime, setStartTime] = useState('00:00');
  const [endTime, setEndTime] = useState('23:59');
  const [open, setOpen] = useState(false);
  const complete = dates !== null && dates.to !== undefined;

  function apply() {
    if (!dates || !dates.to) return;
    const from = localToSeconds(dates.from, startTime);
    const to = localToSeconds(dates.to, endTime);
    onChange({
      kind: 'custom',
      from: Math.min(from, to),
      to: Math.max(from, to),
    });
    setOpen(false);
  }

  return (
    <div
      className={cn('flex flex-wrap items-center gap-1.5', className)}
      data-testid="range-filter"
    >
      <div
        role="radiogroup"
        aria-label={label}
        className="inline-flex rounded-pill border border-hairline bg-surface-2 p-0.5"
      >
        {PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            role="radio"
            aria-checked={value.kind === preset.id}
            onClick={() => onChange({ kind: preset.id })}
            className={cn(
              CHIP,
              value.kind === preset.id
                ? 'bg-lime text-lime-ink'
                : 'text-text-muted hover:text-text',
            )}
          >
            {preset.label}
          </button>
        ))}
      </div>

      <DateRangePicker
        {...pickerProps}
        open={open}
        onOpenChange={setOpen}
        value={dates}
        onValueChange={setDates}
        showSummary={false}
        label="Custom date range"
      >
        <DateRangePickerTrigger
          placeholder="Custom"
          className={cn(
            CHIP,
            'border border-hairline',
            value.kind === 'custom'
              ? 'bg-lime/10 text-lime'
              : 'bg-surface-2 text-text-muted hover:text-text',
          )}
        />
        <DateRangePickerContent>
          <DateRangePickerCalendar className="w-full rounded-none border-0" />
          <div className="grid grid-cols-2 gap-2 border-t border-hairline p-3">
            <label className="text-[11px] text-text-muted">
              From time
              <input
                type="time"
                value={startTime}
                onChange={(event) => setStartTime(event.target.value)}
                className={TIME_INPUT}
                aria-label="Start time"
              />
            </label>
            <label className="text-[11px] text-text-muted">
              To time
              <input
                type="time"
                value={endTime}
                onChange={(event) => setEndTime(event.target.value)}
                className={TIME_INPUT}
                aria-label="End time"
              />
            </label>
            <button
              type="button"
              disabled={!complete}
              onClick={apply}
              className="col-span-2 rounded-pill bg-lime px-3 py-1.5 text-xs font-semibold text-lime-ink disabled:opacity-40"
            >
              Apply
            </button>
          </div>
        </DateRangePickerContent>
      </DateRangePicker>

      {value.kind === 'custom' && (
        <span
          data-testid="range-filter-custom-summary"
          className="text-[11px] text-text-muted"
        >
          {formatMoment(value.from)} to {formatMoment(value.to)}
        </span>
      )}
    </div>
  );
}
