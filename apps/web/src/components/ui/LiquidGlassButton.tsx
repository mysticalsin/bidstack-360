import type { ComponentPropsWithoutRef, ElementType, ReactNode } from 'react';

import { cn } from '@/lib/cn';

type LiquidTone = 'primary' | 'secondary' | 'success' | 'danger' | 'gold';
type LiquidSize = 'sm' | 'md' | 'lg';

type LiquidGlassButtonProps<T extends ElementType> = {
  as?: T;
  tone?: LiquidTone;
  size?: LiquidSize;
  children: ReactNode;
  className?: string;
} & Omit<ComponentPropsWithoutRef<T>, 'as' | 'children' | 'className'>;

export function LiquidGlassButton<T extends ElementType = 'button'>({
  as,
  tone = 'primary',
  size = 'md',
  children,
  className,
  ...rest
}: LiquidGlassButtonProps<T>) {
  const Component = (as ?? 'button') as ElementType;
  const defaultButtonProps = Component === 'button' ? { type: 'button' as const } : {};

  return (
    <Component
      className={cn(
        'liquid-glass-button',
        `liquid-glass-button-${tone}`,
        `liquid-glass-button-${size}`,
        className,
      )}
      {...defaultButtonProps}
      {...rest}
    >
      <span className="liquid-glass-button__shine" aria-hidden />
      <span className="liquid-glass-button__label">{children}</span>
    </Component>
  );
}

type MetalButtonProps = ComponentPropsWithoutRef<'button'> & {
  tone?: Exclude<LiquidTone, 'secondary'>;
};

export function MetalButton({
  tone = 'primary',
  className,
  children,
  type = 'button',
  ...rest
}: MetalButtonProps) {
  return (
    <button
      type={type}
      className={cn('metal-button', `metal-button-${tone}`, className)}
      {...rest}
    >
      <span className="metal-button__surface" aria-hidden />
      <span className="metal-button__label">{children}</span>
    </button>
  );
}
