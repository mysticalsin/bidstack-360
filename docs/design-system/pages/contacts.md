# Contacts Page — Design Overrides

**Route:** `/contacts`  
**Component:** `ContactsPage.tsx`

## Unique layout
- Resizable split: list (left, default 380px) + detail panel (right, fluid)
- List view: compact rows — avatar (32px), name, title, company, last-touched date
- Table view toggle: switch to full data grid with sortable columns
- Filter bar: sticky below page header, dismissible chip set

## Component overrides
- Row avatar: `Avatar` component, 32px, initials fallback with deterministic color from name hash
- Row hover: `--surface-sunken` background, no lift (it's a row, not a card)
- Selected row: `--brand-primary-tint` background + left-edge 2px `--brand-primary` indicator line
- Bulk action bar: `BulkActionBar` slides up from bottom when ≥1 row selected

## Motion
- List initial load: `staggerChild` per row, 24ms intervals (faster than cards — list needs speed)
- Row selection: background transitions with `easeStandard` 200ms
- Filter chip add/remove: `AnimatePresence` with `springSnap` scale entrance/exit

## Dark mode specifics
- Row selected state: `rgba(94,106,210,0.12)` background + `--brand-primary` left border
- Hover row: `rgba(255,255,255,0.03)` overlay — barely-there, keeps focus on content
