import { ArrowDownUp } from 'lucide-react';
import { motion } from 'motion/react';
import { useMessages } from '../../lib/i18n';
import { type SwapMessages, swapMessages } from './messages';

export function FlipButton({
  rotation,
  reduce,
  onClick,
  labels,
}: {
  rotation: number;
  reduce: boolean;
  onClick: () => void;
  labels?: Partial<SwapMessages>;
}) {
  const t = useMessages('swap', swapMessages, labels);
  const motionProps = reduce
    ? {}
    : { whileTap: { scale: 0.9 }, animate: { rotate: rotation } };
  return (
    <div className="relative -my-4 flex justify-center" style={{ zIndex: 1 }}>
      <motion.button
        type="button"
        onClick={onClick}
        aria-label="Toggle swap direction"
        title={t('reverse')}
        {...motionProps}
        transition={{ type: 'spring', stiffness: 380, damping: 26, mass: 0.6 }}
        className="inline-flex h-9 w-9 items-center justify-center rounded-full border-[3px] border-card bg-muted text-foreground backdrop-blur motion-reduce:transform-none"
      >
        <ArrowDownUp className="h-3.5 w-3.5" />
      </motion.button>
    </div>
  );
}
