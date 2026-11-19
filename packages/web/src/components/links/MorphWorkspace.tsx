import type { ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';

export interface MorphWorkspaceProps {
  /** The creation form. Centered and larger until there is a result. */
  readonly form: ReactNode;
  /** The result of creating (QR and link). Null until something was created. */
  readonly result: ReactNode | null;
  /** The table of links, below both blocks and as wide as them together. */
  readonly table: ReactNode;
}

const SPRING = {
  type: 'spring',
  stiffness: 260,
  damping: 32,
  mass: 0.9,
} as const;

/**
 * First the form stands alone, centered and larger. When something is created, the form moves to
 * the left and the result slides in from the right; the table sits below, across both.
 */
export function MorphWorkspace({ form, result, table }: MorphWorkspaceProps) {
  const reduce = useReducedMotion();
  const hasResult = result !== null;
  const transition = reduce ? { duration: 0 } : SPRING;
  return (
    <div
      className="flex flex-col gap-6"
      data-testid="morph-workspace"
      data-has-result={hasResult}
    >
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <motion.div
          layout
          transition={transition}
          data-testid="morph-form"
          className={
            // Above the result while it moves, so the result is uncovered as the form leaves.
            hasResult
              ? 'relative z-10 lg:col-span-1'
              : 'relative z-10 lg:col-span-2 lg:mx-auto lg:w-full lg:max-w-xl'
          }
        >
          {form}
        </motion.div>
        <AnimatePresence initial={false}>
          {hasResult && (
            <motion.div
              key="result"
              data-testid="morph-result"
              initial={reduce ? false : { opacity: 0, x: 96 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: reduce ? 0 : 96 }}
              transition={reduce ? transition : { ...SPRING, delay: 0.12 }}
              className="relative z-0 lg:col-span-1"
            >
              {result}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <motion.div layout="position" transition={transition}>
        {table}
      </motion.div>
    </div>
  );
}
