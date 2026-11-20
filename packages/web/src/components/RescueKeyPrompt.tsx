import { useState, useEffect } from 'react';
import {
  getOrCreateRescueRoot,
  isRescueKeySaved,
  markRescueKeySaved,
} from '../lib/recovery/recovery-key-service';

export function RescueKeyPrompt() {
  const [open, setOpen] = useState(false);
  const [rescueKey, setRescueKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    void isRescueKeySaved().then((saved) => {
      if (!saved && active) {
        void getOrCreateRescueRoot().then((root) => {
          if (active) {
            setRescueKey(root);
            setOpen(true);
          }
        });
      }
    });
    return () => {
      active = false;
    };
  }, []);

  if (!open || !rescueKey) return null;

  async function handleCopy() {
    if (!rescueKey) return;
    try {
      await navigator.clipboard.writeText(rescueKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Ignore clipboard error
    }
  }

  function handleDownload() {
    if (!rescueKey) return;
    const blob = new Blob(
      [
        `Ferry Rescue Key\n================\n${rescueKey}\n\nKeep this key safe. You can use it on any device to find and recover all reverse swaps started without an EVM wallet in this browser.\n`,
      ],
      { type: 'text/plain' },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ferry-rescue-key.txt';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function handleDismiss() {
    await markRescueKeySaved();
    setOpen(false);
  }

  return (
    <div
      data-testid="rescue-key-prompt"
      className="mb-4 rounded-xl border border-hairline bg-surface-2 p-4 text-sm"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-text">Save your rescue key</h2>
          <p className="mt-1 text-xs text-text-dim">
            You are swapping without a connected EVM wallet. Save this rescue
            key once so you can recover your swaps from any device without
            files.
          </p>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2 rounded-lg border border-hairline bg-surface-1 px-3 py-2">
        <code
          data-testid="rescue-key-display"
          className="flex-1 truncate font-mono text-xs text-text-muted"
        >
          {rescueKey}
        </code>
        <button
          type="button"
          onClick={handleCopy}
          data-testid="copy-rescue-key"
          className="rounded-pill border border-hairline px-2.5 py-1 text-xs font-medium hover:bg-surface-3 text-text"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
        <button
          type="button"
          onClick={handleDownload}
          data-testid="download-rescue-key"
          className="rounded-pill border border-hairline px-2.5 py-1 text-xs font-medium hover:bg-surface-3 text-text"
        >
          Download
        </button>
      </div>

      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={handleDismiss}
          data-testid="dismiss-rescue-key"
          className="rounded-pill bg-olive px-4 py-1.5 text-xs font-semibold text-text"
        >
          I have saved my rescue key
        </button>
      </div>
    </div>
  );
}
