// Scroll-driven reveal. Shows content with a fade+rise as it enters the
// viewport — fires exactly once per mount so the user doesn't get re-animated
// content when scrolling back up. Modeled after Apple's "fade in" used on
// product marketing pages and the macOS Settings app's section reveals.

import { motion, useInView, useReducedMotion } from 'framer-motion';
import { useRef, type ReactNode } from 'react';

import { springSoft } from '@/lib/motion';

interface Props {
  children: ReactNode;
  /** Pixel distance to rise from on enter. */
  rise?: number;
  /** Render delay (seconds) for staggered manual sequencing. */
  delay?: number;
  /** Viewport margin — negative values trigger before the element is fully in.
   *  Apple typically uses `-10%` so the animation kicks off slightly early.
   *  Must use the `MarginType` shape framer-motion expects (string of CSS
   *  margin values, no commas — single-axis margins like `'-10% 0px'`). */
  rootMargin?: `${number}${'px' | '%'}` | `${number}${'px' | '%'} ${number}${'px' | '%'}`;
  className?: string;
}

export function Reveal({
  children,
  rise = 12,
  delay = 0,
  rootMargin = '-10% 0px',
  className,
}: Props) {
  const reduced = useReducedMotion();
  const ref = useRef<HTMLDivElement | null>(null);
  // `once: true` — important: we don't want sections to re-animate on scroll
  // back. Apple's behavior matches this; subsequent scrolls show static
  // content.
  const inView = useInView(ref, { once: true, margin: rootMargin });

  return (
    <motion.div
      ref={ref}
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: rise }}
      animate={inView ? (reduced ? { opacity: 1 } : { opacity: 1, y: 0 }) : undefined}
      transition={{ ...springSoft, delay }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
