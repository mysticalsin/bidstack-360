// Ported from D:\CRM\packages\ui\src\lib\row-accent.ts (21 lines).
// One token rewrite (ROUND2-ULTRAPLAN manifest #15): `bg-foreground` →
// `bg-fg-primary`, BidStack's own vocabulary via the @theme bridge
// (--color-fg-primary at index.css:370).
//
// The row-hover grammar: a 2px bar slides in on the first cell's ::before and
// the cell's padding eases out 4px, so the whole row reads as "pointable"
// without a background flood. Density stays intact — nothing reflows.

const BAR = [
  '[&>td:first-child]:relative',
  '[&>td:first-child]:before:pointer-events-none [&>td:first-child]:before:absolute',
  '[&>td:first-child]:before:inset-y-0 [&>td:first-child]:before:left-0 [&>td:first-child]:before:w-0.5',
  '[&>td:first-child]:before:bg-fg-primary [&>td:first-child]:before:opacity-0',
  '[&:hover>td:first-child]:before:opacity-100',
].join(' ');

export const ROW_ACCENT = [
  'cursor-pointer',
  BAR,
  '[&>td:first-child]:transition-[padding] [&>td:first-child]:duration-200 [&>td:first-child]:ease-out',
  '[&:hover>td:first-child]:pl-5',
].join(' ');

// Expandable rows carry a chevron/checkbox in cell 1, so the padding slide
// moves to cell 2 while the accent bar stays pinned to the row edge.
export const ROW_ACCENT_EXPANDABLE = [
  'cursor-pointer',
  BAR,
  '[&>td:nth-child(2)]:transition-[padding] [&>td:nth-child(2)]:duration-200 [&>td:nth-child(2)]:ease-out',
  '[&:hover>td:nth-child(2)]:pl-5',
].join(' ');
