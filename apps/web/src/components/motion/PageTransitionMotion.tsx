import { motion, useReducedMotion } from 'framer-motion';
import type { ReactNode } from 'react';

import { easeStandard, springSmooth } from '@/lib/motion';

export function MotionPageTransition({
  children,
  pageKey,
}: {
  children: ReactNode;
  pageKey?: string;
}) {
  const reduced = useReducedMotion();

  return (
    <motion.div
      key={pageKey}
      // The fallback already painted this page. Starting at opacity 0 would
      // remount the largest element and move Lighthouse's LCP.
      initial={false}
      animate={{ opacity: 1, y: 0 }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, y: -4 }}
      transition={reduced ? easeStandard : springSmooth}
      style={{ willChange: 'transform, opacity' }}
    >
      {children}
    </motion.div>
  );
}
