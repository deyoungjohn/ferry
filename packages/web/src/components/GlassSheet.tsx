import { Drawer } from 'vaul';
import type { ReactNode } from 'react';
import { useGlassLens } from '../lib/glass';
import { useGlassLayer } from '../lib/glass-layer';

export interface GlassSheetProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: string;
  readonly children: ReactNode;
}

export function GlassSheet({
  open,
  onOpenChange,
  title,
  children,
}: GlassSheetProps) {
  const lensed = useGlassLens();

  useGlassLayer(open, title);

  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange}>
      <Drawer.Portal>
        <Drawer.Overlay className="glass-scrim fixed inset-0 z-50 backdrop-blur-xs" />
        <Drawer.Content
          className={`glass glass-sheet fixed right-0 bottom-0 left-0 z-50 max-h-[85vh] p-6 outline-none ${
            lensed ? 'glass--lensed' : ''
          }`}
        >
          <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-surface-3" />
          <Drawer.Title className="text-base font-semibold text-text">
            {title}
          </Drawer.Title>
          <div className="mt-4 overflow-y-auto">{children}</div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
