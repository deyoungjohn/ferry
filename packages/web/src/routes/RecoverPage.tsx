import { useState, type ChangeEvent, type FormEvent } from 'react';
import { Link } from 'react-router';
import { defaultRecoveryPort } from '../lib/recovery/stub';
import type { RecoveryFile, RecoverySnapshot } from '../lib/recovery/types';

export function RecoverPage() {
  const [fileContent, setFileContent] = useState('');
  const [recoveryFile, setRecoveryFile] = useState<RecoveryFile | null>(null);
  const [snapshot, setSnapshot] = useState<RecoverySnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showSecret, setShowSecret] = useState(false);
  const [actionResult, setActionResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function processJson(rawJson: string) {
    setError(null);
    setNotice(null);
    setActionResult(null);
    try {
      const file = defaultRecoveryPort.validateFile(rawJson);
      setRecoveryFile(file);
      const snap = await defaultRecoveryPort.loadSnapshot(file);
      setSnapshot(snap);

      if (file.solverKind === 'mock') {
        setNotice(
          'Recovery file loaded. This file was issued by the mock solver and cannot be claimed on chain.',
        );
      } else {
        setNotice(
          'Recovery file loaded successfully. Contract parameters verified.',
        );
      }
    } catch (err) {
      setRecoveryFile(null);
      setSnapshot(null);
      setError(err instanceof Error ? err.message : 'Invalid recovery file');
    }
  }

  function handleFileUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      setFileContent(text);
      void processJson(text);
    };
    reader.readAsText(file);
  }

  function handlePasteSubmit(e: FormEvent) {
    e.preventDefault();
    void processJson(fileContent);
  }

  async function handleClaim() {
    if (!snapshot) return;
    setBusy(true);
    setError(null);
    try {
      const tx = await defaultRecoveryPort.executeClaim(snapshot);
      setActionResult(`Claim submitted! Transaction: ${tx}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Claim failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleRefund() {
    if (!snapshot) return;
    setBusy(true);
    setError(null);
    try {
      const tx = await defaultRecoveryPort.executeRefund(snapshot);
      setActionResult(`Refund submitted! Transaction: ${tx}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Refund failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      {/* Header */}
      <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-text">
            Recover a Swap
          </h1>
          <p className="text-xs text-text-muted">
            Claim or refund an atomic swap directly from your recovery file,
            independent of any server.
          </p>
        </div>
        <Link
          to="/"
          className="inline-flex h-8 items-center gap-1.5 rounded-pill border border-hairline bg-surface-2 px-3 text-xs font-semibold text-text hover:border-lime/40 transition-colors self-start sm:self-auto"
        >
          ← Back to Swap
        </Link>
      </div>

      {/* Upload Well */}
      <div className="mb-6 rounded-card border border-hairline bg-surface-1 p-5 shadow-elev-card">
        <h2 className="text-sm font-semibold text-text mb-2">
          Load Recovery File
        </h2>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <label className="flex-1 cursor-pointer">
            <div className="flex flex-col items-center justify-center rounded-well border border-dashed border-hairline bg-surface-2/60 p-6 text-center hover:border-lime/50 transition-colors">
              <span className="text-xs font-medium text-text">
                Choose recovery JSON file
              </span>
              <span className="mt-1 text-[11px] text-text-dim">
                or drag and drop here
              </span>
              <input
                type="file"
                accept=".json,application/json"
                onChange={handleFileUpload}
                className="sr-only"
              />
            </div>
          </label>
        </div>

        {/* Or Paste Raw JSON */}
        <form onSubmit={handlePasteSubmit} className="mt-4">
          <label
            htmlFor="recovery-json"
            className="text-xs text-text-muted block mb-1"
          >
            Or paste recovery file JSON:
          </label>
          <textarea
            id="recovery-json"
            rows={3}
            value={fileContent}
            onChange={(e) => setFileContent(e.target.value)}
            placeholder='{"version": 1, "orderId": "0x…", …}'
            className="w-full rounded-well border border-hairline bg-surface-2 p-3 font-mono text-xs text-text placeholder:text-text-dim focus:border-lime focus:outline-none"
          />
          <button
            type="submit"
            className="mt-2 rounded-pill bg-olive px-4 py-1.5 text-xs font-semibold text-text hover:bg-olive/90 transition-colors cursor-pointer"
          >
            Load File
          </button>
        </form>

        {/* Status Alerts */}
        {error && (
          <div
            className="mt-4 rounded-lg border border-danger/30 bg-danger/10 p-3 text-xs text-danger"
            role="alert"
          >
            {error}
          </div>
        )}
        {notice && (
          <div
            className="mt-4 rounded-lg border border-lime/30 bg-lime/10 p-3 text-xs text-lime"
            role="status"
          >
            {notice}
          </div>
        )}
        {actionResult && (
          <div
            className="mt-4 rounded-lg border border-ok/30 bg-ok/10 p-3 text-xs text-ok font-mono"
            role="status"
          >
            {actionResult}
          </div>
        )}
      </div>

      {/* File Details & Action Panel */}
      {recoveryFile && snapshot && (
        <div className="rounded-card border border-hairline bg-surface-1 p-5 shadow-elev-card">
          <h2 className="text-sm font-semibold text-text mb-4">
            Swap Parameters
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 text-xs">
            <div className="rounded-well border border-hairline bg-surface-2 p-3">
              <span className="text-text-dim block mb-1">Order ID</span>
              <span className="font-mono text-text font-medium break-all">
                {recoveryFile.orderId}
              </span>
            </div>
            <div className="rounded-well border border-hairline bg-surface-2 p-3">
              <span className="text-text-dim block mb-1">Direction</span>
              <span className="font-medium text-text">
                {recoveryFile.terms.direction === 'EVM_TO_BCH'
                  ? 'EVM Stablecoin → Bitcoin Cash'
                  : 'Bitcoin Cash → EVM Stablecoin'}
              </span>
            </div>
            <div className="rounded-well border border-hairline bg-surface-2 p-3">
              <span className="text-text-dim block mb-1">EVM Lock Status</span>
              <span className="font-semibold text-text capitalize">
                {snapshot.evmLockStatus}
              </span>
            </div>
            <div className="rounded-well border border-hairline bg-surface-2 p-3">
              <span className="text-text-dim block mb-1">BCH Lock Status</span>
              <span className="font-semibold text-text capitalize">
                {snapshot.bchLockStatus}
              </span>
            </div>
            <div className="col-span-full rounded-well border border-hairline bg-surface-2 p-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-text-dim">Secret Preimage</span>
                <button
                  type="button"
                  onClick={() => setShowSecret((s) => !s)}
                  className="text-[11px] text-lime hover:underline cursor-pointer"
                >
                  {showSecret ? 'Hide' : 'Reveal'}
                </button>
              </div>
              <span className="font-mono text-text break-all">
                {showSecret
                  ? recoveryFile.secret
                  : '••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••'}
              </span>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="mt-6 flex flex-col sm:flex-row gap-3">
            <button
              type="button"
              disabled={!snapshot.canClaim || busy}
              onClick={handleClaim}
              className="flex-1 rounded-pill bg-olive py-2.5 text-xs font-semibold text-text hover:bg-olive/90 disabled:opacity-40 disabled:pointer-events-none transition-colors cursor-pointer"
            >
              Claim Funds with Secret
            </button>
            <button
              type="button"
              disabled={!snapshot.bchCanRefund && !snapshot.evmCanRefund}
              onClick={handleRefund}
              className="flex-1 rounded-pill border border-hairline bg-surface-3 py-2.5 text-xs font-semibold text-text hover:border-warn/40 disabled:opacity-40 disabled:pointer-events-none transition-colors cursor-pointer"
            >
              Refund Expired Lock
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
