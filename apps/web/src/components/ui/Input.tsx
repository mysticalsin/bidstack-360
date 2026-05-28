// Unified text input primitive with built-in accessibility and state support.
// Pairs with FormField for label + error + helper composition, or use
// standalone with aria-label.

import { Check } from 'lucide-react';
import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from 'react';

import { cn } from '@/lib/cn';

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  /** Rendered above the input. */
  label?: ReactNode;
  /** Rendered below the input as helper text. */
  helper?: ReactNode;
  /** Rendered below the input as an error message. Sets aria-invalid. */
  error?: ReactNode;
  /** Shows a loading indicator and sets aria-busy. */
  isLoading?: boolean;
  /**
   * Marks the field as successfully validated.
   * WHY: gives users positive confirmation immediately after they satisfy a
   * constraint — reduces form anxiety. Error takes priority if both are set.
   */
  valid?: boolean;
  /** Visual size variant. */
  size?: 'sm' | 'md';
  /** Full width by default; pass w-auto to shrink. */
  className?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  (
    { label, helper, error, isLoading, valid, size = 'md', className, disabled, readOnly, ...rest },
    ref,
  ) => {
    const generatedId = useId();
    const hasError = Boolean(error);
    // Error takes priority over valid so mis-filled fields can't appear green.
    const hasValid = Boolean(valid) && !hasError;
    const inputId = rest.id ?? generatedId;
    const errorId = hasError ? `${inputId}-error` : undefined;
    const helperId = helper ? `${inputId}-helper` : undefined;
    const describedBy = [errorId, helperId].filter(Boolean).join(' ') || undefined;

    return (
      <div className={cn('flex flex-col gap-1', className)}>
        {label && (
          <label htmlFor={inputId} className="text-xs font-medium text-[var(--fg-secondary)]">
            {label}
          </label>
        )}
        <div className="relative">
          <input
            ref={ref}
            id={inputId}
            disabled={disabled || isLoading}
            readOnly={readOnly}
            aria-invalid={hasError}
            aria-busy={isLoading}
            aria-describedby={describedBy}
            aria-errormessage={errorId}
            className={cn(
              'w-full rounded-lg dark:rounded-xl border bg-[var(--surface-card)] text-[var(--fg-primary)] transition-colors',
              'placeholder:text-[var(--fg-tertiary)]',
              'hover:border-[var(--border-strong)] dark:hover:border-[var(--border-glow-strong)]',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--surface-page)] dark:focus-visible:shadow-[0_0_12px_rgba(168,85,247,0.15)]',
              'disabled:cursor-not-allowed disabled:opacity-60',
              'read-only:bg-[var(--surface-sunken)] read-only:focus-visible:ring-0',
              'pointer-coarse:min-h-[44px]',
              'dark:bg-[var(--surface-glass)] dark:backdrop-blur-sm',
              size === 'sm' ? 'px-3 py-1 text-xs' : 'px-3 py-2 text-sm',
              // Priority: error > valid > default (error can't appear green)
              hasError
                ? 'border-[var(--danger)] focus-visible:border-[var(--danger)]'
                : hasValid
                  ? 'border-[var(--success)] focus-visible:border-[var(--success)] focus-visible:ring-[var(--success)]'
                  : 'border-[var(--border-subtle)] focus-visible:border-[var(--brand-primary)]',
              // Pad right so input text never slides under the checkmark icon
              hasValid && !isLoading ? 'pr-9' : '',
            )}
            {...rest}
          />
          {isLoading && (
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2">
              <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-[var(--border-default)] border-t-[var(--brand-primary)]" />
            </span>
          )}
          {hasValid && !isLoading && (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[var(--success)]"
            >
              <Check size={16} strokeWidth={2.5} />
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
Input.displayName = 'Input';
