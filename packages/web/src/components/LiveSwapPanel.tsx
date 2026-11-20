import { useCallback, useEffect, useRef, useState } from 'react';
import type { QuoteInput, SwapState, UserSwapSession } from '@ferry/user-flow';
import { UserFlowError } from '@ferry/user-flow';
import type { VerifiedQuote } from '@ferry/solver-client';
import { GlassModal } from './GlassModal';
import {
  createLiveDependencies,
  type LiveSwapWallets,
} from '../lib/live/ports';
import { executeSwap, prepareSwap, previewSwap } from '../lib/live/run';
import { browserRecoveryStorage } from '../lib/recovery/recovery-key-service';

type Phase =
  | 'previewing'
  | 'preview'
  | 'preparing'
  | 'keepFile'
  | 'running'
  | 'done'
  | 'failed';

const STEP_LABEL: Record<string, string> = {
  quote: 'Getting a price',
  saveRecovery: 'Saving your recovery file',
  lock: 'Locking your funds',
  waitCounterLock: "Waiting for the solver's lock",
  claim: 'Claiming your funds',
  done: 'Done',
  refund: 'Refund available',
  refunded: 'Refunded',
};

/** The work the panel drives. The defaults are the real ones; tests pass fakes. */
export interface LiveSwapServices {
  readonly createDependencies: typeof createLiveDependencies;
  readonly preview: typeof previewSwap;
  readonly prepare: typeof prepareSwap;
  readonly execute: typeof executeSwap;
}

const REAL_SERVICES: LiveSwapServices = {
  createDependencies: createLiveDependencies,
  preview: previewSwap,
  prepare: prepareSwap,
  execute: executeSwap,
};

export interface LiveSwapPanelProps {
  readonly services?: LiveSwapServices;
  readonly open: boolean;
  readonly onClose: () => void;
  readonly input: QuoteInput;
  readonly wallets: LiveSwapWallets;
  readonly solverUrl: string;
  readonly describe: {
    readonly pay: string;
    readonly receive: string;
  };
  /**
   * When given, "Start swap" hands the swap to the order page (/app/swap/<order id>) instead of
   * running it inside this dialog: the page shows the steps and survives a reload.
   */
  readonly onStart?: ((orderId: string) => void) | undefined;
}

function downloadJson(filename: string, json: string): boolean {
  try {
    const url = URL.createObjectURL(
      new Blob([json], { type: 'application/json' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    return true;
  } catch {
    return false;
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Runs the user's side of a real swap from the page. The order is fixed: a
 * price preview that reserves nothing, then the recovery file, then the lock.
 * Nothing is locked until the file has been saved and downloaded.
 */
export function LiveSwapPanel({
  open,
  onClose,
  input,
  wallets,
  solverUrl,
  describe,
  onStart,
  services = REAL_SERVICES,
}: LiveSwapPanelProps) {
  const [phase, setPhase] = useState<Phase>('previewing');
  const [quote, setQuote] = useState<VerifiedQuote | null>(null);
  const [state, setState] = useState<SwapState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fileSaved, setFileSaved] = useState(false);
  const [refundFlag, setRefundFlag] = useState(false);
  const [isContract, setIsContract] = useState(false);
  const sessionRef = useRef<UserSwapSession | null>(null);
  const recoveryRef = useRef<{ filename: string; json: string } | null>(null);
  const started = useRef(false);

  const evmAddress = wallets?.evm?.address?.toLowerCase();
  const hasWalletRecovery = Boolean(evmAddress);
  const requiresFileDownload = !hasWalletRecovery || isContract;

  useEffect(() => {
    if (!evmAddress) {
      setIsContract(false);
      return;
    }
    void browserRecoveryStorage
      .get(`ferry.recovery.contract.${evmAddress}`)
      .then((flag) => {
        setIsContract(flag === 'true');
      });
  }, [evmAddress]);

  const deps = useCallback(
    () =>
      services.createDependencies({
        wallets,
        solverUrl,
        chainId: input.chainId,
      }),
    [services, wallets, solverUrl, input.chainId],
  );

  useEffect(() => {
    if (!open || started.current) return;
    started.current = true;
    setPhase('previewing');
    services
      .preview(deps(), input)
      .then((verified) => {
        setQuote(verified);
        setPhase('preview');
      })
      .catch((cause: unknown) => {
        setError(messageOf(cause));
        setPhase('failed');
      });
  }, [open, deps, input, services]);

  useEffect(() => {
    if (!open) started.current = false;
  }, [open]);

  async function handleContinue() {
    setError(null);
    setPhase('preparing');
    try {
      const prepared = await services.prepare(deps(), input);
      sessionRef.current = prepared.session;
      recoveryRef.current = prepared.recovery;
      setFileSaved(false);
      setPhase('keepFile');
    } catch (cause) {
      setError(messageOf(cause));
      setPhase('failed');
    }
  }

  function handleDownload() {
    const file = recoveryRef.current;
    if (!file) return;
    if (downloadJson(file.filename, file.json)) setFileSaved(true);
    else
      setError(
        'This browser could not start the download. Copy the file from the box below.',
      );
  }

  async function handleLock() {
    const session = sessionRef.current;
    if (!session) return;
    if (onStart && session.state.orderId) {
      onStart(session.state.orderId);
      return;
    }
    setError(null);
    setPhase('running');
    try {
      const final = await services.execute(session, setState);
      setState(final);
      setPhase('done');
    } catch (cause) {
      setError(messageOf(cause));
      setRefundFlag(cause instanceof UserFlowError && cause.refundPossible);
      setState(session.state);
      setPhase('failed');
    }
  }

  async function handleRefund() {
    const session = sessionRef.current;
    if (!session) return;
    setError(null);
    try {
      await session.refund();
      setState(session.state);
    } catch (cause) {
      setError(messageOf(cause));
    }
  }

  // What the wallets are waiting on. Only the user's wallet can answer, so say so, and let them
  // cancel a request that never arrives.
  const walletRequest = (() => {
    for (const wallet of [wallets?.bch, wallets?.evm]) {
      if (wallet?.pendingRequest) {
        return {
          text: wallet.pendingRequest,
          help: wallet.promptHelp ?? null,
          cancel: wallet.cancelPendingRequest
            ? () => wallet.cancelPendingRequest?.()
            : null,
        };
      }
    }
    return null;
  })();

  // Once a lock exists the user's own refund is always the way out; the
  // session only runs it when the recovery planner says its deadline passed.
  const refundPossible = refundFlag || state?.txids.userLock != null;

  return (
    <GlassModal
      open={open}
      onOpenChange={(next) => {
        if (!next && phase !== 'running') onClose();
      }}
      title="Swap"
      description="Your funds stay under a lock that only you or the solver's matching lock can release."
    >
      <div
        className="space-y-3 text-sm text-text"
        data-testid="live-swap-panel"
      >
        <div className="flex justify-between">
          <span className="text-text-dim">You pay</span>
          <span>{describe.pay}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-text-dim">You receive</span>
          <span>{describe.receive}</span>
        </div>

        {phase === 'previewing' && (
          <p className="text-text-dim">Checking the price…</p>
        )}

        {phase === 'preview' && quote && (
          <>
            <p className="text-text-dim" data-testid="live-preview-note">
              This is a price only. Nothing is reserved or locked yet. The next
              step creates your recovery file; keep it safe.
            </p>
            <button
              type="button"
              className="h-10 w-full rounded-pill bg-olive font-semibold"
              onClick={handleContinue}
              data-testid="live-continue"
            >
              Continue
            </button>
          </>
        )}

        {phase === 'preparing' && (
          <p className="text-text-dim">Preparing your recovery file…</p>
        )}

        {phase === 'keepFile' && (
          <>
            <p data-testid="live-keep-file-note">
              {isContract
                ? 'Smart contract wallet detected: keep this per-swap recovery file to ensure you can recover your funds.'
                : hasWalletRecovery
                  ? 'This swap can be recovered with your wallet on any device. If anything stops, your refund stays available.'
                  : 'Download your recovery file before anything is locked. It holds the secret that releases your funds and the way to refund if something stops.'}
            </p>
            <button
              type="button"
              className="h-10 w-full rounded-pill border border-hairline bg-surface-2 font-medium"
              onClick={handleDownload}
              data-testid="live-download"
            >
              {fileSaved
                ? '✓ Recovery file downloaded'
                : hasWalletRecovery && !isContract
                  ? 'Download recovery file (optional)'
                  : 'Download recovery file'}
            </button>
            <button
              type="button"
              disabled={requiresFileDownload && !fileSaved}
              className="h-10 w-full rounded-pill bg-olive font-semibold disabled:opacity-40"
              onClick={handleLock}
              data-testid="live-lock"
            >
              Start swap
            </button>
          </>
        )}

        {(phase === 'running' || phase === 'done' || phase === 'failed') &&
          state && (
            <div
              data-testid="live-progress"
              className="rounded-lg border border-hairline p-3"
            >
              <div className="font-medium">
                {STEP_LABEL[state.step] ?? state.step}
              </div>
              {state.waiting && (
                <div className="text-text-dim">{state.waiting}</div>
              )}
            </div>
          )}

        {phase === 'running' && walletRequest && (
          <div
            data-testid="live-wallet-request"
            className="rounded-lg border border-hairline bg-surface-2 p-3 text-xs"
          >
            <p className="font-medium text-text">
              Waiting for your wallet: {walletRequest.text}
            </p>
            {walletRequest.help && (
              <p className="mt-1 text-warn">{walletRequest.help}</p>
            )}
            {walletRequest.cancel && (
              <button
                type="button"
                onClick={walletRequest.cancel}
                data-testid="live-wallet-cancel"
                className="mt-2 rounded-pill border border-warn/30 px-3 py-1 text-warn hover:bg-warn/10"
              >
                Cancel request
              </button>
            )}
          </div>
        )}

        {phase === 'running' && (
          <p className="text-text-dim">
            Keep this page open. If it closes, reopen it and your swap resumes
            from the recovery file.
          </p>
        )}

        {phase === 'done' && (
          <p className="text-ok" data-testid="live-done">
            {input.direction === 'EVM_TO_BCH'
              ? 'Done. Your claim was sent. The Bitcoin Cash balance shows in your wallet once the transaction confirms, which can take several minutes.'
              : 'Done. Your claim was sent. The USDC shows in your wallet once the transaction is mined.'}
          </p>
        )}

        {error && (
          <p role="alert" className="text-bad" data-testid="live-error">
            {error}
          </p>
        )}

        {phase === 'failed' && (
          <div className="space-y-2">
            {refundPossible && (
              <button
                type="button"
                className="h-10 w-full rounded-pill border border-hairline bg-surface-2 font-medium"
                onClick={handleRefund}
                data-testid="live-refund"
              >
                Refund my funds
              </button>
            )}
            <button
              type="button"
              className="h-10 w-full rounded-pill border border-hairline font-medium"
              onClick={onClose}
            >
              Close
            </button>
          </div>
        )}
      </div>
    </GlassModal>
  );
}
