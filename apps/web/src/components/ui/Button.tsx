import { motion, useReducedMotion, type HTMLMotionProps } from 'framer-motion';
import { forwardRef, type MouseEvent } from 'react';

import { cn } from '@/lib/cn';
import { springSnap } from '@/lib/motion';
import { useUiSound } from '@/hooks/useUiSound';

type Variant = 'primary' | 'secondary' | 'ghost' | 'destructive' | 'success';
type Size = 'sm' | 'md' | 'lg';

interface ButtonProps extends Omit<HTMLMotionProps<'button'>, 'children'> {
  variant?: Variant;
  size?: Size;
  children?: React.ReactNode;
}

// WHY: All hex/rgba literals replaced with theme tokens (P1 #23) so that brand
// palette changes propagate automatically. Token definitions live in index.css.
const VARIANT: Record<Variant, string> = {
  primary:
    'bg-[var(--brand-primary)] text-white hover:bg-[var(--brand-primary-hover)] active:bg-[var(--brand-primary-press)] shadow-[var(--shadow-xs)] ' +
    'dark:bg-gradient-to-r dark:from-[var(--brand-gradient-start)] dark:to-[var(--brand-gradient-end)] ' +
    'dark:shadow-[var(--shadow-xs)] dark:hover:shadow-[var(--shadow-sm)]',
  secondary:
    'bg-[var(--surface-card)] text-[var(--fg-primary)] border border-[var(--border-default)] hover:bg-[var(--surface-sunken)] hover:border-[var(--border-strong)] active:bg-[var(--border-subtle)] active:scale-[0.98] ' +
    'dark:bg-[var(--surface-glass)] dark:backdrop-blur-md dark:hover:border-[var(--border-glow-strong)] dark:hover:shadow-[0_0_16px_var(--border-glow)]',
  ghost:
    'bg-transparent text-[var(--fg-secondary)] hover:bg-[var(--surface-sunken)] hover:text-[var(--fg-primary)] active:bg-[var(--border-subtle)] ' +
    'dark:hover:bg-[var(--btn-brand-tint-hover)] dark:hover:text-[var(--brand-primary)] dark:active:bg-[var(--btn-brand-tint-active)]',
  destructive:
    'bg-[var(--danger)] text-white hover:opacity-95 active:opacity-90 active:scale-[0.98] shadow-[var(--shadow-xs)] ' +
    'dark:bg-[var(--danger-tint)] dark:text-[var(--danger)] dark:border dark:border-[var(--btn-danger-border)] ' +
    'dark:hover:bg-[var(--btn-danger-border)] dark:hover:shadow-[0_0_16px_var(--btn-danger-glow)]',
  // WHY: Apple "tinted button" pattern — green tint at rest, floods to solid on hover.
  // Overrides the base focus-visible ring so the keyboard outline matches the
  // success palette rather than brand-primary purple.
  // --btn-success-border resolves to different opacities in light (35%) vs dark (28%)
  // so the single base `border` class handles both modes via the CSS variable.
  success:
    'bg-[var(--success-tint)] text-[var(--success)] border border-[var(--btn-success-border)] ' +
    'hover:bg-[var(--success)] hover:text-white hover:border-transparent active:opacity-90 active:scale-[0.98] shadow-[var(--shadow-xs)] ' +
    'focus-visible:ring-[var(--success)] ' +
    'dark:bg-[var(--success-tint)] dark:text-[var(--success)] ' +
    'dark:hover:bg-[var(--btn-success-glass-hover)] dark:hover:shadow-[0_0_16px_var(--btn-success-glow)]',
};

const SIZE: Record<Size, string> = {
  sm: 'h-8 px-3 text-xs gap-1',
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
  ({ className, variant = 'primary', size = 'md', type = 'button', disabled, onClick, ...rest }, ref) => {
    const reduced = useReducedMotion();
    const playSound = useUiSound();
    // Tactile confirmation: a short click on press (gated by the Sound setting),
    // then the consumer's own handler. Sound is the audible twin of whileTap.
    const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
      playSound('click');
      onClick?.(event);
    };
    return (
      <motion.button
        ref={ref}
        type={type}
        disabled={disabled}
        onClick={handleClick}
        // Spring on tap mirrors UIButton's tactile feel on iOS. Disable when
        // the user has reduced-motion on or the button is disabled.
        whileTap={reduced || disabled ? undefined : { scale: PRESS_SCALE[size] }}
        whileHover={reduced || disabled ? undefined : { translateY: -0.5 }}
        transition={springSnap}
        className={cn(
          // Touch-target floor: visually compact on desktop (32–44px) but
          // expands to the 44×44 Apple HIG / WCAG 2.2 AAA target on coarse
          // pointer devices (touch). Keeps desktop density while staying
          // tappable on phones and tablets.
          'inline-flex items-center justify-center rounded-md dark:rounded-full font-medium transition-colors',
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
