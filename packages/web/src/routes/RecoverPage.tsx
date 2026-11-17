import { useState, useContext, type ChangeEvent, type FormEvent } from 'react';
import { ROUTES } from '../lib/routes';
import { Link } from 'react-router';
import {
  parseRecoveryFileJson,
  recoveryActions,
  buildEvmRecoveryCalldata,
  orderId as computeOrderId,
  type RecoveryFile,
  type RecoveryPlan,
  type Hex32,
} from '@ferry/core';
import {
  getEvmWalletRecoveryActions,
  inspectEvmWalletRecovery,
  type EvmWalletRecoveryPlan,
} from '@ferry/chain-evm';
import { createPublicClient, http, type Address, type Hex } from 'viem';
import { base } from 'viem/chains';
import { WalletContext } from '../lib/wallet/context';
import { CopyDiagnosticsButton } from '../components/CopyDiagnosticsButton';
import { InfoIcon, ExternalLinkIcon } from '../components/icons';
import { useToast } from '../lib/toast/ToastContext';

export function RecoverPage() {
  const walletContext = useContext(WalletContext);
  const { showToast } = useToast();
  const [fileContent, setFileContent] = useState('');
  const [recoveryFile, setRecoveryFile] = useState<RecoveryFile | null>(null);
  const [plan, setPlan] = useState<RecoveryPlan | null>(null);
  const [evmPlan, setEvmPlan] = useState<EvmWalletRecoveryPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showSecret, setShowSecret] = useState(false);
  const [actionResult, setActionResult] = useState<string | null>(null);
  const [evmCalldata, setEvmCalldata] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function processJson(rawJson: string) {
    setError(null);
    setNotice(null);
    setActionResult(null);
    setEvmCalldata(null);

    let rawObj: Record<string, unknown>;
    try {
      rawObj = JSON.parse(rawJson);
    } catch {
      setRecoveryFile(null);
      setPlan(null);
      setEvmPlan(null);
      setError('Invalid JSON format');
      return;
    }

    const isSimulation =
      rawObj.isSimulation === true ||
      rawObj.solverKind === 'simulation' ||
      (rawObj.solverKind != null &&
        rawObj.solverKind !== 'real' &&
        rawObj.solverKind !== 'live') ||
      Boolean(rawObj.isSimulation);

    // Strip optional legacy metadata not part of strict RecoveryFile schema
    if ('solverKind' in rawObj) {
      delete rawObj.solverKind;
    }

    let parsed: RecoveryFile;
    try {
      parsed = parseRecoveryFileJson(JSON.stringify(rawObj));
    } catch (err) {
      setRecoveryFile(null);
      setPlan(null);
      setEvmPlan(null);
      setError(
        err instanceof Error ? err.message : 'Invalid recovery file structure',
      );
      return;
    }

    try {
      const calculatedId = computeOrderId(parsed.terms);
      if (calculatedId.toLowerCase() !== parsed.orderId.toLowerCase()) {
        throw new Error(
          'Order ID does not match the terms in this recovery file',
        );
      }
    } catch (err) {
      setRecoveryFile(null);
      setPlan(null);
      setEvmPlan(null);
      setError(
        err instanceof Error
          ? err.message
          : 'Order ID does not match the terms in this recovery file',
      );
      return;
    }

    setRecoveryFile(parsed);

    // Run core's direction-aware recoveryActions planner (Requirement 3)
    const now = Math.floor(Date.now() / 1000);
    const recoveryPlan = recoveryActions(parsed, {
      nowSeconds: now,
      bchTipHeight: 170000,
      evmLock: { state: 'locked' },
      bchLock: { state: 'locked' },
    });
    setPlan(recoveryPlan);

    // Run EVM wallet recovery plan calculation (Requirement 2)
    const evmRecovery = getEvmWalletRecoveryActions({
      status: 'locked',
      deadline: Number(parsed.terms.evmDeadline),
      nowSeconds: now,
      hashLock: parsed.terms.hashLock,
      ...(parsed.secret ? { secret: parsed.secret } : {}),
      blockTimeSeconds: 2,
    });
    setEvmPlan(evmRecovery);

    if (isSimulation) {
      setNotice(
        'Recovery file loaded. This file was issued by an offline simulation and cannot be claimed on chain.',
      );
    } else {
      setNotice(
        'Recovery file loaded successfully. Contract parameters verified.',
      );
      showToast('Recovery file loaded successfully', 'success');
    }
  }

  function handleFileUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      setFileContent(text);
      processJson(text);
    };
    reader.readAsText(file);
  }

  function handlePasteSubmit(e: FormEvent) {
    e.preventDefault();
    processJson(fileContent);
  }

  async function handleClaim() {
    if (!recoveryFile) return;
    setBusy(true);
    setError(null);
    try {
      if (
        walletContext?.evm?.status === 'connected' &&
        recoveryFile.secret &&
        recoveryFile.orderId
      ) {
        const txHash = await walletContext.evm.claimLock(
          recoveryFile.orderId as Hex,
          recoveryFile.secret as Hex,
        );
        setActionResult(
          `EVM claim submitted via connected wallet! Tx hash: ${txHash}. Secret preimage: ${recoveryFile.secret}`,
        );
      } else {
        setActionResult(
          `Claim ready! Secret preimage: ${recoveryFile.secret ?? 'Preimage unavailable in this file'}`,
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Claim failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleRefund() {
    if (!recoveryFile) return;
    setBusy(true);
    setError(null);
    try {
      if (walletContext?.evm?.status === 'connected' && recoveryFile.orderId) {
        const txHash = await walletContext.evm.refundLock(
          recoveryFile.orderId as Hex,
        );
        setActionResult(
          `EVM refund submitted via connected wallet! Tx hash: ${txHash}. Target: ${recoveryFile.terms.direction === 'EVM_TO_BCH' ? recoveryFile.terms.userEvmAddress : 'BCH locking bytecode'}`,
        );
      } else {
        setActionResult(
          `Refund ready! Target: ${recoveryFile.terms.direction === 'EVM_TO_BCH' ? recoveryFile.terms.userEvmAddress : 'BCH locking bytecode'}`,
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Refund failed');
    } finally {
      setBusy(false);
    }
  }

  function handleViewEvmCalldata() {
    if (!recoveryFile) return;
    try {
      const calldata = buildEvmRecoveryCalldata(recoveryFile);
      setEvmCalldata(
        JSON.stringify(
          calldata,
          (_k, v) => (typeof v === 'bigint' ? v.toString() : v),
          2,
        ),
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Could not generate EVM recovery calldata',
      );
    }
  }

  async function handleInspectEvmOnChain() {
    if (!recoveryFile) return;
    setBusy(true);
    setError(null);
    try {
      const client = createPublicClient({
        chain: base,
        transport: http(),
      });
      const onChainPlan = await inspectEvmWalletRecovery({
        client: client as unknown as Parameters<
          typeof inspectEvmWalletRecovery
        >[0]['client'],
        htlc: recoveryFile.contracts.evm.htlcAddress as Address,
        lockId: recoveryFile.orderId,
        ...(recoveryFile.secret
          ? { secret: recoveryFile.secret as Hex32 }
          : {}),
      });
      setEvmPlan(onChainPlan);
      setNotice('On-chain EVM status verified.');
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Could not query on-chain EVM status',
      );
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

      {/* What is a recovery file explainer panel (Requirement 4) */}
      <div
        data-testid="what-is-recovery-panel"
        className="mb-6 rounded-card border border-hairline bg-surface-1/60 p-5 text-xs shadow-elev-card"
      >
        <div className="flex items-center gap-2 mb-2">
          <InfoIcon className="size-4 text-lime shrink-0" />
          <h2 className="text-sm font-semibold text-text">
            What is a recovery file?
          </h2>
        </div>
        <p className="text-text-muted leading-relaxed">
          A recovery file is a local, portable JSON backup created whenever you
          initiate a swap. It contains the on-chain contract addresses, lock
          scripts, refund deadlines, and secret hashes. Because Ferry is
          non-custodial, this file allows you to claim your funds or execute an
          automatic refund directly on-chain—even if this website and every
          solver are completely unreachable.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-text-dim border-t border-hairline/60 pt-2.5">
          <span>• 100% self-sovereign recovery</span>
          <span>• Usable in this browser or offline in terminal</span>
          <a
            href="https://github.com/deyoungjohn/ferry/tree/main/packages/recover-cli"
            target="_blank"
            rel="noreferrer"
            className="text-lime hover:underline inline-flex items-center gap-1"
          >
            <span>CLI tool: @ferry/recover-cli</span>
            <ExternalLinkIcon className="size-3" />
          </a>
        </div>
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
            className="mt-4 rounded-lg border border-danger/30 bg-danger/10 p-3 text-xs text-danger flex items-center justify-between gap-3"
            role="alert"
          >
            <span>{error}</span>
            <CopyDiagnosticsButton
              data={{
                route: ROUTES.recover,
                errorCode: 'RECOVERY_ERROR',
                errorMessage: error,
              }}
            />
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

      {/* File Details & Core recoveryActions Plan (Requirement 3) */}
      {recoveryFile && plan && (
        <div className="rounded-card border border-hairline bg-surface-1 p-5 shadow-elev-card">
          <h2 className="text-sm font-semibold text-text mb-4">
            Recovery Plan & Parameters
          </h2>

          {/* Core Plan Summary */}
          <div
            data-testid="recovery-plan-summary"
            className="mb-4 rounded-well border border-lime/30 bg-lime/10 p-3.5 text-xs text-lime"
          >
            <span className="font-semibold block text-[11px] uppercase tracking-wider text-text-dim mb-1">
              Action Plan Summary
            </span>
            <p className="font-medium text-sm text-text">{plan.summary}</p>
          </div>

          {/* EVM Wallet Recovery Status (§Requirement 2) */}
          {evmPlan && (
            <div
              data-testid="evm-recovery-plan"
              className="mb-4 rounded-well border border-hairline bg-surface-2 p-3.5 text-xs"
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className="font-semibold text-[11px] uppercase tracking-wider text-text-dim">
                  EVM Contract Status
                </span>
                <span
                  className={`inline-flex items-center rounded-pill px-2 py-0.5 text-[11px] font-semibold ${
                    evmPlan.actions.length > 0
                      ? 'bg-ok/10 text-ok border border-ok/30'
                      : 'bg-surface-3 text-text-muted border border-hairline'
                  }`}
                >
                  {evmPlan.status.toUpperCase()}
                </span>
              </div>
              <p className="text-text font-medium">{evmPlan.summary}</p>
              {evmPlan.secondsRemaining !== undefined &&
                evmPlan.secondsRemaining > 0 && (
                  <p className="mt-1 text-[11px] text-warn">
                    Time to refund deadline:{' '}
                    <span className="font-mono">
                      {Math.ceil(evmPlan.secondsRemaining / 60)} minutes (
                      {evmPlan.blocksRemaining ??
                        Math.ceil(evmPlan.secondsRemaining / 2)}{' '}
                      blocks)
                    </span>
                  </p>
                )}
            </div>
          )}

          {/* Actions & Waits directly from recoveryActions */}
          <div className="mb-4 space-y-2">
            {plan.actions.length > 0 && (
              <div className="rounded-well border border-hairline bg-surface-2 p-3">
                <span className="text-xs font-semibold text-ok uppercase tracking-wider block mb-2">
                  Ready Actions ({plan.actions.length})
                </span>
                <ul className="space-y-1 text-xs">
                  {plan.actions.map((act, i) => (
                    <li
                      key={i}
                      className="flex items-center justify-between text-text"
                    >
                      <span>
                        Chain:{' '}
                        <strong className="text-lime">{act.chain}</strong>
                      </span>
                      <span className="capitalize font-semibold text-ok">
                        {act.action}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {plan.waits.length > 0 && (
              <div className="rounded-well border border-hairline bg-surface-2 p-3">
                <span className="text-xs font-semibold text-text-muted uppercase tracking-wider block mb-2">
                  Conditions to Wait For ({plan.waits.length})
                </span>
                <ul className="space-y-1.5 text-xs">
                  {plan.waits.map((wait, i) => (
                    <li
                      key={i}
                      className="text-text-muted border-l-2 border-warn/40 pl-2"
                    >
                      <span className="font-semibold text-text">
                        [{wait.chain} {wait.action}]:
                      </span>{' '}
                      {wait.waitingFor}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

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
              <span className="text-text-dim block mb-1">
                EVM HTLC Contract
              </span>
              <span className="font-mono text-text text-[11px] break-all">
                {recoveryFile.contracts.evm.htlcAddress}
              </span>
            </div>
            <div className="rounded-well border border-hairline bg-surface-2 p-3">
              <span className="text-text-dim block mb-1">BCH HTLC Network</span>
              <span className="font-semibold text-text capitalize">
                {recoveryFile.contracts.bch.network}
              </span>
            </div>
            <div className="col-span-full rounded-well border border-hairline bg-surface-2 p-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-text-dim">Secret Preimage</span>
                {recoveryFile.secret && (
                  <button
                    type="button"
                    onClick={() => setShowSecret((s) => !s)}
                    className="text-[11px] text-lime hover:underline cursor-pointer"
                  >
                    {showSecret ? 'Hide' : 'Reveal'}
                  </button>
                )}
              </div>
              <span className="font-mono text-text break-all">
                {recoveryFile.secret
                  ? showSecret
                    ? recoveryFile.secret
                    : '••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••'
                  : 'Not present in this recovery file'}
              </span>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="mt-6 flex flex-col sm:flex-row gap-3">
            <button
              type="button"
              disabled={!plan.actions.some((a) => a.action === 'claim') || busy}
              onClick={handleClaim}
              className="flex-1 rounded-pill bg-olive py-2.5 text-xs font-semibold text-text hover:bg-olive/90 disabled:opacity-40 disabled:pointer-events-none transition-colors cursor-pointer"
            >
              Claim Funds with Secret
            </button>
            <button
              type="button"
              disabled={
                !plan.actions.some((a) => a.action === 'refund') || busy
              }
              onClick={handleRefund}
              className="flex-1 rounded-pill border border-hairline bg-surface-3 py-2.5 text-xs font-semibold text-text hover:border-warn/40 disabled:opacity-40 disabled:pointer-events-none transition-colors cursor-pointer"
            >
              Refund Expired Lock
            </button>
            <button
              type="button"
              onClick={handleViewEvmCalldata}
              className="rounded-pill border border-hairline bg-surface-2 px-3 py-2.5 text-xs font-semibold text-text hover:border-lime/40 transition-colors cursor-pointer"
            >
              Generate Calldata
            </button>
            <button
              type="button"
              data-testid="inspect-evm-button"
              disabled={busy}
              onClick={handleInspectEvmOnChain}
              className="rounded-pill border border-hairline bg-surface-2 px-3 py-2.5 text-xs font-semibold text-text hover:border-lime/40 transition-colors cursor-pointer"
            >
              Verify On-Chain Status
            </button>
          </div>

          {evmCalldata && (
            <div className="mt-4 rounded-well border border-hairline bg-surface-2 p-3 text-xs">
              <span className="text-text-dim block mb-1">
                EVM Recovery Calldata
              </span>
              <pre className="font-mono text-[11px] text-text whitespace-pre-wrap break-all overflow-x-auto">
                {evmCalldata}
              </pre>
            </div>
          )}

          {/* CLI Link in plain words */}
          <p className="mt-5 border-t border-hairline/60 pt-3 text-xs text-text-dim">
            Need command-line recovery? You can run the terminal recovery tool{' '}
            <code className="text-text font-mono">@ferry/recover-cli</code> (run{' '}
            <code className="text-lime font-mono">pnpm -w recover</code>) to
            execute directly against public RPC nodes without any Ferry server.
          </p>
        </div>
      )}
    </div>
  );
}
