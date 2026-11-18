import type { ReactNode } from 'react';
import { useScrolled } from '../lib/useScrolled';
import { useGlassLayer } from '../lib/glass-layer';

export interface GlassNavProps {
  readonly children: ReactNode;
}

export function GlassNav({ children }: GlassNavProps) {
  const scrolled = useScrolled(24);

  useGlassLayer(scrolled, 'nav');

  const classes = [
    'top-0 z-40 w-full transition-[background-color,backdrop-filter,border-color] duration-200',
    scrolled
      ? 'glass-nav site-bar glass-pop--dark'
      : 'border-b border-transparent bg-transparent',
  ]
    .filter(Boolean)
    .join(' ');

  return <header className={classes}>{children}</header>;
}
