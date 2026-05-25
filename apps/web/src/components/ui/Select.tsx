// Unified select primitive with built-in accessibility and state support.

import { forwardRef, useId, type SelectHTMLAttributes, type ReactNode } from 'react';

import { cn } from '@/lib/cn';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  /** Rendered above the select. */
  label?: ReactNode;
  /** Rendered below the select as helper text. */
  helper?: ReactNode;
  /** Rendered below the select as an error message. Sets aria-invalid. */
  error?: ReactNode;
  /** Shows a loading indicator and sets aria-busy. */
  isLoading?: boolean;
  /** Options when not using children. */
  options?: SelectOption[];
  /** Visual size variant. */
  size?: 'sm' | 'md';
  className?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  (
    { label, helper, error, isLoading, options, size = 'md', className, disabled, children, ...rest },
    ref,
  ) => {
    const generatedId = useId();
    const hasError = Boolean(error);
    const selectId = rest.id ?? generatedId;
    const errorId = hasError ? `${selectId}-error` : undefined;
    const helperId = helper ? `${selectId}-helper` : undefined;
    const describedBy = [errorId, helperId].filter(Boolean).join(' ') || undefined;

    return (
      <div className={cn('flex flex-col gap-1', className)}>
        {label && (
          <label
            htmlFor={selectId}
            className="text-xs font-medium text-[var(--fg-secondary)]"
          >
            {label}
          </label>
        )}
        <div className="relative">
          <select
            ref={ref}
            id={selectId}
            disabled={disabled || isLoading}
            aria-invalid={hasError}
            aria-busy={isLoading}
            aria-describedby={describedBy}
            aria-errormessage={errorId}
            className={cn(
              'w-full appearance-none rounded-lg border bg-[var(--surface-card)] text-[var(--fg-primary)] transition-colors',
              'hover:border-[var(--border-strong)]',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--surface-page)]',
              'disabled:cursor-not-allowed disabled:opacity-60',
              'pointer-coarse:min-h-[44px]',
              size === 'sm' ? 'px-3 py-1 pr-8 text-xs' : 'px-3 py-2 pr-8 text-sm',
              hasError
                ? 'border-[var(--danger)] focus-visible:border-[var(--danger)]'
                : 'border-[var(--border-subtle)] focus-visible:border-[var(--brand-primary)]',
            )}
            {...rest}
          >
            {options
              ? options.map((o) => (
                  <option key={o.value} value={o.value} disabled={o.disabled}>
                    {o.label}
                  </option>
                ))
              : children}
          </select>
          {/* Chevron indicator */}
          <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--fg-tertiary)]">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
              <path d="M2.5 4.5L6 8L9.5 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          {isLoading && (
            <span className="pointer-events-none absolute right-7 top-1/2 -translate-y-1/2">
              <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-[var(--border-default)] border-t-[var(--brand-primary)]" />
            </span>
          )}
        </div>
        {hasError && (
          <p id={errorId} className="text-xs text-[var(--danger)]" role="alert">
            {error}
          </p>
        )}
        {helper && !hasError && (
          <p id={helperId} className="text-xs text-[var(--fg-tertiary)]">
            {helper}
          </p>
        )}
      </div>
    );
  },
);
Select.displayName = 'Select';
