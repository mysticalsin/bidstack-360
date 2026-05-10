# Design system — BidStack 360°

> Source of truth: `apps/web/src/index.css`. This doc is the high-level rationale.

## Foundations

### Color (light)

| Token | Value | Used for |
|---|---|---|
| `--brand-primary` | `#2C4BFF` | Primary buttons, active nav, links |
| `--brand-primary-tint` | `#EAEEFE` | Selected row tint, focus halos |
| `--surface-page` | `#FAFBFD` | App background |
| `--surface-card` | `#FFFFFF` | Card background |
| `--surface-sidebar` | `#F4F6FA` | Left navigation surface |
| `--fg-primary` | `#1A1F36` | Body copy |
| `--fg-secondary` | `#5A6478` | Subtext, captions |
| `--success` / `--warning` / `--danger` / `--info` | `#1F8A5B` / `#D08A00` / `#D93849` / `#6E59FF` | Semantic states |

### Color (dark)

Every token has a dark-mode peer. The pairing was tuned so:
- Brand contrast against dark surfaces stays at ≥ 4.5:1 for text and ≥ 3:1 for UI controls (WCAG 2.2 AA).
- Tinted surfaces use rgba opacity rather than fully different colors, so cards, badges and overlays read as the same component family in both themes.
- Shadows are deeper (more black) in dark mode because soft elevation gets lost on dark surfaces.

### Typography

- **Sans** — Inter, 9-step scale (10/12/13/14/17/22/28/36/48px)
- **Display** — Plus Jakarta Sans for h1/h2 only
- **Mono** — JetBrains Mono for codes, kbd, audit IDs
- Numerals tabular (`tabular-nums`) on every money/percentage/count for stable column alignment.

### Spacing

8px spatial grid: `space-3` = 8, `space-5` = 16, `space-7` = 24, `space-8` = 32. Tailwind's default scale (`p-2`/`p-4`/`p-6`) is on the same rhythm.

### Radius

`6 / 8 / 10 / 14 / 999`. Cards = 14, buttons = 8, badges = 999.

### Motion

- Easing: `cubic-bezier(0.2, 0.8, 0.2, 1)` (Twenty/Linear standard)
- Durations: 120/150/220/320 ms (fast/normal/menu/modal)
- `prefers-reduced-motion: reduce` flattens every transition to 0.01ms (`apps/web/src/index.css` global override).

## Components shipped

| Component | File | Variants |
|---|---|---|
| Card | `components/ui/Card.tsx` | (single) + `SectionHeader` slot |
| Badge | `components/ui/Badge.tsx` | tones: blue, jade, amber, tomato, purple, gray + `stageTone()` mapper |
| Button | `components/ui/Button.tsx` | primary / secondary / ghost / destructive × sm / md / lg |
| StateMessages | `components/ui/StateMessages.tsx` | EmptyState, ErrorState, LoadingSkeleton |
| AppShell + Sidebar + Topbar | `components/layout/*.tsx` | responsive (sidebar collapses below md) |

Every interactive component has the **9 mandatory states** per `design-standards.md`:
- Default, Hover, Focus (2px ring, 3:1 contrast), Active, Loading, Error, Empty, Disabled, Success.

Where a state isn't yet visually implemented (e.g. Loading on Card), the data-fetching wrapper (`useOpportunities` etc.) feeds `LoadingSkeleton` as the fallback.

## Accessibility checklist (always-on)

- [x] 4.5:1 text contrast in both themes
- [x] 3:1 UI/icon contrast in both themes
- [x] Focus visible: 3px brand-tinted ring (`*:focus-visible`)
- [x] Skip-to-content link in `Topbar`
- [x] Semantic landmarks: `<header role="banner">`, `<aside aria-label>`, `<main aria-label>`, `<nav aria-label>`
- [x] `prefers-reduced-motion` respected globally
- [x] `theme-color` meta tags for both schemes
- [x] All interactive elements have accessible names (icon-only buttons use `aria-label`)
- [ ] Keyboard kanban drag/drop — TBD (Sprint 9; current pipeline page is read-only)
- [ ] Screen-reader testing on Opportunity 360° tab (NVDA + VoiceOver) — TBD
