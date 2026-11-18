import { useMemo } from 'react';
import {
  CLAIM_WINDOW_PRESETS,
  claimWindow,
  dayOptions,
  describeExpiry,
  type ClaimWindowChoice,
  type CustomExpiry,
} from '../../lib/paylink/claim-window';
import { Select } from './select';
import { WheelPicker } from './wheel-picker';

const HOURS = Array.from({ length: 24 }, (_, hour) =>
  String(hour).padStart(2, '0'),
);
const MINUTES = Array.from({ length: 12 }, (_, step) =>
  String(step * 5).padStart(2, '0'),
);

export interface ClaimWindowFieldProps {
  readonly choice: ClaimWindowChoice;
  readonly custom: CustomExpiry;
  readonly onChoiceChange: (choice: ClaimWindowChoice) => void;
  readonly onCustomChange: (custom: CustomExpiry) => void;
  /** The current time, in milliseconds. Passed in so the field is predictable in tests. */
  readonly nowMs: number;
}

/**
 * How long the receiver has to claim: 24 hours, 3 days, 7 days, or a date and time of your own.
 * The custom end is picked on three wheels (day, hour, minute) and must fall between one hour and
 * seven days from now.
 */
export function ClaimWindowField({
  choice,
  custom,
  onChoiceChange,
  onCustomChange,
  nowMs,
}: ClaimWindowFieldProps) {
  const days = useMemo(() => dayOptions(nowMs), [nowMs]);
  const result = claimWindow(choice, custom, nowMs);

  return (
    <div className="space-y-2" data-testid="claim-window-field">
      <Select
        label="Claim Window"
        value={choice}
        onValueChange={(value) => onChoiceChange(value as ClaimWindowChoice)}
        options={[
          ...CLAIM_WINDOW_PRESETS.map((preset) => ({
            value: preset.value,
            label: preset.label,
          })),
          { value: 'custom', label: 'Custom date and time' },
        ]}
      />

      {choice === 'custom' && (
        <div
          data-testid="claim-window-custom"
          className="rounded-well border border-hairline bg-surface-2 p-3"
        >
          <p className="mb-2 text-[11px] text-text-dim">
            Ends on (your local time)
          </p>
          <div className="grid grid-cols-[1.6fr_1fr_1fr] gap-2">
            <WheelPicker
              aria-label="Day"
              options={days}
              value={String(custom.dayOffset)}
              onValueChange={(value) =>
                onCustomChange({ ...custom, dayOffset: Number(value) })
              }
            />
            <WheelPicker
              aria-label="Hour"
              options={HOURS}
              value={String(custom.hour).padStart(2, '0')}
              onValueChange={(value) =>
                onCustomChange({ ...custom, hour: Number(value) })
              }
            />
            <WheelPicker
              aria-label="Minute"
              options={MINUTES}
              value={String(custom.minute).padStart(2, '0')}
              onValueChange={(value) =>
                onCustomChange({ ...custom, minute: Number(value) })
              }
            />
          </div>
        </div>
      )}

      {result.ok ? (
        <p
          data-testid="claim-window-summary"
          className="text-[11px] text-text-muted"
        >
          Unclaimed funds return to you after{' '}
          {describeExpiry(result.expiresAtMs, nowMs)}.
        </p>
      ) : (
        <p
          role="alert"
          data-testid="claim-window-error"
          className="text-[11px] text-danger"
        >
          {result.message}
        </p>
      )}
    </div>
  );
}
