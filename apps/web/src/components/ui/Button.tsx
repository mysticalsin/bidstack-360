import { forwardRef, type ButtonHTMLAttributes } from 'react';

import { cn } from '@/lib/cn';

type Variant = 'primary' | 'secondary' | 'ghost' | 'destructive';
type Size = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
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

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', type = 'button', ...rest }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(
        // Touch-target floor: visually compact on desktop (32–44px) but
        // expands to the 44×44 Apple HIG / WCAG 2.2 AAA target on coarse
        // pointer devices (touch). Keeps desktop density while staying
        // tappable on phones and tablets.
        'inline-flex items-center justify-center rounded-md font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 pointer-coarse:min-h-11 pointer-coarse:min-w-11',
        VARIANT[variant],
        SIZE[size],
        className,
      )}
      {...rest}
    />
  ),
);
Button.displayName = 'Button';
