// Vendored from motion-primitives (ibelick, MIT) — components/core/transition-panel.tsx
// https://github.com/ibelick/motion-primitives @120f64f. See THIRD_PARTY_NOTICES.md.
// Polo changes: a reduced-motion snap (opacity only, no slide), default Polo
// easing (cubic-bezier(0.22,1,0.36,1), 200ms) and a 6px rise instead of a slide.
import { AnimatePresence, motion, useReducedMotion, type MotionProps, type Transition, type Variant } from 'motion/react';

import { cn } from '@/lib/utils';

export type TransitionPanelProps = {
  children: React.ReactNode[];
  className?: string;
  transition?: Transition;
  activeIndex: number;
  variants?: { enter: Variant; center: Variant; exit: Variant };
} & MotionProps;

const POLO_VARIANTS = {
  enter: { opacity: 0, y: 6 },
  center: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -6 },
};
const FADE = { enter: { opacity: 0 }, center: { opacity: 1 }, exit: { opacity: 0 } };

export function TransitionPanel({ children, className, transition, variants, activeIndex, ...motionProps }: TransitionPanelProps) {
  const reduced = useReducedMotion();
  return (
    <div className={cn('relative', className)}>
      <AnimatePresence initial={false} mode="popLayout" custom={motionProps.custom}>
        <motion.div
          key={activeIndex}
          variants={reduced ? FADE : (variants ?? POLO_VARIANTS)}
          transition={reduced ? { duration: 0 } : (transition ?? { duration: 0.2, ease: [0.22, 1, 0.36, 1] })}
          initial="enter"
          animate="center"
          exit="exit"
          {...motionProps}
        >
          {children[activeIndex]}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
