import { useEffect } from 'react';
import { GlassModal } from './GlassModal';
import { useWallets } from '../lib/wallet/context';
import { NETWORK_PROFILE, REOWN_PROJECT_ID } from '../lib/config';
import { AlertTriangleIcon, CheckIcon, WalletIcon } from './icons';

interface WalletSheetProps {
  readonly open: boolean;
  readonly onClose: () => void;
}

function truncateMiddle(str: string, head = 8, tail = 6): string {
  if (str.length <= head + tail + 3) return str;
  return `${str.slice(0, head)}…${str.slice(-tail)}`;
}

/**
 * Both wallets in one place: the EVM wallet and the Bitcoin Cash wallet, each with its own connect
 * and disconnect. Shown in the pill's dropdown at the top right and, when another page asks for a
 * wallet, in a dialog. `onConnectStart` is called when a connect button is pressed, so the
 * container can get out of the way of the wallet's own window.
 */
export function WalletPanel({
  onConnectStart,
}: {
  readonly onConnectStart?: () => void;
}) {
  const { evm, bch, usingMocks } = useWallets();
  const onClose = onConnectStart ?? (() => undefined);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('ferry:activate-wallets'));
    }
  }, []);

  return (
    <div className="space-y-4 pt-1">
      {usingMocks && (
        <div className="flex items-center gap-2 rounded-lg border border-warn/30 bg-warn/10 p-2.5 text-xs text-warn">
          <AlertTriangleIcon className="size-4 shrink-0" />
          <span>
            Mock wallet mode active. Simulated transactions and addresses are in
            use.
          </span>
        </div>
      )}

      {/* --- EVM Section --- */}
      <div className="rounded-xl border border-hairline bg-surface-2 p-3.5">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-text-muted">
            EVM Wallet
          </span>
          {evm.status === 'connected' && (
            <span className="inline-flex items-center gap-1 rounded-pill bg-ok/10 px-2 py-0.5 text-[11px] font-medium text-ok">
              <CheckIcon className="size-3" /> Connected
            </span>
          )}
        </div>

        {!REOWN_PROJECT_ID && !usingMocks && (
          <div className="rounded-lg border border-hairline bg-surface-3 p-3 text-xs text-text-dim">
            <p className="font-medium text-warn mb-1">
              Reown Project ID Missing
            </p>
            <p>
              EVM wallet connection requires a Reown Project ID. Set{' '}
              <code className="text-text font-mono text-[11px]">
                VITE_REOWN_PROJECT_ID
              </code>{' '}
              in your environment.
            </p>
          </div>
        )}

        {evm.status === 'connected' && evm.address && (
          <div className="space-y-2.5">
            <div className="flex items-center justify-between rounded-lg bg-surface-3 px-3 py-2 text-xs">
              <span className="font-mono text-text">
                {truncateMiddle(evm.address, 10, 8)}
              </span>
              <button
                type="button"
                onClick={() => void evm.disconnect()}
                className="text-xs text-text-muted hover:text-warn transition-colors cursor-pointer"
              >
                Disconnect
              </button>
            </div>
          </div>
        )}

        {evm.status !== 'connected' && (REOWN_PROJECT_ID || usingMocks) && (
          <button
            type="button"
            onClick={() => {
              // The wallet picker opens on top; ours must get out of its way.
              evm.connect();
              onClose();
            }}
            disabled={evm.status === 'connecting'}
            className="flex w-full items-center justify-center gap-2 rounded-pill bg-surface-3 border border-hairline px-4 py-2.5 text-xs font-semibold text-text hover:bg-surface-4 transition-colors cursor-pointer"
          >
            <WalletIcon className="size-4 text-lime" />
            <span>
              {evm.status === 'connecting'
                ? 'Connecting EVM...'
                : 'Connect EVM Wallet'}
            </span>
          </button>
        )}

        {/* EVM Pending Request / Stuck Prompt */}
        {evm.pendingRequest && (
          <div className="mt-3 rounded-lg border border-hairline bg-surface-3 p-2.5 text-xs space-y-2">
            <div className="flex items-center justify-between text-text">
              <span className="font-medium">{evm.pendingRequest}</span>
              {evm.cancelPendingRequest && (
                <button
                  type="button"
                  onClick={() => evm.cancelPendingRequest?.()}
                  className="rounded px-2 py-0.5 text-warn border border-warn/30 hover:bg-warn/10 cursor-pointer"
                >
                  Cancel request
                </button>
              )}
            </div>
            {evm.promptHelp && (
              <p className="text-[11px] text-warn">{evm.promptHelp}</p>
            )}
          </div>
        )}

        {evm.error && (REOWN_PROJECT_ID || usingMocks) && (
          <p className="mt-2 text-xs text-warn">{evm.error}</p>
        )}
      </div>

      {/* --- BCH Section --- */}
      <div className="rounded-xl border border-hairline bg-surface-2 p-3.5">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-text-muted">
            {NETWORK_PROFILE.bch.name === 'Bitcoin Cash'
              ? 'Bitcoin Cash'
              : `Bitcoin Cash (${NETWORK_PROFILE.bch.name})`}
          </span>
          {bch.status === 'connected' && (
            <span className="inline-flex items-center gap-1 rounded-pill bg-ok/10 px-2 py-0.5 text-[11px] font-medium text-ok">
              <CheckIcon className="size-3" /> Connected
            </span>
          )}
          {bch.status === 'offline' && (
            <span className="rounded-pill bg-surface-3 px-2 py-0.5 text-[11px] text-text-dim">
              Remembered
            </span>
          )}
        </div>

        {bch.status === 'connected' && bch.address && (
          <div className="space-y-2.5">
            <div className="flex items-center justify-between rounded-lg bg-surface-3 px-3 py-2 text-xs">
              <div>
                <span className="font-mono text-text block">
                  {truncateMiddle(bch.address.address, 12, 8)}
                </span>
                {bch.walletName && (
                  <span className="text-[10px] text-text-dim">
                    {bch.walletName}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => void bch.disconnect()}
                className="text-xs text-text-muted hover:text-warn transition-colors cursor-pointer"
              >
                Disconnect
              </button>
            </div>
          </div>
        )}

        {bch.status !== 'connected' && (
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => {
                // The wallet's own QR dialog opens on top; ours must get out of its way.
                bch.connect();
                onClose();
              }}
              disabled={bch.status === 'connecting'}
              className="flex w-full items-center justify-center gap-2 rounded-pill bg-surface-3 border border-hairline px-4 py-2.5 text-xs font-semibold text-text hover:bg-surface-4 transition-colors cursor-pointer"
            >
              <WalletIcon className="size-4 text-lime" />
              <span>
                {bch.status === 'connecting'
                  ? 'Waiting for wallet scan...'
                  : 'Connect BCH Wallet'}
              </span>
            </button>
            <p className="text-center text-[11px] text-text-dim">
              Compatible with Paytaca, Selene, and WizardConnect wallets.
            </p>
          </div>
        )}

        {/* BCH Pending Request / Stuck Prompt */}
        {bch.pendingRequest && (
          <div className="mt-3 rounded-lg border border-hairline bg-surface-3 p-2.5 text-xs space-y-2">
            <div className="flex items-center justify-between text-text">
              <span className="font-medium">{bch.pendingRequest}</span>
              <button
                type="button"
                onClick={() => bch.cancelPendingRequest()}
                className="rounded px-2 py-0.5 text-warn border border-warn/30 hover:bg-warn/10 cursor-pointer"
              >
                Cancel request
              </button>
            </div>
            {bch.promptHelp && (
              <p className="text-[11px] text-warn">{bch.promptHelp}</p>
            )}
          </div>
        )}

        {/* BCH Error / Network Prefix Mismatch Notice */}
        {bch.error && (
          <div className="mt-2.5 rounded-lg border border-warn/30 bg-warn/10 p-2.5 text-xs text-warn flex items-start gap-2">
            <AlertTriangleIcon className="size-4 shrink-0 mt-0.5" />
            <span>{bch.error}</span>
          </div>
        )}
      </div>
    </div>
  );
}

export function WalletSheet({ open, onClose }: WalletSheetProps) {
  return (
    <GlassModal
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title="Connect Wallets"
      description="Connect your EVM and Bitcoin Cash wallets for trust-minimised swaps."
    >
      <WalletPanel onConnectStart={onClose} />
      <button
        type="button"
        onClick={onClose}
        className="mt-4 w-full rounded-pill bg-surface-2 py-2 text-xs font-medium text-text-muted hover:text-text transition-colors cursor-pointer"
      >
        Close
      </button>
    </GlassModal>
  );
}
