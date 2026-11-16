import { useEffect, useState } from 'react';
import { AlertTriangleIcon } from './icons';

export function OfflineBanner() {
  const [isOnline, setIsOnline] = useState<boolean>(() => {
    return typeof navigator !== 'undefined' ? navigator.onLine : true;
  });

  useEffect(() => {
    function handleOnline() {
      setIsOnline(true);
    }
    function handleOffline() {
      setIsOnline(false);
    }

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  if (isOnline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="offline-banner"
      className="sticky top-0 z-50 flex items-center justify-center gap-2 border-b border-warn/30 bg-warn/15 px-4 py-2 text-xs font-semibold text-warn backdrop-blur-md"
    >
      <AlertTriangleIcon className="size-4 shrink-0 text-warn" />
      <span>
        You are offline. Live quotes and network updates are paused until your
        connection is restored.
      </span>
    </div>
  );
}
