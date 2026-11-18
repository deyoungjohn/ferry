import * as Dialog from '@radix-ui/react-dialog';
import type { ReactNode } from 'react';
import { useGlassLayer } from '../lib/glass-layer';
import { XIcon } from './icons';

export interface GlassModalProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: string;
  readonly description?: string;
  readonly children: ReactNode;
}

export function GlassModal({
  open,
  onOpenChange,
  title,
  description,
  children,
}: GlassModalProps) {
  useGlassLayer(open, title);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay-backdrop overlay-in fixed inset-0 z-50" />
        <Dialog.Content className="glass glass-pop glass-pop-in glass-modal fixed top-1/2 left-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 p-6 outline-none">
          <div className="flex items-center justify-between pb-3 border-b border-hairline">
            <Dialog.Title className="text-base font-semibold text-text">
              {title}
            </Dialog.Title>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Close dialog"
                className="rounded-full p-1.5 text-text-muted transition-colors hover:bg-[var(--hl)] hover:text-text"
              >
                <XIcon className="size-4" />
              </button>
            </Dialog.Close>
          </div>
          {description && (
            <Dialog.Description className="mt-2 text-xs text-text-muted">
              {description}
            </Dialog.Description>
          )}
          <div className="mt-4">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
