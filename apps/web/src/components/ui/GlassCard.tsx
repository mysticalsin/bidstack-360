import { type ReactNode, useRef, useCallback } from 'react';
import { motion, type HTMLMotionProps } from 'framer-motion';

import { cn } from '@/lib/cn';
import { useReducedMotion } from '@/hooks/useReducedMotion';

interface GlassCardProps extends Omit<HTMLMotionProps<'div'>, 'children'> {
  children: ReactNode;
  /** Enables the cursor-following border gradient glow effect */
  spotlight?: boolean;
  /** Additional classNames */
  className?: string;
  /** Padding variant */
  padding?: 'none' | 'sm' | 'md' | 'lg';
  /** Enables subtle hover lift */
  hoverable?: boolean;
}

const paddingMap = {
  none: '',
  sm: 'p-3',
  md: 'p-4',
  lg: 'p-6',
} as const;

/**
 * GlassCard — Frosted glass card with optional cursor-following gradient
 * border glow. Built on backdrop-filter for the frosted look and a CSS
 * custom property spotlight for the animated border gradient.
 *
 * Uses `will-change: transform` only during hover to avoid permanent
 * compositor layer cost.
 */
export function GlassCard({
  children,
  spotlight = false,
  className,
  padding = 'md',
  hoverable = true,
  ...motionProps
}: GlassCardProps) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const reduced = useReducedMotion();

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!spotlight || reduced) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      e.currentTarget.style.setProperty('--glow-x', `${x}px`);
      e.currentTarget.style.setProperty('--glow-y', `${y}px`);
      e.currentTarget.style.setProperty('--glow-opacity', '1');
    },
    [spotlight, reduced],
  );

  const handleMouseLeave = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!spotlight) return;
      e.currentTarget.style.setProperty('--glow-opacity', '0');
    },
    [spotlight],
  );

  return (
    <motion.div
      ref={cardRef}
      className={cn(
        'glass-card',
        paddingMap[padding],
        spotlight && 'glass-card--spotlight',
        className,
      )}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      whileHover={
        hoverable && !reduced
          ? { y: -2, transition: { type: 'spring', stiffness: 400, damping: 25 } }
          : undefined
      }
      {...motionProps}
    >
      {spotlight && <div className="glass-card__glow" aria-hidden="true" />}
      {children}
    </motion.div>
  );
}
