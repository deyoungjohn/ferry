import * as Popover from '@radix-ui/react-popover';
import type { ReactNode } from 'react';
import { useGlassLayer } from '../lib/glass-layer';
import { useState } from 'react';

export interface GlassPopoverProps {
  readonly trigger: ReactNode;
  readonly children: ReactNode;
  readonly label?: string;
}

export function GlassPopover({ trigger, children, label }: GlassPopoverProps) {
  const [open, setOpen] = useState(false);

  useGlassLayer(open, label ?? 'popover');

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>{trigger}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          sideOffset={8}
          className="glass glass-pop glass-pop--dark glass-popover z-50 max-w-xs p-3 text-xs leading-5 text-text outline-none"
        >
          {children}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
