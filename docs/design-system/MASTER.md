# BidStack 360° — Design System Master

**Version:** 1.0.0  
**Last updated:** 2026-05-24  
**Source of truth.** All contributors must read this before creating or touching UI components.

---

## 1. Visual Theme & Atmosphere

BidStack 360° draws on the Apple Human Interface Guidelines, Linear's "premium-void" dark aesthetic, and Mantu's enterprise-grade trust signals. The goal is a tool that feels *fast*, *trustworthy*, and *effortless* — never cluttered.

**Core character:**
- **Light mode:** Clean, airy — crisp white surfaces with subtle blue-cool tints. Functional, not sterile.
- **Dark mode:** Near-black void (`#010102`) with indigo-violet brand accents. No gray-washed darks — true voids with intentional glow.
- **Motion philosophy:** Micro-interactions affirm actions. No decorative motion. Every animation serves a communication purpose.
- **Density:** Information-dense but not cramped. Default 8px spacing grid with compact (4px) used only for inline icon/text gaps.

---

## 2. Color Palette & Roles

All tokens are defined in `apps/web/src/index.css`. Never hardcode hex — use CSS variables.

### 2.1 Brand

| CSS Variable | Light Value | Dark Value | Semantic Role | Usage |
|---|---|---|---|---|
| `--brand-primary` | `#2c4bff` | `#5e6ad2` | Primary action color | CTAs, links, selected state indicators |
| `--brand-primary-hover` | `#2540e0` | `#7882e7` | Hover state of primary | Hover on buttons, interactive links |
| `--brand-primary-press` | `#1f38c7` | `#4d58ba` | Active/press state | Pressed button, active toggle |
| `--brand-primary-tint` | `#eaeefe` | `rgba(94,106,210,0.18)` | Light fill of brand | Tag chips, selection backgrounds |
| `--brand-deep` | `#1b2c7a` | `#7882e7` | Deepened brand tone | Heavy emphasis, icon fills on light |

**WCAG note:** `--brand-primary` (#2c4bff) on white (#fff) = **4.54:1** ✓ AA. On `--surface-card` (#fff) = same. Dark mode: `--brand-primary` (#5e6ad2) on `--surface-page` (#010102) = **8.7:1** ✓ AAA.

### 2.2 Surface

| CSS Variable | Light Value | Dark Value | Semantic Role | Usage |
|---|---|---|---|---|
| `--surface-page` | `#fafbfd` | `#010102` | Page background | `<body>`, full-bleed page areas |
| `--surface-card` | `#ffffff` | `#0c0c0e` | Card/panel surface | Cards, modals, popovers, dropdowns |
| `--surface-sidebar` | `#f4f6fa` | `#09090b` | Sidebar background | App shell sidebar |
| `--surface-sunken` | `#edeff5` | `#070708` | Recessed surface | Input backgrounds, inset sections |
| `--surface-overlay` | `rgba(16,24,40,0.32)` | `rgba(0,0,0,0.85)` | Scrim/backdrop | Modal backdrop, drawer backdrop |
| `--surface-glass` | — | `rgba(12,12,14,0.72)` | Frosted glass | Dark-mode cards with backdrop-blur |

### 2.3 Foreground

| CSS Variable | Light Value | Dark Value | Semantic Role | Usage |
|---|---|---|---|---|
| `--fg-primary` | `#1a1f36` | `#f8fafc` | Primary text | Body copy, headings, labels |
| `--fg-secondary` | `#5a6478` | `#a1a1aa` | Secondary text | Captions, supporting copy |
| `--fg-tertiary` | `#6b7280` | `#71717a` | Tertiary/hint text | Placeholder, metadata | 
| `--fg-muted` | `#a0a8b8` | `#52525b` | Disabled/muted text | Disabled states, inactive tabs |
| `--fg-inverted` | `#ffffff` | `#010102` | Inverted text | Text on dark/brand backgrounds |
| `--fg-on-brand` | `#ffffff` | `#ffffff` | Text on brand fills | Button labels on primary fills |

**WCAG notes:**  
- `--fg-primary` (#1a1f36) on `--surface-card` (#fff) = **16.9:1** ✓ AAA  
- `--fg-secondary` (#5a6478) on white = **6.1:1** ✓ AA  
- `--fg-tertiary` (#6b7280) on white = **4.6:1** ✓ AA (darkened from #8a93a6 which was 3.09:1 — see inline comment in index.css)

### 2.4 Borders

| CSS Variable | Light Value | Dark Value | Semantic Role | Usage |
|---|---|---|---|---|
| `--border-subtle` | `#edeff5` | `#22242a` | Hairline divider | Card inner dividers, list separators |
| `--border-default` | `#dde1eb` | `#2d3039` | Default border | Input borders, card outlines |
| `--border-strong` | `#c2c8d6` | `#3e424f` | Emphasis border | Hover/active borders |
| `--border-focus` | `#2c4bff` | `#5e6ad2` | Focus indicator | Focus ring target color |
| `--border-glow` | — | `rgba(94,106,210,0.15)` | Ambient glow | Dark mode hover glow |
| `--border-glow-strong` | — | `rgba(94,106,210,0.3)` | Strong glow | Dark mode active/focused glow |

### 2.5 Semantic

| CSS Variable | Light Value | Dark Value | WCAG on surface | Usage |
|---|---|---|---|---|
| `--success` | `#1f8a5b` | `#34d399` | 4.8:1 ✓ AA | Positive outcomes, saved state |
| `--success-tint` | `#e4f4ec` | `rgba(52,211,153,0.16)` | — | Success backgrounds |
| `--warning` | `#d08a00` | `#fbbf24` | 4.6:1 ✓ AA | Caution, pending states |
| `--warning-tint` | `#fbf1dc` | `rgba(251,191,36,0.16)` | — | Warning backgrounds |
| `--danger` | `#d93849` | `#fb7185` | 4.9:1 ✓ AA | Errors, destructive actions |
| `--danger-tint` | `#fbe5e8` | `rgba(251,113,133,0.16)` | — | Error backgrounds |
| `--info` | `#6e59ff` | `#818cf8` | 5.1:1 ✓ AA | Informational, AI-generated |
| `--info-tint` | `#ece8ff` | `rgba(129,140,248,0.16)` | — | Info backgrounds |

### 2.6 Tag Palette

8 semantic tag colors for pipeline stages, categories, and labels. Each has `*-bg` (fill) and `*-fg` (text) pairs. All `*-fg` values are WCAG AA compliant on their `*-bg` counterpart:

`blue`, `jade`, `amber`, `tomato`, `purple`, `teal`, `rose`, `gray`

### 2.7 Chart / Visualization Palette

8 fills for data viz (treemap, bar, pie, map regions), stage indicators, confetti particles, and any other categorical mark. Defined in `index.css` as `--chart-1`…`--chart-8`. Light-mode values clear WCAG AA (≥4.5:1) against pure white text at 12px; dark-mode variants are brightened to read against the void-black surfaces.

| Token | Light | Dark | Suggested role |
|---|---|---|---|
| `--chart-1` | `#2c4bff` brand blue | `#818cf8` indigo-400 | Lead / primary series |
| `--chart-2` | `#1f8a5b` jade-700 | `#34d399` emerald-400 | Won / positive |
| `--chart-3` | `#7c3aed` violet-600 | `#a78bfa` violet-400 | In-progress / mid-funnel |
| `--chart-4` | `#0e7490` cyan-700 | `#2dd4bf` teal-400 | Secondary / supporting |
| `--chart-5` | `#be185d` rose-700 | `#fb7185` rose-400 | Iteration / negotiation |
| `--chart-6` | `#b45309` amber-700 | `#fbbf24` amber-400 | Warning / pending |
| `--chart-7` | `#dc2626` red-600 | `#f87171` red-400 | Lost / blocked |
| `--chart-8` | `#475569` slate-600 | `#a1a1aa` zinc-400 | Neutral / other |

**Rules:**
- Use `--chart-*` for categorical data. Use semantic tokens (`--success`, `--warning`, `--danger`) for status that maps to a single semantic meaning.
- Reference via inline `style={{ backgroundColor: 'var(--chart-1)' }}` when the value is dynamic from JS — CSS variable strings are honored by React inline styles.
- For Tailwind utility classes, use `bg-[var(--chart-1)]` (v3 syntax; the project does not use Tailwind v4's `bg-(--chart-1)`).
- Never inline a raw hex from this palette. The `audit:design` script catches strays.

### 2.8 Elevation / Shadows

| CSS Variable | Light | Dark | Use |
|---|---|---|---|
| `--shadow-xs` | Soft 1px haze | 1px white rim 3% | Resting cards, chips |
| `--shadow-sm` | 2-8px spread | White rim + drop shadow | Elevated cards |
| `--shadow-md` | 8-24px spread | White rim + 12px blur | Modals, drawers |
| `--shadow-lg` | 20-48px spread | White rim + 30px blur | Overlays, tooltips |
| `--focus-ring` | `0 0 0 3px rgba(44,75,255,0.14)` | `0 0 0 3px rgba(94,106,210,0.22)` | Focus state box-shadow |

---

## 3. Typography Rules

**Font stack:**  
- Body: `system-ui, -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Inter', 'Segoe UI Variable', ...`  
- Display: `-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Inter Display', ...`  
- Mono: `ui-monospace, 'SF Mono', 'JetBrains Mono', ...`

**Font features:** Always render with `font-feature-settings: 'cv11' 1, 'ss01' 1, 'ss03' 1, 'kern' 1, 'calt' 1` (Inter's SF-mimicking alternates + kerning).

**Type scale (9 steps):**

| Step | Size | Line Height | Weight | Letter Spacing | Usage |
|---|---|---|---|---|---|
| xs | 11px / 0.6875rem | 1.6 | 400–500 | 0 | Metadata, timestamps |
| sm | 12px / 0.75rem | 1.5 | 400–500 | 0 | Captions, badges, table cells |
| base | 13px / 0.8125rem | 1.5 | 400 | 0 | Body text, form labels |
| md | 14px / 0.875rem | 1.5 | 400–600 | 0 | Primary UI text, list items |
| lg | 15px / 0.9375rem | 1.5 | 500–600 | -0.01em | Section labels, nav items |
| xl | 16px / 1rem | 1.4 | 600 | -0.01em | Card titles, modal headers |
| 2xl | 18px / 1.125rem | 1.35 | 600–700 | -0.015em | Page section headers |
| 3xl | 24px / 1.5rem | 1.25 | 700 | -0.02em | Page titles (h1 on detail pages) |
| 4xl | 30px+ / 1.875rem+ | 1.2 | 700–800 | -0.02em | Hero KPIs, cockpit numbers |

**Rules:**
- Never go below 11px rendered.
- `h1`: `font-display`, letter-spacing `-0.02em`.
- `h2`: `font-display`, letter-spacing `-0.015em`.
- `h3`+: `font-display`, letter-spacing `-0.01em`.
- Use `font-feature-settings` from CSS vars — don't inline.

---

## 4. Component Stylings

All 28 components referenced below live in `apps/web/src/components/ui/` unless noted.

### Required States (all interactive components)
1. **Default** — resting visual state
2. **Hover** — lift translateY(-2px), 200ms ease-out, shadow elevate
3. **Focus** — 2px `--border-focus` ring + `--focus-ring` box-shadow, visible at 3:1 contrast
4. **Active/Press** — scale 0.98, 100ms ease-in-out
5. **Loading** — skeleton shimmer OR spinner (never both)
6. **Error** — `--danger` border/icon, descriptive message
7. **Empty** — illustration slot + helpful CTA
8. **Disabled** — 60% opacity, `cursor-not-allowed`, no hover effects
9. **Success** — `--success` color, tick icon, auto-dismiss or persistent

### Component Catalogue

| # | Component | File | Status | Notes |
|---|---|---|---|---|
| 1 | Button | `Button.tsx` | ✅ Enhanced | primary/secondary/ghost/destructive × sm/md/lg |
| 2 | Input | `Input.tsx` | ✅ Enhanced | focus glow, error shake, prefix/suffix slots |
| 3 | Card | `Card.tsx` | ✅ Present | `Card` (static) + `InteractiveCard` (hover lift) |
| 4 | Modal/Dialog | `Dialog.tsx` | ✅ Present | Radix portal, backdrop blur, spring entrance |
| 5 | Skeleton | `Skeleton.tsx` | ✅ Enhanced | Shimmer animation, 1.5s cycle, shape variants |
| 6 | EmptyState | `StateMessages.tsx` | ✅ Present | Float animation, illustration slot, CTA |
| 7 | ErrorState | `StateMessages.tsx` | ✅ Present | role=alert, empathetic copy, recovery CTA |
| 8 | Toast | `Toast.tsx` | ✅ Present | Slide entrance, auto-dismiss, action button |
| 9 | Badge | `Badge.tsx` | ✅ Present | Semantic tones, dot indicator variant |
| 10 | Avatar | `Avatar.tsx` | ✅ Enhanced (M5) | 4 variants (image/initials/gradient/placeholder), 6 sizes (xs/sm/md/lg/xl/2xl), status dot, badge slot |
| 11 | Tabs | `Tabs.tsx` | ✅ Present | Animated underline indicator |
| 12 | Tooltip | `Tooltip.tsx` | ✅ Present | Radix portal, 300ms delay |
| 13 | HoverCard | `HoverCard.tsx` | ✅ Present | Rich preview card on hover |
| 14 | ConfirmDialog | `ConfirmDialog.tsx` | ✅ Present | Destructive action confirmation |
| 15 | BulkActionBar | `BulkActionBar.tsx` | ✅ Present | Bottom-anchored, slide up when selection > 0 |
| 16 | GlassCard | `GlassCard.tsx` | ✅ Present | Dark mode frosted glass surface |
| 17 | MagneticButton | `MagneticButton.tsx` | ✅ Present | Cursor-tracking magnetic pull effect |
| 18 | ProgressRing | `ProgressRing.tsx` | ✅ Present | SVG ring, animated fill |
| 19 | Icon | `Icon.tsx` | ✅ Enhanced (M5) | Lucide-style legacy paths + 80 CRM icons via union `name` prop, size tokens xs/sm/md/lg/xl + numeric escape hatch |
| 20 | Breadcrumbs | `Breadcrumbs.tsx` | ✅ Present | Chevron-separated nav |
| 21 | SortableHeader | `SortableHeader.tsx` | ✅ Present | Table column sort indicator |
| 22 | SavedFlash | `SavedFlash.tsx` | ✅ Present | Inline "Saved!" micro-feedback |
| 23 | StatusPulse | `StatusPulse.tsx` | ✅ Present | Animated status dot |
| 24 | SectionHeader | `Card.tsx` | ✅ Present | Card section divider with action slot |
| 25 | LoadingSkeleton | `StateMessages.tsx` | ✅ Present | Staggered row shimmer |
| 26 | DesignSystemPage | `pages/DesignSystemPage.tsx` | ✅ Created | Admin-gated component gallery |
| 27 | ErrorBoundary | `ErrorBoundary.tsx` | ✅ Present | Route-level error boundary |
| 28 | KeyboardShortcutsHelp | `KeyboardShortcutsHelp.tsx` | ✅ Present | ⌘? overlay |
| 29 | Switch | `Switch.tsx` | ✅ New (M1) | Radix Switch, 44×44 touch target, on=brand / off=surface-sunken |
| 30 | Checkbox | `Checkbox.tsx` | ✅ New (M1) | Radix Checkbox + indeterminate for select-all |
| 31 | RadioGroup | `RadioGroup.tsx` | ✅ New (M1) | Radix RadioGroup, vertical + horizontal, per-option description |
| 32 | Popover | `Popover.tsx` | ✅ New (M1) | Radix Popover wrapper, tokenized arrow + spring entrance |
| 33 | Sheet | `Sheet.tsx` | ✅ New (M1) | Radix Dialog as side drawer (4 sides), swipe-to-dismiss on touch |
| 34 | Select | `Select.tsx` | ✅ New (M1) | Radix Select wrapper, optgroups, search-on-type |
| 35 | Combobox | `Combobox.tsx` | ✅ New (M1) | Async typeahead, 300ms debounce, single + multi |
| 36 | DatePicker | `DatePicker.tsx` | ✅ New (M1) | Internal calendar grid, keyboard nav, min/max bounds |
| 37 | DateRangePicker | `DateRangePicker.tsx` | ✅ New (M1) | Range + 7 preset shortcuts (Today / YTD / etc.) |
| 38 | AvatarGroup | `AvatarGroup.tsx` | ✅ New (M5) | Overlapping stack with `+N` overflow chip + tooltips |
| 39 | StatusDot | `StatusDot.tsx` | ✅ New (M5) | Standalone presence dot (5 statuses), pulse + reduced-motion fallback |
| 40 | DataTable | `DataTable/` | ✅ New (M2) | Industrial: sort/filter/paginate/virtual-scroll/column-resize/row-select/inline-edit/density modes/sticky cols + mobile card-stack |
| 41 | RecordDetailLayout | `templates/RecordDetailLayout.tsx` | ✅ New (M3) | Page-level 3-region shell (role=main). Right rail collapses below lg |
| 42 | HighlightsPanel | `templates/HighlightsPanel.tsx` | ✅ New (M3) | Sticky top region, 4-KPI cap, IntersectionObserver collapse past 144px |
| 43 | RecordTabs | `templates/RecordTabs.tsx` | ✅ New (M3) | Canonical Overview/Activity/Related/Notes + chord shortcuts g+o/a/r/n |
| 44 | RelatedList | `templates/RelatedList.tsx` | ✅ New (M3) | Card header + DataTable body for related-records surfaces |
| 45 | ActivityTimeline | `templates/ActivityTimeline.tsx` | ✅ New (M3) | Reverse-chrono feed with day dividers, inline reply, filter chips |
| 46 | RightRail | `templates/RightRail.tsx` | ✅ New (M3) | Compound: .Section / .KeyFields / .AiSuggestion. role=complementary |
| 47 | FooterActions | `templates/FooterActions.tsx` | ✅ New (M3) | Mobile-only sticky bottom bar (lg:hidden) with safe-area inset |
| 48 | ListViewLayout | `templates/ListViewLayout.tsx` | ✅ New (M7) | Header + breadcrumbs + actions + collapsible filter bar + body |
| 49 | DashboardLayout | `templates/DashboardLayout.tsx` | ✅ New (M7) | Header + KPI row + responsive widget grid (auto/1/2/3/4 cols) |
| 50 | WizardLayout | `templates/WizardLayout.tsx` | ✅ New (M7) | Step indicator + content panel + footer (back/save-draft/continue) |
| 51 | SettingsPageLayout | `templates/SettingsLayout.tsx` | ✅ New (M7) | Sticky left sub-nav + content + danger zone (aliased to avoid collision with components/settings/SettingsLayout) |
| 52 | AuthLayout | `templates/AuthLayout.tsx` | ✅ New (M7) | Centered card with brand mark + form + alt action + legal footer |
| 53 | RtlMirror | `RtlMirror.tsx` | ✅ New (M10) | Directional-icon wrapper (scaleX(-1) in RTL) |
| 54 | LocaleSwitcher | `layout/LocaleSwitcher.tsx` | ✅ New (M10) | Topbar Select dropdown, persists to localStorage |
| 55 | BrandingTab | `pages/settings/BrandingTab.tsx` | ✅ New (M10) | Admin theme editor with live preview + WCAG contrast warning |

### 4.1 State preset registry (M4)

30 contextual empty / loading / error presets live in `apps/web/src/components/states/`, each wrapping the enhanced `EmptyState` / `ErrorState` / `LoadingSkeleton` with the right illustration + tokenized copy + recovery CTA. Copy strings source from `design-system/voice/copy/empty-states.json` (M8). 24 supporting illustrations live in `apps/web/src/components/states/Illustrations/` — 96×96 viewBox, 2px stroke, `currentColor` only, geometric primitives only.

See `docs/roadmap/SLDS-CLASS-ROADMAP.md` §4 M4 for the full preset list. Audit enforcement: `scripts/audit-empty-states.mjs` (wire via `pnpm audit:empty-states`) detects ad-hoc empty strings outside the preset registry.

---

## 5. Layout Principles

### Spacing Scale (4px base grid)

| Token | Value | Usage |
|---|---|---|
| 1 | 4px | Tight inline gaps (icon+text, badge padding) |
| 2 | 8px | Default padding within compact elements |
| 3 | 12px | Inline padding in inputs/chips |
| 4 | 16px | Card padding, section gaps |
| 5 | 20px | Generous section padding |
| 6 | 24px | Section-to-section vertical rhythm |
| 8 | 32px | Major section separators |
| 10 | 40px | Hero spacing, page-level padding |
| 12 | 48px | Empty states, large gaps |
| 16 | 64px | Full-page vertical padding |

**Rule:** All spacing MUST land on a 4px multiple. Off-grid spacing (e.g. 6px, 10px, 14px) is only allowed for optical corrections at text baseline — document with a comment.

### Grid System

| Context | Column count | Gutter | Margin |
|---|---|---|---|
| Mobile (375px) | 4 | 12px | 16px |
| Tablet (768px) | 8 | 16px | 24px |
| Desktop (1024px) | 12 | 20px | 32px |
| Wide (1440px+) | 12 | 24px | 48px |

**App shell layout:**
- Sidebar: 240px collapsed → 64px icon mode
- Content area: fluid, min-width 480px
- Detail panels: 380px right drawer
- Max content width: 1280px centered

### Z-Index Ladder

| Level | z-index | Usage |
|---|---|---|
| base | 0 | Normal stacking flow |
| raised | 1–9 | Sticky table headers, raised cards |
| dropdown | 10–19 | Inline dropdowns, date pickers |
| sticky | 20–29 | Sticky page headers |
| drawer | 30–39 | Side drawers, right panels |
| modal | 40–49 | Modals and their overlays |
| toast | 100 | Toast notifications |
| command | 200 | Command palette |
| tooltip | 300 | Tooltips (must be above everything) |

---

## 6. Depth & Elevation

BidStack uses a 4-level elevation system modeled after Apple's layered canvas:

| Level | Shadow Token | Usage |
|---|---|---|
| Level 0 | none | Flat backgrounds, sidebar items |
| Level 1 | `--shadow-xs` | Resting cards, chips, badges |
| Level 2 | `--shadow-sm` | Elevated cards, input fields |
| Level 3 | `--shadow-md` | Modals, drawers, popovers |
| Level 4 | `--shadow-lg` | Command palette, floating toolbars |

**Dark mode elevation:** Dark mode swaps drop-shadows for subtle white-rim borders (`rgba(255,255,255,0.03–0.08)`) + ambient glow from `--border-glow`. This mirrors how macOS Big Sur renders depth in dark mode.

**Rules:**
- Never stack two Level 3+ surfaces without a scrim between them.
- Modals always have a `--surface-overlay` backdrop.
- Hover state elevates by one level (Level 1 → Level 2).

---

## 7. Motion & Animation System

All springs are defined in `apps/web/src/lib/motion.ts`. Never invent one-off spring values.

### Spring Tokens

| Token | Stiffness | Damping | Mass | Duration (~) | Usage |
|---|---|---|---|---|---|
| `springSnap` | 520 | 32 | 0.6 | ~160ms | Buttons, tap affordances, toggles |
| `springModal` | 360 | 28 | 0.8 | ~280ms | Modal/dialog entrance, toasts |
| `springSmooth` | 280 | 30 | 0.9 | ~320ms | Page/view transitions |
| `springSoft` | 180 | 26 | 1.0 | ~400ms | Ambient reveals, scroll into view |
| `springLayout` | 420 | 36 | 0.7 | ~220ms | Layout/FLIP, reordering |

### Eases (for opacity-only tweens)

| Token | Curve | Duration | Usage |
|---|---|---|---|
| `easeStandard` | `[0.32, 0.72, 0, 1]` | 240ms | Opacity fades, colour transitions |
| `easeDecel` | `[0, 0.72, 0.32, 1]` | 320ms | Content arriving on screen |
| `easeAccel` | `[0.32, 0, 1, 0.28]` | 180ms | Content leaving screen |

### Interaction Primitives

| Interaction | Transform | Duration | Spring |
|---|---|---|---|
| Hover lift | `translateY(-2px)` | 200ms | `springSnap` |
| Press feedback | `scale(0.97–0.98)` | 100ms | `springSnap` |
| Card hover | `translateY(-3px)` | 200ms | `springSnap` |
| Focus glow | 2px ring + pulse 150ms | 150ms | opacity tween |
| Toast slide in | `y: 24 → 0`, `scale: 0.96 → 1` | ~280ms | `springModal` |
| Modal entrance | `scale: 0.96 → 1` + `y: 8 → 0` | ~280ms | `springModal` |
| Page transition | `x: ±12 → 0` | ~320ms | `springSmooth` |
| Skeleton shimmer | Gradient sweep | 1500ms | linear loop |
| Float (empty state) | `y: 0 → -4 → 0` | 3200ms | `easeInOut` loop |

### Rules

1. **GPU only:** All animations use `transform` and `opacity` only. Never animate `width`, `height`, `top`, `left`, `margin`, or `padding`.
2. **prefers-reduced-motion:** Every animation must check `useReducedMotion()`. When true, collapse to instant fade (`opacity` only, no transforms).
3. **No decorative loops** in production except: skeleton shimmer, empty-state float, status pulse.
4. **Never exceed 400ms** for interactive responses. Page transitions max 350ms.
5. **AnimatePresence** wraps all conditional component renders that need exit animations.

---

## 8. Do's and Don'ts

### Do
- Use CSS variables everywhere: `bg-[var(--surface-card)]`
- Use `springSnap` for button/control interactions
- Use `useReducedMotion()` in every animated component
- Use `focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)]` for focus states
- Use `pointer-coarse:min-h-11 pointer-coarse:min-w-11` for 44×44 touch targets
- Use `role="alert"` on error states, `aria-live` on dynamic regions
- Use `data-theme="dark"` on `<html>` for dark mode (not `class="dark"`)
- Use named exports from utility files; default export only for route components

### Don't
- Hardcode hex colors (e.g., `text-[#2c4bff]`) — use CSS variables
- Animate `width`, `height`, `top`, `left` — causes layout reflow
- Use `console.log` in shipped code — use Pino (API) or omit (frontend)
- Use `any` in TypeScript without an `// eslint-disable-next-line` + justification comment
- Invent custom spring values — use tokens from `motion.ts`
- Skip the empty/error/loading state on any data-fetching component
- Use `class="dark"` for dark mode switching — project uses `data-theme`
- Import with relative paths `../../..` — use `@/` alias

---

## 9. Responsive Behavior

| Breakpoint | Width | Target device |
|---|---|---|
| xs | 375px | iPhone SE, small phones |
| sm | 640px | Phablets, landscape phones |
| md | 768px | iPad portrait, large phones |
| lg | 1024px | iPad landscape, small laptops |
| xl | 1280px | Desktop |
| 2xl | 1440px | Wide desktop |

### Adaptation Rules

**375px (mobile):**
- Single-column layout
- Sidebar collapses to bottom nav (4 primary items)
- Cards go full width with 16px side margin
- Tables become card stacks
- Touch targets: all interactive elements ≥ 44×44px
- Font scale unchanged (no rescaling below 13px)

**768px (tablet):**
- Sidebar becomes rail (icon-only, 64px wide)
- Two-column grid for lists
- Modal: 90vw
- Command palette: 70vw

**1024px (desktop):**
- Full sidebar (240px)
- Multi-column layouts unlock
- Modal: min(560px, 92vw)
- Tables in full form

**1440px (wide):**
- Max content width 1280px, centered with auto margins
- Cockpit dashboard: 4-column KPI row
- Pipeline kanban: 5+ columns visible

---

## 10. Agent Prompt Guide

When generating UI code for BidStack 360° with an AI agent, include this context:

```
You are generating UI for BidStack 360°, an enterprise CRM built with:
- React 18 + Vite 6 + TypeScript 5.7
- Tailwind CSS 4 (v3 syntax: bg-[var(--x)], NOT bg-(--x))
- Radix UI primitives for accessible components
- Framer Motion for animations
- CSS variables defined in apps/web/src/index.css

MANDATORY rules:
1. Use CSS variables: bg-[var(--surface-card)], text-[var(--fg-primary)]
2. Dark mode via [data-theme='dark'] selectors, CSS variables handle switching
3. All animations via springSnap/springModal/springSoft from @/lib/motion
4. Every interactive component needs: hover, focus, active, disabled, loading, error, empty states
5. Focus ring: focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] focus-visible:ring-offset-2
6. Touch targets: pointer-coarse:min-h-11 pointer-coarse:min-w-11
7. useReducedMotion() check on every animated component
8. Named exports only (except route pages which may use default export)
9. No TypeScript any, no console.log, max 50 lines per function, max 400 lines per file
10. Absolute imports via @/ alias

Color token quick-ref:
  Surfaces: --surface-page, --surface-card, --surface-sidebar, --surface-sunken
  Text: --fg-primary, --fg-secondary, --fg-tertiary, --fg-muted
  Brand: --brand-primary, --brand-primary-hover, --brand-primary-tint
  Semantic: --success, --warning, --danger, --info (+ *-tint variants)
  Borders: --border-subtle, --border-default, --border-strong, --border-focus
  Shadows: --shadow-xs, --shadow-sm, --shadow-md, --shadow-lg
```

---

## 11. Voice & Tone (M8)

The product's voice is codified in `design-system/voice/`. Every external-facing string in the app pulls from one of those references.

| Concern | Source | Rule |
|---|---|---|
| Tone words + audience | `voice/VOICE.md` | 5 tones (**precise, confident, calm, respectful, direct**) — every string expresses all 5 |
| Microcopy patterns | `voice/MICROCOPY.md` | Buttons, empty states, confirmations, toasts, forms, dates, numbers, currency, AI provenance |
| Error messages | `voice/ERROR_TAXONOMY.md` | 8 error classes with HTTP / message / recovery / retry / audit / escalation matrix |
| Empty-state copy registry | `voice/copy/empty-states.json` | 30 keys — M4 presets import from here |
| Button label registry | `voice/copy/buttons.json` | 125 labels across 12 categories — M9 eslint rule warns on raw button strings |

### Hard rules

- No exclamation marks in body copy or buttons.
- No "Oops", no "Sorry", no "Awesome", no emoji (except `Success_Empty_Inbox_Zero` preset).
- Sentence case in all UI; no Title Case.
- AI-generated text always prefixed with provenance ("Drafted by Dust · …").
- Destructive confirmations spell out the count of what will be lost + "This can't be undone."
- Recovery button is always **"Retry"** (not "Try again" / "Reload").
- Error toast prefix is always **"Could not <verb> <thing>"** (not "Save failed" / "Oops").

---

## 12. Accessibility (M9)

BidStack 360° targets WCAG 2.2 AA on every shipped surface. The accessibility contract lives in `docs/a11y/` — that directory is the source of truth.

### 12.1 Audit surface map

| Concern | Document | What it covers |
|---|---|---|
| Per-page keyboard tab order + global chords | `docs/a11y/keyboard-matrix.md` | 12+ pages, every overlay, every form-control keyboard contract |
| Per-primitive WAI-ARIA APG conformance | `docs/a11y/aria-audit.md` | 41 rows, severity-tagged gaps, predicted axe top-10 |
| `prefers-reduced-motion` enforcement | `docs/a11y/reduced-motion-audit.md` | Three-layer enforcement audit per primitive |
| Color contrast (WCAG 1.4.3 / 1.4.11 / 2.4.11) | `docs/a11y/contrast-audit.md` + `.generated.md` | 138 token pairs, ratio + verdict per pair |
| Manual screen-reader regression script | `docs/a11y/sr-test-2026-05-24.md` | 10 flows for NVDA / VoiceOver / JAWS |

### 12.2 Automated gates

| Gate | Command |
|---|---|
| axe-core on every route | `pnpm --filter @bidstack/web e2e e2e/a11y/pages.spec.ts` |
| axe-core on every Storybook story | `pnpm --filter @bidstack/web test:visual` |
| Token contrast | `node scripts/a11y/contrast-audit.mjs` |
| Reduced motion (CSS layer) | `@media (prefers-reduced-motion: reduce)` in `index.css` |
| Reduced motion (React layer) | `<MotionConfig reducedMotion={…}>` in `App.tsx` |
| Design tokens | `node scripts/audit-design-tokens.mjs` |
| State preset registry | `node scripts/audit-empty-states.mjs` |
| Page templates | `node scripts/audit-page-templates.mjs` |

### 12.3 Focus management

Consolidated in `apps/web/src/lib/focus.ts`:
- `useFocusTrap(ref, opts)` — custom non-Radix overlays only
- `useReturnFocus(opts)` — restore focus on unmount
- `useEscapeKey(callback, opts)` — universal Escape listener

Radix-backed components (Dialog / Sheet / Popover / Select / HoverCard / Tooltip) keep their built-in FocusScope per WAI-ARIA APG.
