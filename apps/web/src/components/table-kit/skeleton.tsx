// Ported from D:\CRM\packages\ui\src\components\skeleton.tsx (13 lines).
// Micro-port (ROUND2-ULTRAPLAN closure row): cn import path + one token
// rewrite, `bg-muted` → `bg-surface-sunken`.
//
// Namespaced under table-kit/ deliberately — BidStack's own
// components/skeletons/ page skeletons are untouched. This is the cell-level
// primitive the grafted dashboard/data-table tier composes.

import type { ComponentProps } from 'react';

import { cn } from '@/lib/cn';

function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      className={cn('animate-pulse rounded-sm bg-surface-sunken', className)}
      {...props}
    />
  );
}

export { Skeleton };
