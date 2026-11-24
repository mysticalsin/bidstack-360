import { motion, useReducedMotion } from 'framer-motion';
import { useEffect, useState, type ReactNode } from 'react';

import { easeStandard, springSmooth } from '@/lib/motion';

export function MotionPageTransition({
  children,
  pageKey,
}: {
  children: ReactNode;
  pageKey?: string;
}) {
  const reduced = useReducedMotion();
  // The fallback already painted these children. The first commit must not
  // hide them or Lighthouse moves LCP to the fade-in.
  const [live, setLive] = useState(false);
  useEffect(() => setLive(true), []);
  const hidden = reduced ? { opacity: 0 } : { opacity: 0, y: 8 };

  return (
    <motion.div
      key={pageKey}
      initial={live ? hidden : false}
      animate={{ opacity: 1, y: 0 }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, y: -4 }}
      transition={reduced ? easeStandard : springSmooth}
      style={{ willChange: 'transform, opacity' }}
    >
      {children}
    </motion.div>
  );
}
