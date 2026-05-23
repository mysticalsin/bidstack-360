import { type ReactNode } from 'react';
import { motion, type HTMLMotionProps } from 'framer-motion';

import { cn } from '@/lib/cn';
import { useReducedMotion } from '@/hooks/useReducedMotion';

interface GlassCardProps extends Omit<HTMLMotionProps<'div'>, 'children'> {
  children: ReactNode;
  className?: string;
  padding?: 'none' | 'sm' | 'md' | 'lg';
  hoverable?: boolean;
  glow?: 'none' | 'blue' | 'jade' | 'purple' | 'amber' | 'teal' | 'rose';
}

const paddingMap = {
  none: '',
  sm: 'p-3',
  md: 'p-4',
  lg: 'p-6',
} as const;

const glowMap = {
  none: '',
  blue: 'glass-glow-blue',
  jade: 'glass-glow-jade',
  purple: 'glass-glow-purple',
  amber: 'glass-glow-amber',
  teal: 'glass-glow-teal',
  rose: 'glass-glow-rose',
} as const;

/**
 * GlassCard — Frosted glass card with optional colored glow.
 * Built on backdrop-filter for the frosted look.
 */
export function GlassCard({
  children,
  className,
  padding = 'md',
  hoverable = true,
  glow = 'none',
  ...motionProps
}: GlassCardProps) {
  const reduced = useReducedMotion();

  return (
    <motion.div
      className={cn('glass-card dark:card-shimmer', paddingMap[padding], glowMap[glow], className)}
      whileHover={
        hoverable && !reduced
          ? { y: -3, transition: { type: 'spring', stiffness: 400, damping: 25 } }
          : undefined
      }
      {...motionProps}
    >
      {children}
    </motion.div>
  );
}
