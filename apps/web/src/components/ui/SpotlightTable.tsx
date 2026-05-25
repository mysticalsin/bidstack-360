import type { CSSProperties, HTMLAttributes, ReactNode, TableHTMLAttributes } from 'react';

import { cn } from '@/lib/cn';

interface SpotlightTableProps extends TableHTMLAttributes<HTMLTableElement> {
  children: ReactNode;
  query?: string;
  minWidth?: number;
}

export function SpotlightTable({
  children,
  query,
  minWidth = 680,
  className,
  ...rest
}: SpotlightTableProps) {
  return (
    <div
      className="spotlight-table-wrap"
      data-has-query={Boolean(query?.trim())}
      style={{ '--spotlight-table-min': `${minWidth}px` } as CSSProperties}
    >
      <table className={cn('spotlight-table', className)} {...rest}>
        {children}
      </table>
    </div>
  );
}

interface SpotlightTableRowProps extends HTMLAttributes<HTMLTableRowElement> {
  query?: string;
  searchableText: string;
}

export function SpotlightTableRow({
  query,
  searchableText,
  className,
  ...rest
}: SpotlightTableRowProps) {
  const needle = query?.trim().toLowerCase();
  const isMatch = needle ? searchableText.toLowerCase().includes(needle) : true;

  return (
    <tr
      className={cn('spotlight-table-row', className)}
      data-spotlight-match={isMatch}
      {...rest}
    />
  );
}
