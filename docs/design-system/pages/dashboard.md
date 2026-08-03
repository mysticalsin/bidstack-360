# Dashboard Page — Design Overrides

**Route:** `/dashboard`  
**Component:** `DashboardPage.tsx` + `apps/web/src/styles/cockpit.css`

## Unique layout
- 4-column KPI strip at top (fluid below 768px → 2-col, below 480px → 1-col)
- Cockpit aesthetic: large hero numbers using `--font-display`, step 4xl
- Recent opportunities card with sparkline trend lines

## Component overrides
- `KpiCard`: Level 2 elevation (shadow-sm), hover lifts to Level 3 (shadow-md)
- `RecentOpportunitiesCard`: animated row entries on mount using `staggerParent/staggerChild`
- KPI numbers: `tabular-nums` font variant for stable-width numeric updates

## Motion
- Initial page load: cockpit panels stagger in at 32ms intervals via `staggerParent`
- KPI number changes animate with spring counter (number morphs, not flashes)
- Trend sparklines draw in over 600ms on initial render only

## Dark mode specifics
- Cockpit strip gets a subtle brand gradient overlay in dark mode
- KPI cards use `--surface-glass` + backdrop-blur for the "mission control" feel
- No gradients in light mode — keep it clean/professional
