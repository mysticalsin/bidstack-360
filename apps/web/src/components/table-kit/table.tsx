// Ported from D:\CRM\packages\ui\src\components\table.tsx (119 lines).
// Light-rewrite tier (ROUND2-ULTRAPLAN manifest #2): every shadcn semantic
// classname rewritten into BidStack's vocabulary, plus explicit border colours.
//
// WHY the explicit `border-border-subtle` on every bare `border-b`/`border-t`:
// Tailwind v4 defaults an un-coloured border to `currentColor`, and BidStack
// has no global `* { border-color }` reset the way the CRM's globals.css does.
// Left bare, every rule would paint in the row's text colour.
//
// WHY this lives beside BidStack's own components/ui/Table.tsx instead of
// replacing it: that one is tested and used across the app at page density
// (px-5 py-3, sm text). This is the CRM's dense grid (px-2 py-2.5, xs text) —
// two different instruments, not two spellings of one.

import type { ComponentProps } from 'react';

import { cn } from '@/lib/cn';

function Table({
  className,
  containerClassName,
  ...props
}: ComponentProps<'table'> & { containerClassName?: string }) {
  return (
    <div
      data-slot="table-container"
      className={cn('relative w-full overflow-x-auto', containerClassName)}
    >
      <table
        data-slot="table"
        className={cn('w-full caption-bottom text-xs', className)}
        {...props}
      />
    </div>
  );
}

function TableHeader({ className, ...props }: ComponentProps<'thead'>) {
  return (
    <thead
      data-slot="table-header"
      className={cn('[&_tr]:border-b [&_tr]:border-border-subtle', className)}
      {...props}
    />
  );
}

function TableBody({ className, ...props }: ComponentProps<'tbody'>) {
  return (
    <tbody
      data-slot="table-body"
      className={cn('[&_tr:last-child]:border-0', className)}
      {...props}
    />
  );
}

function TableFooter({ className, ...props }: ComponentProps<'tfoot'>) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        'border-t border-border-subtle bg-surface-sunken/50 font-medium [&>tr]:last:border-b-0',
        className,
      )}
      {...props}
    />
  );
}

function TableRow({ className, ...props }: ComponentProps<'tr'>) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        'border-b border-border-subtle transition-colors hover:bg-surface-hover ' +
          'has-aria-expanded:bg-surface-sunken/50 data-[state=selected]:bg-surface-sunken',
        className,
      )}
      {...props}
    />
  );
}

function TableHead({ className, ...props }: ComponentProps<'th'>) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        'h-9 px-2 text-left align-middle font-medium whitespace-nowrap text-fg-secondary ' +
          '[&:has([role=checkbox])]:pr-0',
        className,
      )}
      {...props}
    />
  );
}

function TableCell({ className, ...props }: ComponentProps<'td'>) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        'px-2 py-2.5 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0',
        className,
      )}
      {...props}
    />
  );
}

function TableCaption({ className, ...props }: ComponentProps<'caption'>) {
  return (
    <caption
      data-slot="table-caption"
      className={cn('mt-4 text-xs text-fg-secondary', className)}
      {...props}
    />
  );
}

export { Table, TableBody, TableCaption, TableCell, TableFooter, TableHead, TableHeader, TableRow };
