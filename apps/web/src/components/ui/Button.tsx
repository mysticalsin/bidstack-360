import { motion, useReducedMotion, type HTMLMotionProps } from 'framer-motion';
import { forwardRef } from 'react';

import { cn } from '@/lib/cn';
import { springSnap } from '@/lib/motion';

type Variant = 'primary' | 'secondary' | 'ghost' | 'destructive';
type Size = 'sm' | 'md' | 'lg';

interface ButtonProps extends Omit<HTMLMotionProps<'button'>, 'children'> {
  variant?: Variant;
  size?: Size;
  children?: React.ReactNode;
}

const VARIANT: Record<Variant, string> = {
  primary:
    'bg-[var(--brand-primary)] text-white hover:bg-[var(--brand-primary-hover)] active:bg-[var(--brand-primary-press)] shadow-[var(--shadow-xs)]',
  secondary:
    'bg-[var(--surface-card)] text-[var(--fg-primary)] border border-[var(--border-default)] hover:bg-[var(--surface-sunken)] hover:border-[var(--border-strong)]',
  ghost:
    'bg-transparent text-[var(--fg-secondary)] hover:bg-[var(--surface-sunken)] hover:text-[var(--fg-primary)]',
  destructive: 'bg-[var(--danger)] text-white hover:opacity-95 shadow-[var(--shadow-xs)]',
};

const SIZE: Record<Size, string> = {
  sm: 'h-8 px-3 text-xs gap-1.5',
  md: 'h-9 px-4 text-sm gap-2',
  lg: 'h-11 px-5 text-sm gap-2',
};

// Apple-style press feedback: subtle scale-down on active, snap back on
// release. Different scales by size so a small chip doesn't visibly shrink
// to nothing.
const PRESS_SCALE: Record<Size, number> = {
  sm: 0.96,
  md: 0.97,
  lg: 0.98,
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', type = 'button', disabled, ...rest }, ref) => {
    const reduced = useReducedMotion();
    return (
      <motion.button
        ref={ref}
        type={type}
        disabled={disabled}
        // Spring on tap mirrors UIButton's tactile feel on iOS. Disable when
        // the user has reduced-motion on or the button is disabled.
        whileTap={reduced || disabled ? undefined : { scale: PRESS_SCALE[size] }}
        whileHover={reduced || disabled ? undefined : { y: -0.5 }}
        transition={springSnap}
        className={cn(
          // Touch-target floor: visually compact on desktop (32–44px) but
          // expands to the 44×44 Apple HIG / WCAG 2.2 AAA target on coarse
          // pointer devices (touch). Keeps desktop density while staying
          // tappable on phones and tablets.
          'inline-flex items-center justify-center rounded-md font-medium transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-page)]',
          'disabled:cursor-not-allowed disabled:opacity-60',
          'pointer-coarse:min-h-11 pointer-coarse:min-w-11',
          VARIANT[variant],
          SIZE[size],
          className,
        )}
        {...rest}
      />
    );
  },
);
Button.displayName = 'Button';
