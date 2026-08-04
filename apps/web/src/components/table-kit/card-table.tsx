// Ported from D:\CRM\packages\ui\src\components\card-table.tsx (34 lines).
// Light-rewrite tier (ROUND2-ULTRAPLAN manifest #4): shadcn's muted-foreground
// → text-fg-secondary, and the bare `border-t` gains an explicit colour
// (Tailwind v4 defaults an uncoloured border to currentColor).
//
// CardTable is SimpleTable with card gutters: the first and last columns get
// the card's own 16px inset so the rows line up with the card title above them
// instead of with the table's 12px cell padding.

import type { ReactNode } from 'react';

import { SimpleTable, type SimpleTableColumn } from '@/components/table-kit/simple-table';

export type CardTableColumn = SimpleTableColumn;

export function CardTable({
  columns,
  children,
}: {
  columns: CardTableColumn[];
  children: ReactNode;
}) {
  return (
    <SimpleTable
      className={
        'min-w-[48rem] table-fixed [&_td:first-child]:pl-4 [&_td:last-child]:pr-4 ' +
        '[&_th:first-child]:pl-4 [&_th:last-child]:pr-4'
      }
      columns={columns}
    >
      {children}
    </SimpleTable>
  );
}

// The empty state for a CardTable renders OUTSIDE the table element (a <p>, not
// a colspan row) so the header row keeps its column geometry while the body is
// blank — the table doesn't visibly collapse and re-expand when data arrives.
export function CardTableEmpty({ children }: { children: ReactNode }) {
  return (
    <p className="border-t border-border-subtle py-6 text-center text-fg-secondary text-xs">
      {children}
    </p>
  );
}
