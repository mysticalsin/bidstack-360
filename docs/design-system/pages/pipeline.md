# Pipeline Page — Design Overrides

**Route:** `/pipeline`  
**Component:** `PipelinePage.tsx`

## Unique layout
- Horizontal kanban board: columns scroll horizontally beyond 5 columns
- Each column: 280px fixed width, full viewport height minus header
- Column headers: stage name + deal count badge + total value chip

## Component overrides
- Deal cards: `InteractiveCard` with `whileHover={{ y: -3 }}` — hover lifts cards distinctly from column background
- Drag-and-drop handles: show on card hover, 44×44 touch target
- Empty columns: `EmptyState` with `+` CTA to create a deal in that stage
- Column headers: sticky within their scroll container (z-index: raised / 9)

## Motion
- Card drag: scale(1.02) + shadow-lg while dragging (GPU-only via transform)
- Drop onto new column: spring settle (`springLayout`)
- Stage transitions: card exits old column (scale 0.96, opacity 0), enters new (scale 1, opacity 1)
- `prefers-reduced-motion`: drag still works, no scale/shadow changes

## Dark mode specifics
- Column backgrounds: `--surface-sunken` (light) / `#070708` (dark) — slightly recessed from card surface
- Column borders: `--border-subtle` only — no prominent vertical dividers
- Drag shadow in dark mode: `0 0 32px rgba(94,106,210,0.25)` — brand glow
