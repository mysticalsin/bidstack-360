import { motion, useReducedMotion } from 'framer-motion';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { Icon, type IconName } from '@/components/ui/Icon';
import { springSoft, staggerChild, staggerParent } from '@/lib/motion';

interface BaseProps {
  title: string;
  message?: string;
  action?: ReactNode;
}

interface EmptyStateProps extends BaseProps {
  /**
   * Entity-specific glyph. When set, the glyph renders inside a tinted chip
   * (same treatment as the dashboard GettingStarted cards) so each list's
   * zero-state reads as its own moment instead of the interchangeable
   * sparkle. Omit it and the legacy floating sparkle stays — the ~70
   * existing consumers keep rendering pixel-identical.
   */
  icon?: IconName;
  /** Low-emphasis follow-up under the primary CTA (e.g. a CSV-import link). */
  secondary?: ReactNode;
}

export function EmptyState({ title, message, action, icon, secondary }: EmptyStateProps) {
  const reduced = useReducedMotion();
  const bespoke = icon != null;
  return (
    <motion.div
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
      animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0 }}
      transition={springSoft}
      data-empty-icon={icon ?? 'sparkle'}
      className="flex flex-col items-center justify-center py-16 text-center"
    >
      <motion.div
        // Subtle continuous float on the glyph — same idea as the iOS empty
        // state spinner that drifts so the user knows the page isn't frozen.
        animate={reduced ? undefined : { y: [0, -4, 0] }}
        transition={reduced ? undefined : { duration: 3.2, repeat: Infinity, ease: 'easeInOut' }}
        className={
          bespoke
            ? 'mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--surface-sunken)] text-[var(--brand-primary)]'
            : 'mb-3 text-[var(--fg-tertiary)]'
        }
        aria-hidden
      >
        <Icon name={icon ?? 'sparkle'} size={bespoke ? 22 : 28} />
      </motion.div>
      <h2 className="text-sm font-semibold text-[var(--fg-primary)]">{title}</h2>
      {message ? (
        <p className="mt-1 max-w-sm text-xs text-[var(--fg-secondary)]">{message}</p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
      {secondary ? <div className="mt-1 flex items-center justify-center">{secondary}</div> : null}
    </motion.div>
  );
}

/**
 * Shared secondary link for EmptyState — one visual rhythm across every
 * list's zero-state (brand-tinted text link, 44px touch target, visible
 * focus ring) while each page supplies its own destination and copy.
 */
export function EmptyStateLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      className="inline-flex min-h-[44px] items-center gap-1 rounded-md px-2 text-xs font-medium text-[var(--brand-primary)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]"
    >
      {children}
      <Icon name="chevron-right" size={14} ariaHidden />
    </Link>
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
