import { useState } from 'react';
import { CopyIcon, CheckIcon } from './icons';
import { type DiagnosticsData, sanitizeDiagnostics } from '../lib/diagnostics';

export type { DiagnosticsData };

export function CopyDiagnosticsButton({
  data,
  className = '',
  label = 'Copy Diagnostics',
}: {
  data: DiagnosticsData;
  className?: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      const text = sanitizeDiagnostics(data);
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(text);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
    }
  }

  return (
    <button
      type="button"
      data-testid="copy-diagnostics-button"
      onClick={handleCopy}
      className={`inline-flex items-center gap-1.5 rounded-pill border border-hairline bg-surface-2 px-3 py-1.5 text-xs font-medium text-text-muted transition-colors hover:border-surface-4 hover:bg-surface-3 hover:text-text cursor-pointer ${className}`}
      title="Copy redacted diagnostic information for troubleshooting"
    >
      {copied ? (
        <>
          <CheckIcon className="size-3.5 text-ok" />
          <span className="text-ok">Copied!</span>
        </>
      ) : (
        <>
          <CopyIcon className="size-3.5" />
          <span>{label}</span>
        </>
      )}
    </button>
  );
}
