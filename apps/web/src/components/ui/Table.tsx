import {
  forwardRef,
  type HTMLAttributes,
  type TdHTMLAttributes,
  type ThHTMLAttributes,
} from 'react';

import { cn } from '@/lib/cn';

export const Table = forwardRef<HTMLTableElement, HTMLAttributes<HTMLTableElement>>(
  ({ className, ...rest }, ref) => (
    <table ref={ref} className={cn('w-full text-left text-sm', className)} {...rest} />
  ),
);
Table.displayName = 'Table';

export const TableHeader = forwardRef<
  HTMLTableSectionElement,
  HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...rest }, ref) => (
  <thead
    ref={ref}
    className={cn(
      'bg-[var(--surface-sunken)] text-xs uppercase tracking-wider text-[var(--fg-tertiary)]',
      className,
    )}
    {...rest}
  />
));
TableHeader.displayName = 'TableHeader';

export const TableBody = forwardRef<
  HTMLTableSectionElement,
  HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...rest }, ref) => (
  <tbody ref={ref} className={cn('divide-y divide-[var(--border-subtle)]', className)} {...rest} />
));
TableBody.displayName = 'TableBody';

export const TableFooter = forwardRef<
  HTMLTableSectionElement,
  HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...rest }, ref) => (
  <tfoot
    ref={ref}
    className={cn('border-t border-[var(--border-subtle)] bg-[var(--surface-sunken)]', className)}
    {...rest}
  />
));
TableFooter.displayName = 'TableFooter';

export const TableRow = forwardRef<HTMLTableRowElement, HTMLAttributes<HTMLTableRowElement>>(
  ({ className, ...rest }, ref) => (
    <tr
      ref={ref}
      className={cn(
        // hover: surface-sunken in light; --row-hover-tint (purple 6% opacity) in dark
        'transition-colors hover:bg-[var(--surface-sunken)] data-[selected=true]:bg-[var(--brand-primary-tint)]/60 ' +
          'dark:hover:bg-[var(--row-hover-tint)]',
        className,
      )}
      {...rest}
    />
  ),
);
TableRow.displayName = 'TableRow';

export const TableHead = forwardRef<HTMLTableCellElement, ThHTMLAttributes<HTMLTableCellElement>>(
  ({ className, scope = 'col', ...rest }, ref) => (
    <th ref={ref} scope={scope} className={cn('px-5 py-3 font-semibold', className)} {...rest} />
  ),
);
TableHead.displayName = 'TableHead';

export const TableCell = forwardRef<HTMLTableCellElement, TdHTMLAttributes<HTMLTableCellElement>>(
  ({ className, ...rest }, ref) => (
    <td ref={ref} className={cn('px-5 py-3 text-[var(--fg-secondary)]', className)} {...rest} />
  ),
);
TableCell.displayName = 'TableCell';

export const TableCaption = forwardRef<
  HTMLTableCaptionElement,
  HTMLAttributes<HTMLTableCaptionElement>
>(({ className, ...rest }, ref) => (
  <caption
    ref={ref}
    className={cn('mt-3 text-xs text-[var(--fg-tertiary)]', className)}
    {...rest}
  />
));
TableCaption.displayName = 'TableCaption';

export function TableScrollArea({
  className,
  'aria-label': ariaLabel,
  ...rest
}: HTMLAttributes<HTMLDivElement>) {
  // WHY conditional role: a landmark region MUST have an accessible name or
  // screen readers will either skip it or announce it as "region" with no
  // context. We only add the role when the caller supplies aria-label.
  return (
    <div
      className={cn('overflow-x-auto', className)}
      role={ariaLabel ? 'region' : undefined}
      aria-label={ariaLabel}
      {...rest}
    />
  );
}
