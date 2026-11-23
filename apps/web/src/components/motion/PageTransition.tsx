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
  /**
   * Paint at full opacity on the first frame. The dashboard lead is the
   * Largest Contentful Paint element; an opacity-0 entrance kept it out of
   * the LCP candidate set until the lazy widget graph had already painted a
   * larger line.
   */
  visibleOnMount?: boolean;
}

export function PageTransition({ children, pageKey, visibleOnMount = false }: Props) {
  const reduced = useReducedMotion();
  const hidden = visibleOnMount ? false : reduced ? { opacity: 0 } : { opacity: 0, y: 8 };

  return (
    <motion.div
      key={pageKey}
      initial={hidden}
      animate={{ opacity: 1, y: 0 }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, y: -4 }}
      transition={reduced ? easeStandard : springSmooth}
      style={{ willChange: 'transform, opacity' }}
    >
      {children}
    </motion.div>
  );
}
