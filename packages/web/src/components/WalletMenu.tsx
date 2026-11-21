import * as Popover from '@radix-ui/react-popover';
import { useWallets } from '../lib/wallet/context';
import { WalletIcon } from './icons';
import { WalletPanel } from './WalletSheet';

/** `bitcoincash:zplzkj…8ff65` → `zplz…8ff65`. */
function shortBch(address: string): string {
  const body = address.includes(':') ? address.split(':')[1]! : address;
  return body.length > 10 ? `${body.slice(0, 4)}…${body.slice(-5)}` : body;
}

/** `0x12dcbbc7…da841` → `0x12dc…a841`. */
function shortEvm(address: string): string {
  return address.length > 12
    ? `${address.slice(0, 6)}…${address.slice(-4)}`
    : address;
}

export interface WalletMenuProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

/**
 * The pill at the top right. Closed it says what is connected; open it is a dropdown holding both
 * wallets, the EVM wallet and the Bitcoin Cash wallet, each with its own connect and disconnect.
 */
export function WalletMenu({ open, onOpenChange }: WalletMenuProps) {
  const { evm, bch } = useWallets();
  const evmOn = evm.status === 'connected';
  const bchOn = bch.status === 'connected';
  const isConnected = evmOn || bchOn;

  // The Bitcoin Cash wallet is named first when it is connected; otherwise the EVM wallet.
  const label =
    bchOn && bch.address
      ? shortBch(bch.address.address)
      : evmOn && evm.address
        ? shortEvm(evm.address)
        : isConnected
          ? 'Connected'
          : 'Connect';

  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-haspopup="dialog"
          className={`inline-flex h-11 items-center gap-2 rounded-full px-5 text-[14px] font-semibold transition-colors cursor-pointer ${
            isConnected
              ? 'border border-hairline bg-surface-3 text-text hover:border-lime/40'
              : 'bg-lime text-lime-ink hover:opacity-90'
          }`}
        >
          <WalletIcon
            className={`size-4 ${isConnected ? 'text-lime' : 'text-lime-ink'}`}
          />
          <span>{label}</span>
          {/* Which of the two are connected, at a glance. */}
          <span className="flex items-center gap-1" aria-hidden="true">
            <span
              className={`size-1.5 rounded-full ${evmOn ? 'bg-lime' : 'bg-white/25'}`}
              title="EVM"
            />
            <span
              className={`size-1.5 rounded-full ${bchOn ? 'bg-lime' : 'bg-white/25'}`}
              title="Bitcoin Cash"
            />
          </span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={10}
          collisionPadding={12}
          // Closing must not move focus back to the pill: the wallet's own window may be opening.
          onCloseAutoFocus={(event) => event.preventDefault()}
          data-testid="wallet-menu"
          className="glass glass-pop glass-pop--dark z-[60] max-h-[calc(100svh-96px)] w-[min(92vw,400px)] overflow-y-auto p-4 outline-none"
        >
          <p className="mb-3 text-sm font-semibold text-text">Wallets</p>
          <WalletPanel onConnectStart={() => onOpenChange(false)} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
