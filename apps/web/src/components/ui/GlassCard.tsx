import { type HTMLAttributes, type ReactNode } from 'react';

import { cn } from '@/lib/cn';

interface GlassCardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  className?: string;
  padding?: 'none' | 'sm' | 'md' | 'lg';
  hoverable?: boolean;
  glow?: 'none' | 'blue' | 'jade' | 'purple' | 'amber' | 'teal' | 'rose';
  /** Accepted so existing call sites can keep their entrance props. Not animated. */
  variants?: unknown;
  initial?: unknown;
  animate?: unknown;
  exit?: unknown;
  transition?: unknown;
  whileHover?: unknown;
  whileTap?: unknown;
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
 * Built on backdrop-filter for the frosted look. The hover lift is CSS so the
 * dashboard does not evaluate framer-motion to paint these cards.
 */
export function GlassCard({
  children,
  className,
  padding = 'md',
  hoverable = true,
  glow = 'none',
  variants: _variants,
  initial: _initial,
  animate: _animate,
  exit: _exit,
  transition: _transition,
  whileHover: _whileHover,
  whileTap: _whileTap,
  ...rest
}: GlassCardProps) {
  return (
    <div
      className={cn(
        'glass-card',
        paddingMap[padding],
        glowMap[glow],
        hoverable && 'transition-transform hover:-translate-y-0.5',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}
