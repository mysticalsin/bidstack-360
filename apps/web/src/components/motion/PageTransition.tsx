// Wraps page content with an Apple-style fade+slight-rise transition.
// Sits inside the route element so each route swap animates independently.
// Respects prefers-reduced-motion by short-circuiting to opacity-only.

import { motion, useReducedMotion } from 'framer-motion';
import type { ReactNode } from 'react';

import { easeStandard, springSmooth } from '@/lib/motion';

interface Props {
  children: ReactNode;
  /** Stable key to drive AnimatePresence re-mounting (e.g. route path). */
  pageKey?: string;
}

export function PageTransition({ children, pageKey }: Props) {
  const reduced = useReducedMotion();

  return (
    <motion.div
      key={pageKey}
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
      animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0 }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, y: -4 }}
      transition={reduced ? easeStandard : springSmooth}
      style={{ willChange: 'transform, opacity' }}
    >
      {children}
    </motion.div>
  );
}
