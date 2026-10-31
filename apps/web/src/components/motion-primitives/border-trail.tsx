// Vendored from motion-primitives (ibelick, MIT) — components/core/border-trail.tsx
// https://github.com/ibelick/motion-primitives @120f64f. See THIRD_PARTY_NOTICES.md.
// Polo changes: Polo brand token instead of zinc, aria-hidden, and it renders
// nothing under prefers-reduced-motion (a looping trail is pure decoration).
import { motion, type Transition, useReducedMotion } from 'motion/react';

import { cn } from '@/lib/utils';

export type BorderTrailProps = {
  className?: string;
  size?: number;
  transition?: Transition;
  style?: React.CSSProperties;
};

export function BorderTrail({ className, size = 60, transition, style }: BorderTrailProps) {
  const reduced = useReducedMotion();
  if (reduced) return null;
  const defaultTransition: Transition = { repeat: Infinity, duration: 5, ease: 'linear' };
  return (
    <div
      aria-hidden="true"
      data-testid="border-trail"
      style={{ borderRadius: 'inherit' }}
      className="pointer-events-none absolute inset-0 border border-transparent [mask-clip:padding-box,border-box] [mask-composite:intersect] [mask-image:linear-gradient(transparent,transparent),linear-gradient(#000,#000)]"
    >
      <motion.div
        className={cn('absolute aspect-square bg-[var(--brand-primary)]', className)}
        style={{ width: size, offsetPath: `rect(0 auto auto 0 round ${size}px)`, ...style }}
        animate={{ offsetDistance: ['0%', '100%'] }}
        transition={transition ?? defaultTransition}
      />
    </div>
  );
}
