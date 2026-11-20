import { useState, useCallback, useRef, useEffect } from 'react';
import { AlphanumericQRCode } from '@wizardconnect/react';
import { GlassModal } from './GlassModal';
import { AlertTriangleIcon, CheckIcon, CopyIcon, WalletIcon } from './icons';

export interface BchPairingDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly uri: string | null;
  readonly qrUri: string | null;
  readonly state: string;
  readonly pairingFailed: boolean;
  readonly failureReason?: string | null;
  readonly onShowQrAgain: () => void;
  readonly onReconnect: () => void;
}

export function BchPairingDialog({
  open,
  onClose,
  uri,
  qrUri,
  state,
  pairingFailed,
  failureReason,
  onShowQrAgain,
  onReconnect,
}: BchPairingDialogProps) {
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  const handleCopy = useCallback(() => {
    if (!uri) return;
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(uri).catch(() => undefined);
    }
    setCopied(true);
    if (copyTimerRef.current !== null) {
      window.clearTimeout(copyTimerRef.current);
    }
    copyTimerRef.current = window.setTimeout(() => setCopied(false), 2000);
  }, [uri]);

  const plainFailureSentence =
    failureReason ||
    'The pairing connection was dropped. The wallet or relay disconnected.';

  return (
    <GlassModal
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title="Connect a BCH wallet"
      {...(!pairingFailed
        ? {
            description:
              'Scan with Selene, Paytaca or another WizardConnect wallet',
          }
        : {})}
    >
      <div className="space-y-4 pt-1">
        {pairingFailed ? (
          <div className="space-y-4">
            <div
              role="alert"
              className="rounded-xl border border-warn/30 bg-warn/10 p-3.5 text-xs text-warn flex items-start gap-2.5"
            >
              <AlertTriangleIcon className="size-4 shrink-0 mt-0.5 text-warn" />
              <div className="space-y-1">
                <p className="font-medium text-text">Pairing interrupted</p>
                <p className="text-text-muted leading-relaxed">
                  {plainFailureSentence}
                </p>
              </div>
            </div>

            <div className="space-y-2 pt-1">
              <button
                type="button"
                onClick={onShowQrAgain}
                className="flex w-full items-center justify-center gap-2 rounded-pill bg-lime py-2.5 text-xs font-semibold text-surface-0 hover:brightness-110 transition-all cursor-pointer shadow-sm"
              >
                <WalletIcon className="size-4 text-surface-0" />
                <span>Show the QR again</span>
              </button>

              <button
                type="button"
                onClick={onReconnect}
                className="flex w-full items-center justify-center gap-2 rounded-pill bg-surface-3 border border-hairline py-2.5 text-xs font-semibold text-text hover:bg-surface-4 transition-colors cursor-pointer"
              >
                <span>Reconnect wallet</span>
              </button>
            </div>
          </div>
        ) : qrUri ? (
          <div className="flex flex-col items-center gap-3.5">
            <div className="rounded-2xl bg-white p-3 shadow-lg border border-hairline/20">
              <AlphanumericQRCode
                value={qrUri}
                size={240}
                foreground="#1e2a4a"
                background="#ffffff"
              />
            </div>

            {state === 'reconnecting' && (
              <p className="text-center text-[11px] text-text-muted animate-pulse">
                Reconnecting to relay…
              </p>
            )}

            {uri && (
              <button
                type="button"
                onClick={handleCopy}
                className="flex items-center gap-1.5 text-xs text-text-muted hover:text-text transition-colors cursor-pointer py-1 px-3 rounded-pill bg-surface-2 hover:bg-surface-3 border border-hairline"
              >
                {copied ? (
                  <>
                    <CheckIcon className="size-3.5 text-ok" />
                    <span className="text-ok font-medium">Copied link!</span>
                  </>
                ) : (
                  <>
                    <CopyIcon className="size-3.5" />
                    <span>Copy pairing link</span>
                  </>
                )}
              </button>
            )}
          </div>
        ) : (
          <div className="py-8 flex flex-col items-center justify-center gap-2 text-text-muted text-xs">
            <span className="animate-spin text-lime">●</span>
            <span>Preparing pairing session…</span>
          </div>
        )}

        <button
          type="button"
          onClick={onClose}
          className="w-full rounded-pill bg-surface-2 py-2 text-xs font-medium text-text-muted hover:text-text transition-colors cursor-pointer"
        >
          Cancel
        </button>
      </div>
    </GlassModal>
  );
}
