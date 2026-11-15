import * as Popover from '@radix-ui/react-popover';
import type { ReactNode } from 'react';
import { useGlassLens } from '../lib/glass';
import { useGlassLayer } from '../lib/glass-layer';
import { useState } from 'react';

export interface GlassPopoverProps {
  readonly trigger: ReactNode;
  readonly children: ReactNode;
  readonly label?: string;
}

export function GlassPopover({ trigger, children, label }: GlassPopoverProps) {
  const [open, setOpen] = useState(false);
  const lensed = useGlassLens();

  useGlassLayer(open, label ?? 'popover');

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>{trigger}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          sideOffset={8}
          className={`glass glass-popover z-50 max-w-xs p-3 text-xs leading-5 text-text-muted outline-none shadow-xl ${
            lensed ? 'glass--lensed' : ''
          }`}
        >
          {children}
          <Popover.Arrow className="fill-surface-2" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
