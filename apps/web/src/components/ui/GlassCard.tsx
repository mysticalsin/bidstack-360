import { type ReactNode } from 'react';
import { motion, type HTMLMotionProps } from 'framer-motion';

import { cn } from '@/lib/cn';
import { useReducedMotion } from '@/hooks/useReducedMotion';

interface GlassCardProps extends Omit<HTMLMotionProps<'div'>, 'children'> {
  children: ReactNode;
  className?: string;
  padding?: 'none' | 'sm' | 'md' | 'lg';
  hoverable?: boolean;
}

const paddingMap = {
  none: '',
  sm: 'p-3',
  md: 'p-4',
  lg: 'p-6',
} as const;

/**
 * GlassCard — Frosted glass card. Built on backdrop-filter for the frosted look.
 * Uses `will-change: transform` only during hover to avoid permanent compositor layer cost.
 */
export function GlassCard({
  children,
  className,
  padding = 'md',
  hoverable = true,
  ...motionProps
}: GlassCardProps) {
  const reduced = useReducedMotion();

  return (
    <motion.div
      className={cn('glass-card', paddingMap[padding], className)}
      whileHover={
        hoverable && !reduced
          ? { y: -2, transition: { type: 'spring', stiffness: 400, damping: 25 } }
          : undefined
      }
      {...motionProps}
    >
      {children}
    </motion.div>
  );
}
