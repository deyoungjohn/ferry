import {
  useCallback,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import { capturePointer, releasePointer } from './touch';

export interface SliderOptions {
  min: number;
  max: number;
  step?: number;
  value: number;
  onValueChange: (value: number) => void;
  disabled?: boolean;
  /** Values the thumb snaps to when it comes within `snapRadius` (a share of the range). */
  snapPoints?: readonly number[];
  /** How close to a snap point counts as on it, as a fraction of the range (default 0.03). */
  snapRadius?: number;
  'aria-label'?: string;
  formatValueText?: ((value: number) => string) | undefined;
}

/**
 * A single-thumb slider's behaviour: drag on the track with the pointer (touch included),
 * arrow, Home, End and page keys on the thumb, optional snapping to chosen values. The visual
 * component draws it; this only holds the numbers and the accessibility attributes.
 */
export function useSlider(options: SliderOptions) {
  const {
    min,
    max,
    step = 1,
    value,
    onValueChange,
    disabled = false,
    snapPoints,
    snapRadius = 0.03,
  } = options;
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const range = Math.max(max - min, Number.EPSILON);

  const settle = useCallback(
    (raw: number) => {
      const clamped = Math.min(max, Math.max(min, raw));
      for (const point of snapPoints ?? []) {
        if (Math.abs(clamped - point) <= snapRadius * range) return point;
      }
      const stepped = Math.round((clamped - min) / step) * step + min;
      return Math.min(max, Math.max(min, stepped));
    },
    [max, min, range, snapPoints, snapRadius, step],
  );

  const fromPointer = useCallback(
    (clientX: number) => {
      const rect = trackRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0) return;
      const fraction = Math.min(
        1,
        Math.max(0, (clientX - rect.left) / rect.width),
      );
      onValueChange(settle(min + fraction * range));
    },
    [min, onValueChange, range, settle],
  );

  const trackProps = {
    ref: trackRef,
    onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
      if (disabled) return;
      capturePointer(event.currentTarget, event.pointerId);
      setDragging(true);
      fromPointer(event.clientX);
    },
    onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
      if (dragging) fromPointer(event.clientX);
    },
    onPointerUp: (event: PointerEvent<HTMLDivElement>) => {
      releasePointer(event.currentTarget, event.pointerId);
      setDragging(false);
    },
    onPointerCancel: (event: PointerEvent<HTMLDivElement>) => {
      releasePointer(event.currentTarget, event.pointerId);
      setDragging(false);
    },
  };

  const sliderProps = {
    role: 'slider' as const,
    tabIndex: disabled ? -1 : 0,
    'aria-valuemin': min,
    'aria-valuemax': max,
    'aria-valuenow': value,
    'aria-disabled': disabled || undefined,
    'aria-label': options['aria-label'],
    'aria-valuetext': options.formatValueText?.(value),
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      if (disabled) return;
      const big = Math.max(step, range / 10);
      let next: number | null = null;
      if (event.key === 'ArrowRight' || event.key === 'ArrowUp')
        next = value + step;
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown')
        next = value - step;
      else if (event.key === 'PageUp') next = value + big;
      else if (event.key === 'PageDown') next = value - big;
      else if (event.key === 'Home') next = min;
      else if (event.key === 'End') next = max;
      if (next === null) return;
      event.preventDefault();
      onValueChange(Math.min(max, Math.max(min, next)));
    },
  };

  return {
    percent: ((value - min) / range) * 100,
    current: value,
    dragging,
    trackProps,
    sliderProps,
  };
}
