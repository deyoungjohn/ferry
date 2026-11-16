import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from 'react';
import { GlassToast, type ToastItem } from '../../components/GlassToast';

export interface ToastContextValue {
  readonly toast: ToastItem | null;
  readonly showToast: (
    message: string,
    type?: 'info' | 'success' | 'error',
    durationMs?: number,
  ) => void;
  readonly dismissToast: () => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { readonly children: ReactNode }) {
  const [toast, setToast] = useState<ToastItem | null>(null);

  const showToast = useCallback(
    (
      message: string,
      type: 'info' | 'success' | 'error' = 'success',
      durationMs = 3000,
    ) => {
      setToast({
        id: String(Date.now()),
        message,
        type,
        durationMs,
      });
    },
    [],
  );

  const dismissToast = useCallback(() => {
    setToast(null);
  }, []);

  return (
    <ToastContext.Provider value={{ toast, showToast, dismissToast }}>
      {children}
      <GlassToast toast={toast} onDismiss={dismissToast} />
    </ToastContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    return {
      toast: null,
      showToast: () => {},
      dismissToast: () => {},
    };
  }
  return ctx;
}
