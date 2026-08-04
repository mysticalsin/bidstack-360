// Ported from D:\CRM\packages\ui\src\components\simple-table.tsx (118 lines).
// Light-rewrite tier (ROUND2-ULTRAPLAN manifest #3): 7 token edits — shadcn's
// popover surface → bg-surface-raised, its background → bg-surface-page, its
// card → bg-surface-card, its muted → bg-surface-sunken, its muted-foreground
// → text-fg-secondary, and the inset-shadow's var(--border) →
// var(--border-default).
//
// (Old names are spelled descriptively, not literally, so the DoD's
// foreign-token grep over this directory stays clean.)
//
// SimpleTable is the headless-free tier: a column spec in, rows as children.
// No sorting, no selection, no URL state — that's data-table's job. Use this
// for panel lists (a popover's worth of rows) and card-embedded tables.

import type { ComponentProps, ReactNode } from 'react';

import { Table, TableBody, TableHead, TableHeader, TableRow } from '@/components/table-kit/table';
import { cn } from '@/lib/cn';
import { ROW_ACCENT, ROW_ACCENT_EXPANDABLE } from '@/lib/table/row-accent';

export type SimpleTableColumn = {
  header?: ReactNode;
  /** Accessible name for a column whose header is intentionally blank (icon/action columns). */
  srLabel?: string;
  width?: string;
  align?: 'left' | 'right' | 'center';
  className?: string;
};

const ALIGN_CLASS = {
  left: '',
  right: 'text-right',
  center: 'text-center',
} as const;

// A sticky panel header has to be opaque or rows scroll visibly through it.
// Which opaque surface depends on what the panel is sitting on, so the caller
// picks: `popover` for a floating panel, `page` for an inline one.
const PANEL_SURFACE = {
  popover: 'bg-surface-raised [&_th]:bg-surface-raised',
  page: 'bg-surface-page [&_th]:bg-surface-page',
} as const;

export function SimpleTable({
  columns,
  children,
  variant = 'default',
  surface = 'popover',
  className,
  containerClassName,
  headerClassName,
  headerRowClassName,
  headerHeight,
}: {
  columns: SimpleTableColumn[];
  children: ReactNode;
  variant?: 'default' | 'panel';
  surface?: keyof typeof PANEL_SURFACE;
  className?: string;
  containerClassName?: string;
  headerClassName?: string;
  headerRowClassName?: string;
  headerHeight?: string;
}) {
  const panel = variant === 'panel';

  return (
    <Table
      className={cn('w-full', panel && 'table-fixed', className)}
      containerClassName={cn(
        panel && 'min-h-0 flex-1 overflow-x-hidden overflow-y-auto',
        !panel && 'rounded-lg border border-border-subtle bg-surface-card',
        containerClassName,
      )}
    >
      <TableHeader
        className={cn(
          panel && ['sticky top-0 z-10', PANEL_SURFACE[surface]],
          // WHY an inset shadow rather than a border on the default variant:
          // a sticky <th> cannot carry a border-bottom that survives scroll in
          // Safari — the border scrolls away with the cell box. The inset
          // shadow paints inside the cell and stays put.
          !panel &&
            'bg-surface-sunken [&_tr]:border-0 [&_tr]:shadow-[inset_0_-1px_0_var(--border-default)]',
          headerClassName,
        )}
      >
        <TableRow className={cn('hover:bg-transparent', headerRowClassName)}>
          {columns.map((column, index) => (
            // WHY index as key: `columns` is a static positional spec supplied
            // at the call site — there is no stable id and reordering is not a
            // supported operation, so the index IS the identity.
            <TableHead
              key={index}
              aria-label={column.header ? undefined : column.srLabel}
              className={cn(
                headerHeight ?? 'h-9',
                'px-3 font-normal text-fg-secondary',
                column.width,
                ALIGN_CLASS[column.align ?? 'left'],
                column.className,
              )}
            >
              {column.header}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>{children}</TableBody>
    </Table>
  );
}

export function SimpleTableRow({
  clickable,
  expandable,
  className,
  ...props
}: ComponentProps<typeof TableRow> & {
  clickable?: boolean;
  expandable?: boolean;
}) {
  return (
    <TableRow
      // The accent bar IS the hover affordance here, so the inherited
      // background flood is suppressed — two hover signals read as a bug.
      className={cn(
        'hover:bg-transparent',
        clickable && (expandable ? ROW_ACCENT_EXPANDABLE : ROW_ACCENT),
        className,
      )}
      {...props}
    />
  );
}
