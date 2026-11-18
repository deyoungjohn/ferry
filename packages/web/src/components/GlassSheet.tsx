import { Drawer } from 'vaul';
import type { ReactNode } from 'react';
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
  useGlassLayer(open, title);

  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange}>
      <Drawer.Portal>
        <Drawer.Overlay className="overlay-backdrop fixed inset-0 z-50" />
        <Drawer.Content className="glass glass-pop glass-sheet fixed right-0 bottom-0 left-0 z-50 mx-auto max-h-[85vh] max-w-2xl p-6 pb-[max(24px,env(safe-area-inset-bottom))] outline-none">
          <div className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-white/25" />
          <Drawer.Title className="text-base font-semibold text-text">
            {title}
          </Drawer.Title>
          <div className="mt-4 overflow-y-auto">{children}</div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
