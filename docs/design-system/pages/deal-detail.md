# Deal Detail Page — Design Overrides

**Route:** `/opportunities/:id`  
**Component:** `OpportunityDetailPage.tsx`

## Unique layout
- Two-column: main content (fluid) + right sidebar (320px, sticky top)
- Right sidebar: stage selector, owner, value, close date, quick actions
- Main content: tabbed sections (Overview, Timeline, Contacts, Files, AI Analysis)
- Stage progress bar: horizontal step indicator at top of main content area

## Component overrides
- Stage selector: step-indicator with `--success` (past), `--brand-primary` (current), `--border-default` (future)
- Value field: large display using step 3xl, `tabular-nums`
- Timeline items: vertical line connector, each item uses `staggerChild` on load
- AI Analysis tab: `--info-tint` background, `--info` accent — clearly AI-sourced content
- Files section: drop zone with dashed border → solid on dragover

## Motion
- Tab switch: `slideRight` variant, 200ms
- Stage advance: confetti burst from `ConfettiHost` on final stage (Won)
- Timeline new item: slides in from bottom, `springSmooth`

## Dark mode specifics
- Stage connector line: `--border-subtle` (dark) — subtle, doesn't overpower stage chips
- AI Analysis section: `rgba(129,140,248,0.08)` background tint — distinctive without being noisy
- Right sidebar: `--surface-sidebar` background, `border-l border-[var(--border-subtle)]`
