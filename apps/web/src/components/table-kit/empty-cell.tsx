// Ported from D:\CRM\packages\ui\src\components\empty-cell.tsx (5 lines).
// Verbatim tier (ROUND2-ULTRAPLAN manifest #10): one token rewrite,
// `text-muted-foreground` → `text-fg-secondary`.
//
// The em-dash is the ONLY legal null render in a table cell — never an empty
// string (the row loses its baseline), never "N/A" (reads as data).

import { cn } from '@/lib/cn';

export function EmptyCellValue({ className }: { className?: string }) {
  return <span className={cn('text-fg-secondary', className)}>—</span>;
}
