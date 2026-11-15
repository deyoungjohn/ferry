import { useEffect, useState } from 'react';
import { useGlassLens } from '../lib/glass';
import { useGlassLayer } from '../lib/glass-layer';
import { CheckIcon, InfoIcon, XIcon } from './icons';

export interface ToastItem {
  readonly id: string;
  readonly message: string;
  readonly type?: 'info' | 'success' | 'error';
  readonly durationMs?: number;
}

export interface GlassToastProps {
  readonly toast: ToastItem | null;
  readonly onDismiss: () => void;
}

export function GlassToast({ toast, onDismiss }: GlassToastProps) {
  const lensed = useGlassLens();
  const [visible, setVisible] = useState(Boolean(toast));

  useGlassLayer(visible, 'toast');

  useEffect(() => {
    if (!toast) {
      setVisible(false);
      return;
    }
    setVisible(true);
    const timer = setTimeout(() => {
      setVisible(false);
      onDismiss();
    }, toast.durationMs ?? 4000);

    return () => clearTimeout(timer);
  }, [toast, onDismiss]);

  if (!toast || !visible) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={`glass glass-toast glass-toast-in fixed right-4 bottom-4 z-50 flex items-center gap-3 p-4 text-xs font-medium text-text shadow-xl ${
        lensed ? 'glass--lensed' : ''
      }`}
    >
      {toast.type === 'success' ? (
        <CheckIcon className="size-4 text-ok" />
      ) : toast.type === 'error' ? (
        <XIcon className="size-4 text-danger" />
      ) : (
        <InfoIcon className="size-4 text-lime" />
      )}
      <span>{toast.message}</span>
      <button
        type="button"
        onClick={() => {
          setVisible(false);
          onDismiss();
        }}
        aria-label="Dismiss notification"
        className="ml-2 text-text-muted transition-colors hover:text-text"
      >
        <XIcon className="size-3.5" />
      </button>
    </div>
  );
}
