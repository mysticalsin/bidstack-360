import { motion, useReducedMotion, type HTMLMotionProps } from 'framer-motion';
import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';

import { cn } from '@/lib/cn';
import { springSnap } from '@/lib/motion';

// WHY: geometry and material are theme-invariant (ADR 0002). Dark mode changes
// colour only, through the token values (--surface-card, --shadow-xs, borders),
// never radius, blur, or glow.
const CARD_BASE =
  'rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-card)] shadow-[var(--shadow-xs)]';

/** Static, non-interactive card. Use for content blocks the user reads. */
export function Card({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn(CARD_BASE, className)} {...rest}>
      {children}
    </div>
  );
}

/** Interactive card — adds a spring hover-lift and a slightly stronger
 *  shadow on hover, like the macOS Stocks/Notes preview tiles. Use for the
 *  Accounts grid and any clickable card. */
type InteractiveCardProps = Omit<HTMLMotionProps<'div'>, 'children'> & {
  children?: ReactNode;
  /** When the card is wrapped in a Link/button parent, set to false to skip
   *  the focus ring on the card itself (the parent handles focus). */
  showFocusRing?: boolean;
};

export const InteractiveCard = forwardRef<HTMLDivElement, InteractiveCardProps>(
  ({ className, children, showFocusRing = true, ...rest }, ref) => {
    const reduced = useReducedMotion();
    return (
      <motion.div
        ref={ref}
        whileHover={reduced ? undefined : { y: -3 }}
        whileTap={reduced ? undefined : { y: -1, scale: 0.997 }}
        transition={springSnap}
        className={cn(
          CARD_BASE,
          'cursor-pointer transition-colors hover:border-[var(--border-default)] hover:shadow-[var(--shadow-sm)] dark:hover:border-[var(--border-glow-strong)]',
          showFocusRing &&
            'focus-within:ring-2 focus-within:ring-[var(--brand-primary)] focus-within:ring-offset-2 focus-within:ring-offset-[var(--surface-page)]',
          className,
        )}
        {...rest}
      >
        {children}
      </motion.div>
    );
  },
);
InteractiveCard.displayName = 'InteractiveCard';

interface SectionHeaderProps {
  title: string;
  caption?: string;
  action?: ReactNode;
}

export function SectionHeader({ title, caption, action }: SectionHeaderProps) {
  return (
    <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-[var(--border-subtle)]">
      <div>
        <h2 className="text-sm font-semibold text-[var(--fg-primary)]">{title}</h2>
        {caption ? <p className="mt-0.5 text-xs text-[var(--fg-tertiary)]">{caption}</p> : null}
      </div>
      {action}
    </div>
  );
}
