import { useState, type ChangeEvent, type FormEvent } from 'react';
import { GlassModal } from '../GlassModal';
import {
  exportNotebook,
  getNotebookFilename,
  importNotebook,
} from '../../lib/notebook/crypto';
import { mergeSendLinks } from '../../lib/notebook/merge';
import { downloadJson } from '../../lib/send/download';
import {
  getViewKey,
  listSendLinks,
  replaceSendLinks,
  saveViewKey,
} from '../../lib/paylink/send-store';
import type { SendLinkData } from '../../lib/paylink/link';

export interface ExportNotebookModalProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly links: SendLinkData[];
  readonly onExportSuccess?: (filename: string) => void;
}

export function ExportNotebookModal({
  open,
  onOpenChange,
  links,
  onExportSuccess,
}: ExportNotebookModalProps) {
  const [passphrase, setPassphrase] = useState('');
  const [confirmPassphrase, setConfirmPassphrase] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  function handleClose(nextOpen: boolean) {
    if (!nextOpen) {
      setPassphrase('');
      setConfirmPassphrase('');
      setError(null);
      setIsExporting(false);
    }
    onOpenChange(nextOpen);
  }

  async function handleExport(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!passphrase) {
      setError('Passphrase cannot be empty.');
      return;
    }

    if (passphrase !== confirmPassphrase) {
      setError('Passphrases do not match.');
      return;
    }

    setIsExporting(true);
    try {
      const currentViewKey = getViewKey() ?? undefined;
      const file = await exportNotebook({
        links,
        passphrase,
        viewKey: currentViewKey,
      });

      if (!currentViewKey) {
        saveViewKey(file.data); // will be initialized on first export
      }

      const filename = getNotebookFilename();
      const jsonContent = JSON.stringify(file, null, 2);
      downloadJson(filename, jsonContent);

      setPassphrase('');
      setConfirmPassphrase('');
      setError(null);
      onOpenChange(false);
      onExportSuccess?.(filename);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <GlassModal
      open={open}
      onOpenChange={handleClose}
      title="Export Encrypted Notebook"
      description="Keep your send links and claim secrets safe across devices."
    >
      <form onSubmit={handleExport} className="space-y-4 text-xs">
        {/* Warning banner */}
        <div
          data-testid="export-warning-notice"
          className="rounded-well border border-hairline bg-surface-2 p-3 text-[11px] leading-relaxed text-text-muted"
        >
          <strong className="text-text font-semibold block mb-0.5">
            Important Security Notice
          </strong>
          A lost passphrase cannot be recovered and the file holds the claim
          secrets.
        </div>

        <div>
          <label
            htmlFor="export-notebook-passphrase"
            className="block text-text-muted mb-1 font-medium"
          >
            Passphrase
          </label>
          <input
            id="export-notebook-passphrase"
            type="password"
            autoComplete="new-password"
            spellCheck={false}
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            placeholder="Choose a strong passphrase"
            disabled={isExporting}
            className="w-full rounded-well border border-hairline bg-surface-2 p-2.5 text-xs text-text placeholder:text-text-dim focus:border-lime focus:outline-none"
          />
        </div>

        <div>
          <label
            htmlFor="export-notebook-confirm"
            className="block text-text-muted mb-1 font-medium"
          >
            Confirm Passphrase
          </label>
          <input
            id="export-notebook-confirm"
            type="password"
            autoComplete="new-password"
            spellCheck={false}
            value={confirmPassphrase}
            onChange={(e) => setConfirmPassphrase(e.target.value)}
            placeholder="Re-enter passphrase"
            disabled={isExporting}
            className="w-full rounded-well border border-hairline bg-surface-2 p-2.5 text-xs text-text placeholder:text-text-dim focus:border-lime focus:outline-none"
          />
        </div>

        {error && (
          <p className="text-danger text-xs" role="alert">
            {error}
          </p>
        )}

        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={() => handleClose(false)}
            disabled={isExporting}
            className="rounded-pill border border-hairline bg-surface-2 px-3 py-1.5 text-xs font-semibold text-text hover:bg-surface-3 transition-colors cursor-pointer disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isExporting}
            className="rounded-pill bg-olive px-4 py-1.5 text-xs font-semibold text-text hover:bg-olive/90 transition-colors cursor-pointer disabled:opacity-50"
          >
            {isExporting ? 'Encrypting & Exporting…' : 'Export & Download'}
          </button>
        </div>
      </form>
    </GlassModal>
  );
}

export interface ImportNotebookModalProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onImportSuccess: (result: {
    readonly importedCount: number;
    readonly totalCount: number;
  }) => void;
}

export function ImportNotebookModal({
  open,
  onOpenChange,
  onImportSuccess,
}: ImportNotebookModalProps) {
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [passphrase, setPassphrase] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);

  function handleClose(nextOpen: boolean) {
    if (!nextOpen) {
      setFileContent(null);
      setFileName(null);
      setPassphrase('');
      setError(null);
      setIsImporting(false);
    }
    onOpenChange(nextOpen);
  }

  async function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    setError(null);
    const file = e.target.files?.[0];
    if (!file) {
      setFileContent(null);
      setFileName(null);
      return;
    }

    setFileName(file.name);
    try {
      const text = await file.text();
      setFileContent(text);
    } catch {
      setError('Failed to read the selected file.');
    }
  }

  async function handleImport(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!fileContent) {
      setError('Please select a notebook file to import.');
      return;
    }

    if (!passphrase) {
      setError('Passphrase cannot be empty.');
      return;
    }

    setIsImporting(true);
    try {
      const plaintext = await importNotebook({
        json: fileContent,
        passphrase,
      });

      const existing = listSendLinks();
      const merged = mergeSendLinks(existing, plaintext.links);
      replaceSendLinks(merged);

      if (plaintext.viewKey) {
        const currentVk = getViewKey();
        if (!currentVk) {
          saveViewKey(plaintext.viewKey);
        }
      }

      setFileContent(null);
      setFileName(null);
      setPassphrase('');
      setError(null);
      onOpenChange(false);
      onImportSuccess({
        importedCount: plaintext.links.length,
        totalCount: merged.length,
      });
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Incorrect passphrase or damaged notebook file.',
      );
    } finally {
      setIsImporting(false);
    }
  }

  return (
    <GlassModal
      open={open}
      onOpenChange={handleClose}
      title="Import Encrypted Notebook"
      description="Restore your send links and claim secrets from an encrypted backup."
    >
      <form onSubmit={handleImport} className="space-y-4 text-xs">
        <div>
          <label
            htmlFor="import-notebook-file"
            className="block text-text-muted mb-1 font-medium"
          >
            Notebook File (.json)
          </label>
          <input
            id="import-notebook-file"
            type="file"
            accept=".json,application/json"
            aria-label="Notebook JSON file"
            onChange={handleFileChange}
            disabled={isImporting}
            className="w-full text-xs text-text file:mr-2 file:rounded-pill file:border file:border-hairline file:bg-surface-2 file:px-3 file:py-1 file:text-xs file:font-semibold file:text-text hover:file:bg-surface-3 cursor-pointer"
          />
          {fileName && (
            <p className="mt-1 text-[11px] text-text-dim truncate">
              Selected: {fileName}
            </p>
          )}
        </div>

        <div>
          <label
            htmlFor="import-notebook-passphrase"
            className="block text-text-muted mb-1 font-medium"
          >
            Passphrase
          </label>
          <input
            id="import-notebook-passphrase"
            type="password"
            autoComplete="current-password"
            spellCheck={false}
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            placeholder="Enter notebook passphrase"
            disabled={isImporting}
            className="w-full rounded-well border border-hairline bg-surface-2 p-2.5 text-xs text-text placeholder:text-text-dim focus:border-lime focus:outline-none"
          />
        </div>

        {error && (
          <p className="text-danger text-xs" role="alert">
            {error}
          </p>
        )}

        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={() => handleClose(false)}
            disabled={isImporting}
            className="rounded-pill border border-hairline bg-surface-2 px-3 py-1.5 text-xs font-semibold text-text hover:bg-surface-3 transition-colors cursor-pointer disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isImporting || !fileContent}
            className="rounded-pill bg-olive px-4 py-1.5 text-xs font-semibold text-text hover:bg-olive/90 transition-colors cursor-pointer disabled:opacity-50"
          >
            {isImporting ? 'Decrypting & Importing…' : 'Import Notebook'}
          </button>
        </div>
      </form>
    </GlassModal>
  );
}
