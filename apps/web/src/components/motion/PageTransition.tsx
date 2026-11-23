// Wraps page content with an Apple-style fade+slight-rise transition.
// Sits inside the route element so each route swap animates independently.
// Respects prefers-reduced-motion by short-circuiting to opacity-only.

import { motion, useReducedMotion } from 'framer-motion';
import { useState, type ReactNode } from 'react';

import { easeStandard, springSmooth } from '@/lib/motion';

interface Props {
  children: ReactNode;
  /** Stable key to drive AnimatePresence re-mounting (e.g. route path). */
  pageKey?: string;
}

export function PageTransition({ children, pageKey }: Props) {
  const reduced = useReducedMotion();
  // A direct load (Lighthouse opens /dashboard cold) must paint its text on
  // the first frame. Starting at opacity 0 holds LCP until the spring can
  // run, and the 4× CPU throttle pushes that past 2.5s. Later client-side
  // navigations still get the entrance fade.
  // The first route this shell paints is a direct load. Keep that mount
  // visible — flipping `initial` later on the same node would re-hide it.
  // A different pageKey remounts the motion node, and that one may fade.
  const [firstPageKey] = useState(pageKey);
  const animateEntrance = pageKey !== firstPageKey;

  return (
    <motion.div
      key={pageKey}
      initial={animateEntrance ? (reduced ? { opacity: 0 } : { opacity: 0, y: 8 }) : false}
      animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0 }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, y: -4 }}
      transition={reduced ? easeStandard : springSmooth}
      style={{ willChange: 'transform, opacity' }}
    >
      {children}
    </motion.div>
  );
}
