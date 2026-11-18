/** Easing and spring presets used by the swap block. */
export const EASE_OUT = [0.22, 1, 0.36, 1] as const;
export const EASE_DRAWER = [0.32, 0.72, 0, 1] as const;
export const SPRING_PRESS = {
  type: 'spring',
  stiffness: 500,
  damping: 30,
} as const;
export const SPRING_PANEL = {
  type: 'spring',
  stiffness: 380,
  damping: 34,
  mass: 0.8,
} as const;
