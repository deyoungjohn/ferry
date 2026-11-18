import { useEffect, useState } from 'react';
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
      role={toast.type === 'error' ? 'alert' : 'status'}
      aria-live={toast.type === 'error' ? 'assertive' : 'polite'}
      className="glass glass-pop glass-pop--dark glass-toast glass-toast-in fixed bottom-[max(16px,env(safe-area-inset-bottom))] left-1/2 z-[95] flex w-max max-w-[calc(100vw-32px)] -translate-x-1/2 items-center gap-3 px-4 py-3 text-xs font-medium text-text sm:right-4 sm:left-auto sm:translate-x-0"
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
        className="ml-1 rounded-full p-1 text-text-muted transition-colors hover:bg-[var(--hl)] hover:text-text"
      >
        <XIcon className="size-3.5" />
      </button>
    </div>
  );
}
