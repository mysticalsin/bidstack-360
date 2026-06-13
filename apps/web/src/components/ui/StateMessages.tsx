import { motion, useReducedMotion } from 'framer-motion';
import type { ReactNode } from 'react';

import { Icon } from '@/components/ui/Icon';
import { springSoft, staggerChild, staggerParent } from '@/lib/motion';

interface BaseProps {
  title: string;
  message?: string;
  action?: ReactNode;
}

export function EmptyState({ title, message, action }: BaseProps) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
      animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0 }}
      transition={springSoft}
      className="flex flex-col items-center justify-center py-16 text-center"
    >
      <motion.div
        // Subtle continuous float on the glyph — same idea as the iOS empty
        // state spinner that drifts so the user knows the page isn't frozen.
        animate={reduced ? undefined : { y: [0, -4, 0] }}
        transition={reduced ? undefined : { duration: 3.2, repeat: Infinity, ease: 'easeInOut' }}
        className="mb-3 text-[var(--fg-tertiary)]"
        aria-hidden
      >
        <Icon name="sparkle" size={28} />
      </motion.div>
      <h2 className="text-sm font-semibold text-[var(--fg-primary)]">{title}</h2>
      {message ? (
        <p className="mt-1 max-w-sm text-xs text-[var(--fg-secondary)]">{message}</p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </motion.div>
  );
}

export function ErrorState({ title, message, action }: BaseProps) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      role="alert"
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
      animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0 }}
      transition={springSoft}
      className="flex flex-col items-center justify-center py-16 text-center"
    >
      <div className="mb-3 text-[var(--danger)]" aria-hidden>
        <Icon name="warning" size={28} />
      </div>
      <h2 className="text-sm font-semibold text-[var(--danger)]">{title}</h2>
      {message ? (
        <p className="mt-1 max-w-sm text-xs text-[var(--fg-secondary)]">{message}</p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </motion.div>
  );
}

export function LoadingSkeleton({ rows = 4 }: { rows?: number }) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      variants={reduced ? undefined : staggerParent}
      initial="initial"
      animate="animate"
      className="space-y-2 p-4"
      aria-busy="true"
      aria-live="polite"
    >
      {Array.from({ length: rows }).map((_, i) => (
        <motion.div
          key={i}
          variants={reduced ? undefined : staggerChild}
          className="bs-shimmer h-12"
        />
      ))}
    </motion.div>
  );
}
