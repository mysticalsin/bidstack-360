# Reports Page — Design Overrides

**Route:** `/reports`  
**Component:** `ReportsPage.tsx`

## Unique layout
- Top: date range picker + filter bar
- Chart grid: CSS grid, 2-up on desktop, 1-up on mobile
- Each chart: `Card` with `SectionHeader` + chart body
- Export controls: top-right of page header

## Component overrides
- Chart containers: fixed height 280px, overflow hidden — charts must respect container
- Legend chips: `Badge` component with colored dot + label
- No-data state: `EmptyState` with "No data for this period" copy
- Loading charts: `Skeleton` with chart-shaped placeholder (two bar rows + x-axis line)

## Motion
- Chart data load: bars/lines animate from 0 to value on mount, 600ms easeDecel
- Date range change: charts fade out (150ms) then fade back with new data (250ms)
- prefers-reduced-motion: skip chart draw animation, instant render

## Dark mode specifics
- Chart grid lines: --border-subtle barely visible
- Chart tooltip: --surface-card + --shadow-lg + --border-default border
- Bar/line chart colors: use tag palette (--tag-blue-fg, --tag-jade-fg, etc.) for series distinction
