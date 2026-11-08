# DESIGN.md — BidStack 360°

> **Status:** v1.0.0 — Seed document  
> **Authority:** This file is the single source of truth for all design decisions. Any design change must trace to a Principle in this document.  
> **Maintainer:** Agent #5 (Design Curator)  
> **Last updated:** 2026-05-22

---

## 0. Principles

These 5 principles override any specific token or component decision. When in doubt, prefer the Principle.

### P1 — Clarity Over Decoration

Every pixel must serve comprehension. If removing an element doesn't reduce understanding, remove it.

### P2 — Progressive Disclosure

Show the minimum viable information density for the current context. Details are one click away, never zero.

### P3 — Consistent Feedback

Every user action produces immediate, predictable feedback. No silent failures. No mystery meat navigation.

### P4 — Respect the User's Context

Dark mode, reduced motion, high contrast, and screen readers are not features — they are baseline requirements.

### P5 — Performance is Design

A slow UI is a broken UI. Skeleton screens beat spinners. Instant beats fast.

---

## 1. Design Tokens

### 1.1 Color

Source of truth: `apps/web/src/index.css`. All UI must use CSS variables. No hex literals in component files.

#### Light Mode

| Token                  | Value     | Usage                                         |
| ---------------------- | --------- | --------------------------------------------- |
| `--brand-primary`      | `#2C4BFF` | Primary buttons, active nav, links            |
| `--brand-primary-tint` | `#EAEEFE` | Selected rows, focus halos, hover backgrounds |
| `--surface-page`       | `#FAFBFD` | App background                                |
| `--surface-card`       | `#FFFFFF` | Card background                               |
| `--surface-sidebar`    | `#F4F6FA` | Left navigation surface                       |
| `--surface-elevated`   | `#FFFFFF` | Modals, dropdowns, popovers                   |
| `--fg-primary`         | `#1A1F36` | Body copy, headings                           |
| `--fg-secondary`       | `#5A6478` | Subtext, captions, placeholders               |
| `--fg-tertiary`        | `#8F97A3` | Disabled text, timestamps                     |
| `--border-default`     | `#E2E4EA` | Card borders, dividers                        |
| `--border-focus`       | `#2C4BFF` | Focus rings                                   |
| `--success`            | `#1F8A5B` | Positive states, win indicators               |
| `--warning`            | `#D08A00` | Caution states, stale data                    |
| `--danger`             | `#D93849` | Errors, deletions, losses                     |
| `--info`               | `#6E59FF` | Informational badges, tips                    |

#### Dark Mode

| Token                  | Value                   | Usage                                |
| ---------------------- | ----------------------- | ------------------------------------ |
| `--brand-primary`      | `#5B7FFF`               | Elevated luminance for dark contrast |
| `--brand-primary-tint` | `rgba(91,127,255,0.12)` | Transparent tint for flexibility     |
| `--surface-page`       | `#0D0F1A`               | Deep background                      |
| `--surface-card`       | `#161922`               | Card background                      |
| `--surface-sidebar`    | `#11131C`               | Slightly darker than page for depth  |
| `--surface-elevated`   | `#1E212B`               | Modals, dropdowns                    |
| `--fg-primary`         | `#E8EAF0`               | Body copy                            |
| `--fg-secondary`       | `#9AA2B2`               | Subtext                              |
| `--fg-tertiary`        | `#5F677A`               | Disabled text                        |
| `--border-default`     | `#2A2E3B`               | Subtle borders                       |
| `--border-focus`       | `#5B7FFF`               | Focus rings                          |
| `--success`            | `#3DBA7A`               | Brightened for dark                  |
| `--warning`            | `#F5A623`               | Brightened for dark                  |
| `--danger`             | `#FF5C5C`               | Brightened for dark                  |
| `--info`               | `#8C7BFF`               | Brightened for dark                  |

#### Contrast Requirements (WCAG 2.2 AA)

- Normal text (≤18px): ≥4.5:1 against background
- Large text (>18px bold / >24px): ≥3:1 against background
- UI controls / icons: ≥3:1 against adjacent colors
- Focus indicators: ≥3:1 against all adjacent colors, 2px minimum thickness

### 1.2 Typography

| Role    | Font              | Weights       | Usage                    |
| ------- | ----------------- | ------------- | ------------------------ |
| Sans    | Inter             | 400, 500, 600 | Body, UI labels, buttons |
| Display | Plus Jakarta Sans | 600, 700      | H1, H2 only              |
| Mono    | JetBrains Mono    | 400, 500      | Codes, audit IDs, money  |

#### Type Scale (9 steps)

| Token       | Size | Line Height | Letter Spacing | Usage                   |
| ----------- | ---- | ----------- | -------------- | ----------------------- |
| `text-2xs`  | 10px | 14px        | 0.02em         | Timestamps, metadata    |
| `text-xs`   | 12px | 16px        | 0.01em         | Captions, badges        |
| `text-sm`   | 13px | 18px        | 0              | Form labels, secondary  |
| `text-base` | 14px | 20px        | 0              | Body copy               |
| `text-md`   | 17px | 24px        | -0.01em        | Lead paragraphs         |
| `text-lg`   | 22px | 28px        | -0.02em        | Section titles          |
| `text-xl`   | 28px | 34px        | -0.02em        | Page titles             |
| `text-2xl`  | 36px | 42px        | -0.03em        | H1, dashboard headers   |
| `text-3xl`  | 48px | 54px        | -0.03em        | Marketing, empty states |

**Numerals:** `font-variant-numeric: tabular-nums` on all monetary values, percentages, counts.

### 1.3 Spacing

8px spatial grid. All spacing values must be multiples of 4px (minimum 4px).

| Token      | Value | Usage                      |
| ---------- | ----- | -------------------------- |
| `space-1`  | 4px   | Tight inline gaps          |
| `space-2`  | 8px   | Default inline gap         |
| `space-3`  | 12px  | Small padding              |
| `space-4`  | 16px  | Card padding, section gaps |
| `space-5`  | 20px  | Form field gaps            |
| `space-6`  | 24px  | Modal padding              |
| `space-7`  | 32px  | Section separation         |
| `space-8`  | 40px  | Page margins               |
| `space-9`  | 48px  | Large page margins         |
| `space-10` | 64px  | Hero spacing               |

### 1.4 Radius

| Token         | Value | Usage                       |
| ------------- | ----- | --------------------------- |
| `radius-sm`   | 6px   | Small buttons, tags, inputs |
| `radius-md`   | 8px   | Buttons, badges             |
| `radius-lg`   | 10px  | Small cards, dropdowns      |
| `radius-xl`   | 14px  | Cards, modals               |
| `radius-full` | 999px | Pills, avatars              |

### 1.5 Shadow

| Token          | Light Mode                            | Dark Mode                             | Usage            |
| -------------- | ------------------------------------- | ------------------------------------- | ---------------- |
| `shadow-sm`    | `0 1px 2px rgba(0,0,0,0.04)`          | `0 1px 2px rgba(0,0,0,0.24)`          | Subtle elevation |
| `shadow-md`    | `0 4px 12px rgba(0,0,0,0.06)`         | `0 4px 12px rgba(0,0,0,0.32)`         | Cards, dropdowns |
| `shadow-lg`    | `0 12px 32px rgba(0,0,0,0.08)`        | `0 12px 32px rgba(0,0,0,0.40)`        | Modals, popovers |
| `shadow-focus` | `0 0 0 2px var(--brand-primary-tint)` | `0 0 0 2px var(--brand-primary-tint)` | Focus rings      |

### 1.6 Motion

**Easing:** `cubic-bezier(0.2, 0.8, 0.2, 1)` (Twenty/Linear standard)

**Durations:**
| Token | Value | Usage |
|-------|-------|-------|
| `duration-fast` | 120ms | Hover states, micro-feedback |
| `duration-normal` | 150ms | Button presses, toggles |
| `duration-menu` | 220ms | Dropdowns, tooltips |
| `duration-modal` | 320ms | Modals, panels |

**Reduced Motion:** All transitions collapse to `0.01ms` when `prefers-reduced-motion: reduce` is active. No exceptions.

### 1.7 SERUM Glass

SERUM screens use the existing BidStack system with a restrained control-plane layer, not a separate theme.

| Token                      | Usage                                        |
| -------------------------- | -------------------------------------------- |
| `--serum-glass-bg`         | Translucent control-plane panels             |
| `--serum-glass-border`     | Quiet glass panel border                     |
| `--serum-glow`             | Rare elevated status glow                    |
| `--serum-accent-cyan`      | Live/system signals                          |
| `--serum-accent-violet`    | Model/router signals                         |
| `--serum-accent-blue`      | Primary SERUM action and focus accents       |
| `--serum-success-soft`     | Source-backed ready/success state background |
| `--serum-warning-soft`     | Attention state background                   |
| `--serum-danger-soft`      | Disabled/error state background              |

SERUM motion is calm: short fades, small y/scale movement, no decorative blobs, no fake live pulses unless a real source timestamp exists. Disabled and not-configured states are first-class states, not empty polish gaps.

---

## 2. Components

Every interactive component ships **all 9 states**: Default, Hover, Focus (2px ring, 3:1 contrast), Active, Loading, Error, Empty, Disabled, Success.

### 2.1 Button

| Variant | Size | Height | Padding | Radius | Font     |
| ------- | ---- | ------ | ------- | ------ | -------- |
| Primary | sm   | 32px   | 0 12px  | 8px    | 13px/500 |
| Primary | md   | 40px   | 0 16px  | 8px    | 14px/500 |
| Primary | lg   | 48px   | 0 24px  | 8px    | 15px/500 |

**States:**

- **Default:** `bg-brand-primary text-white`
- **Hover:** `brightness(1.1)` + `shadow-sm`
- **Focus:** `ring-2 ring-brand-primary-tint ring-offset-2`
- **Active:** `scale(0.98)` + `brightness(0.95)`
- **Loading:** Spinner replaces text, `opacity-70`, `cursor-wait`
- **Error:** `bg-danger`, shake animation (320ms)
- **Empty:** N/A (buttons are never empty)
- **Disabled:** `opacity-40`, `cursor-not-allowed`, no hover effects
- **Success:** `bg-success`, checkmark icon, auto-revert after 2s

**Secondary:** `bg-surface-card border border-default text-fg-primary`. Hover: `bg-surface-sidebar`.
**Ghost:** Transparent. Hover: `bg-brand-primary-tint`.
**Destructive:** `bg-danger`. Only for irreversible actions.

### 2.2 Card

| Property   | Value                          |
| ---------- | ------------------------------ |
| Background | `surface-card`                 |
| Radius     | 14px                           |
| Padding    | 24px (default), 16px (compact) |
| Shadow     | `shadow-md`                    |
| Border     | 1px `border-default` (subtle)  |

**States:**

- **Default:** As above.
- **Hover:** `shadow-lg` (only if clickable).
- **Focus:** `ring-2 ring-brand-primary-tint` (only if clickable).
- **Active:** `scale(0.995)`.
- **Loading:** Skeleton overlay with pulse animation.
- **Error:** Left border 3px `danger`, error message in card body.
- **Empty:** Centered icon + text + CTA button.
- **Disabled:** `opacity-50`, no interactions.
- **Success:** Top border 3px `success`, optional confetti (reduced motion: none).

### 2.3 Badge

| Tone   | Background            | Text                  | Usage              |
| ------ | --------------------- | --------------------- | ------------------ |
| Blue   | `brand-primary-tint`  | `brand-primary`       | Default, info      |
| Jade   | `#E6F5ED` / `#1A3A2A` | `#1F8A5B` / `#3DBA7A` | Success, won       |
| Amber  | `#FDF5E6` / `#3A2A1A` | `#D08A00` / `#F5A623` | Warning, pending   |
| Tomato | `#FDEBEC` / `#3A1A1A` | `#D93849` / `#FF5C5C` | Danger, lost       |
| Purple | `#F0EBFF` / `#2A1A3A` | `#6E59FF` / `#8C7BFF` | Info, AI-generated |
| Gray   | `#F0F1F5` / `#2A2E3B` | `#5A6478` / `#9AA2B2` | Neutral, archived  |

**Stage mapping:** `stageTone()` function maps pipeline stage → badge tone.

### 2.4 Input

| Property      | Value                              |
| ------------- | ---------------------------------- |
| Height        | 40px                               |
| Padding       | 0 12px                             |
| Radius        | 8px                                |
| Border        | 1px `border-default`               |
| Background    | `surface-card`                     |
| Focus border  | `border-focus`                     |
| Focus ring    | `shadow-focus`                     |
| Error border  | `danger`                           |
| Error message | 12px `danger`, below input         |
| Placeholder   | `fg-tertiary`                      |
| Disabled      | `opacity-50`, `bg-surface-sidebar` |

### 2.5 Table

- Row height: 48px
- Header: 40px, `text-xs uppercase tracking-wider`, `fg-secondary`
- Row hover: `bg-brand-primary-tint` at 50% opacity
- Selected row: `bg-brand-primary-tint`
- Sort indicator: Chevron, `brand-primary` when active
- Empty state: Centered illustration + "No results" + optional CTA
- Loading: 8 skeleton rows, pulse animation
- Zebra: **No** (rejected in taste_profile)

### 2.6 Modal / Dialog

- Width: 480px (default), 640px (wide), 960px (full)
- Radius: 14px
- Shadow: `shadow-lg`
- Backdrop: `rgba(0,0,0,0.4)` with `backdrop-blur-sm`
- Entry: `scale(0.95) → scale(1)` + `opacity 0→1`, 220ms
- Exit: Reverse, 150ms
- Focus trap: First focusable element or close button
- Close: Escape key, backdrop click, or X button (top-right)

### 2.7 Toast / Notification

- Position: Top-right (desktop), bottom (mobile)
- Max width: 400px
- Auto-dismiss: 5s (success), 10s (error), persistent (action required)
- Progress bar: Thin line at bottom, animates width 100%→0%
- Types: Success, Error, Warning, Info
- Stacking: Max 3 visible, older fade out

### 2.8 Sidebar Navigation

- Width: 256px (expanded), 72px (collapsed), 0 (mobile overlay)
- Background: `surface-sidebar`
- Item height: 40px
- Active item: `bg-brand-primary-tint`, `brand-primary` icon + text
- Hover item: `bg-surface-page` (light) / `bg-surface-card` (dark)
- Collapse toggle: Bottom of sidebar, chevron icon
- Mobile: Sheet overlay from left, 280px width

### 2.9 Command Palette

- Trigger: `Ctrl+K` (Windows/Linux), `Cmd+K` (Mac)
- Modal: Centered, max-width 640px, max-height 480px
- Input: Full width, top of modal, auto-focused
- Results: Grouped by category (Pages, Actions, Recent)
- Highlight: `bg-brand-primary-tint`, `brand-primary` text
- Empty: "No results for \"{query}\""
- Keyboard: ↑↓ to navigate, Enter to select, Esc to close

---

## 3. Patterns

### 3.1 Form Layout

- Label above input (never placeholder-as-label)
- Label: `text-sm font-medium fg-primary`
- Help text: `text-xs fg-secondary`, below input
- Error text: `text-xs danger`, below input, replaces help text
- Submit button: Primary, left-aligned with form
- Cancel button: Ghost, to the left of submit
- Required indicator: `*` in `danger`, after label

### 3.2 Data Loading

**Prefer skeleton screens over spinners.**

| Scenario          | Pattern                               |
| ----------------- | ------------------------------------- |
| Page initial load | Skeleton cards + skeleton table rows  |
| Inline update     | Optimistic UI + toast on completion   |
| Search/filter     | Debounce 300ms + skeleton list        |
| Infinite scroll   | Skeleton row at bottom while fetching |
| Button action     | Button loading state + spinner        |

### 3.3 Empty States

Every list, table, and dashboard widget must have an empty state.

- Icon: 48px, `fg-tertiary`
- Title: `text-lg font-medium fg-primary`
- Description: `text-sm fg-secondary`, max 2 lines
- CTA: Primary button if user can create content

### 3.4 Error Handling

| Level            | Pattern                                  |
| ---------------- | ---------------------------------------- |
| Global fatal     | Full-page error boundary with retry CTA  |
| Section error    | Card with error border + message + retry |
| Inline error     | Input error state + message              |
| Background error | Toast notification                       |

### 3.5 Confirmation Patterns

| Action Severity                    | Pattern                                             |
| ---------------------------------- | --------------------------------------------------- |
| Low (toggle, filter)               | Immediate, no confirmation                          |
| Medium (delete item)               | Inline confirmation or undo toast                   |
| High (delete account, bulk delete) | Modal with typed confirmation                       |
| Critical (irreversible data loss)  | Modal + typed confirmation + secondary confirmation |

---

## 4. Pages

### 4.1 Global Layout

```
+------------------------------------------+
|  Topbar (56px)                           |
|  [Sidebar toggle] [Search] [Notif] [User]|
+----------+-------------------------------+
| Sidebar  | Main Content Area             |
| (256px)  |                               |
|          |                               |
+----------+-------------------------------+
```

- Topbar: Fixed, z-index 50, `surface-card` with `shadow-sm`
- Sidebar: Fixed left, z-index 40, scrollable independently
- Main: `margin-left: 256px`, `min-height: calc(100vh - 56px)`, `bg-surface-page`
- Mobile: Sidebar becomes overlay sheet, main margin-left 0

### 4.2 Dashboard

- KPI cards: 4-column grid (2 on tablet, 1 on mobile)
- Charts: Responsive height 320px
- Activity feed: Right rail on xl screens, bottom section on smaller
- Quick actions: Floating action button on mobile, topbar dropdown on desktop

### 4.3 Pipeline (Kanban)

- Columns: Horizontal scroll, min-width 280px per column
- Cards: Compact variant, 72px height, drag handle on left
- Column header: Stage name + count badge + add button
- Overflow: Scroll within column, max-height `calc(100vh - 200px)`
- Drag: Visual lift shadow, drop target outline, keyboard accessible

### 4.4 Opportunity Detail

- Header: Back button, title, stage badge, actions dropdown
- Tabs: Overview, Activity, Contacts, Documents, Timeline
- Sidebar: Key fields, related records, AI suggestions
- Forms: Inline edit on click, save on blur or explicit save

### 4.5 Settings

- Left sub-nav: Settings categories
- Right content: Form fields per category
- Danger zone: Separated by `danger` tinted border, at bottom
- Save: Per-section save buttons (not global), with unsaved change indicator

---

## 5. Accessibility

### 5.1 Keyboard Navigation

- `Tab` / `Shift+Tab`: Move focus through interactive elements
- `Enter` / `Space`: Activate buttons, links, toggles
- `Escape`: Close modals, dropdowns, palettes
- `Arrow keys`: Navigate lists, tables, menus, kanban cards
- `Home` / `End`: Jump to start/end of lists
- `Ctrl+K`: Open command palette
- Focus visible: 2px `brand-primary-tint` ring, 3:1 contrast
- Skip link: "Skip to content" link at top of page, visible on focus

### 5.2 Screen Reader

- All images have `alt` text (decorative images: `alt=""`)
- Icon-only buttons have `aria-label`
- Live regions for dynamic updates (toast, notifications, drag status)
- Form errors linked via `aria-describedby`
- Page title updates on route change
- Landmarks: `<header>`, `<nav>`, `<main>`, `<aside>`

### 5.3 Motion

- `prefers-reduced-motion: reduce` → all transitions to `0.01ms`
- No auto-playing animations
- No parallax
- Essential motion (drag feedback) uses instant snap instead of animation

---

## 6. Responsive Breakpoints

| Name  | Width  | Layout Changes                             |
| ----- | ------ | ------------------------------------------ |
| `sm`  | 640px  | Single column forms, stacked cards         |
| `md`  | 768px  | Sidebar collapses to icons, 2-column grids |
| `lg`  | 1024px | Full sidebar, 3-column grids               |
| `xl`  | 1280px | 4-column grids, activity rail appears      |
| `2xl` | 1536px | Max content width 1440px, centered         |

---

## 7. Asset Guidelines

- **Icons:** Lucide React only. No custom SVGs unless absolutely necessary.
- **Images:** WebP/AVIF format, lazy loading, responsive `srcset`
- **Fonts:** Self-hosted or Google Fonts with `display: swap`
- **Favicon:** `favicon.ico` + `apple-touch-icon.png` in `apps/web/public/`

---

## 8. Change Log

| Version | Date       | Change                | Agent |
| ------- | ---------- | --------------------- | ----- |
| 1.0.0   | 2026-05-22 | Initial seed document | #5    |
| 3.0.0   | 2026-11-06 | Enterprise upgrade addendum (section 9): TUFFUI token map, motion tokens, components, layout, copy, a11y. Sections 1 to 7 above are stale on tokens; `docs/DESIGN.md` and `apps/web/src/index.css` win. | factory-0 (Cursor) |

---

_DESIGN.md is a living document. Every design decision must be traceable to a Principle. When taste_profile.json evolves, update the relevant sections here._

---

## 9. v3.0.0 (2026-11-06): Enterprise upgrade addendum

Appended by factory slice 0. Earlier sections are kept as history. Where they disagree with this
section, this section wins; where this section is silent, `docs/DESIGN.md` (green visual system) and
the live values in `apps/web/src/index.css` win. Backup of the prior file: `DESIGN.backup-2026-11-06.md`.

Ground truth on `main` (`ad2d0839`):

- Tailwind **4.3.3**, CSS-first via `@tailwindcss/vite`. No `tailwind.config.*`. Tokens are CSS variables
  in `apps/web/src/index.css` (`:root` / `[data-theme='light']`, `[data-theme='dark']`) bridged into
  utilities by one `@theme` block. Dark mode is `data-theme`, not `prefers-color-scheme`.
- Brand is green: `--brand-primary` `#006b4f` (light), `#00805e` (dark fill), `--brand-deep` `#3fbe93`
  (dark foreground accent). The blue values in sections 1 to 3 and in ADR 0005 are stale.
- Design law is enforced by ESLint (`packages/eslint-rules/design-law.js`): `no-foreign-token-vocabulary`,
  `no-arbitrary-geometry`, `no-theme-variant-geometry` (errors), `no-raw-hex-in-classname` (warn).
  ADR 0002: tokens change value, never name; no second vocabulary.
- Class merge helper is `@/lib/cn` (clsx + tailwind-merge). There is no `@/lib/utils`.

### 9.1 Tokens: TUFFUI to repo

TUFFUI (MIT, https://github.com/yurigdesigner/tuffui, pinned `378f3eaac693c693d2ec845baf38bf6c0488cb37`)
ships shadcn-style names. Rewrite every class at import; never add the TUFFUI names to `@theme`.

| TUFFUI class / token | Repo class | Note |
|---|---|---|
| `text-foreground` | `text-fg-primary` | |
| `text-muted-foreground` | `text-fg-secondary` | tertiary copy: `text-fg-tertiary` |
| `text-foreground/NN`, `bg-foreground/NN` | `text-fg-primary/NN`, `bg-fg-primary/NN` | keep the opacity step |
| `bg-background` | `bg-surface-page` | |
| `bg-surface` (outer shell) | `bg-surface-shell` | new token, see below |
| `bg-surface-inset` (inner panel) | `bg-surface-inset` | new token, see below |
| `bg-surface-raised` (control) | `bg-surface-hover` | |
| `bg-brand` | `bg-brand` | |
| `text-brand`, `fill-brand`, `stroke-brand` | `text-brand-deep`, `fill-brand-deep`, `stroke-brand-deep` | contrast-safe in both themes |
| `text-brand-foreground` | `text-fg-on-brand` | |
| `positive` | `success` (+ `success-tint`) | |
| `negative` | `danger` (+ `danger-tint`) | |
| `warning` | `warning` (+ `warning-tint`) | |
| `border-border` | `border-[var(--border-subtle)]` or `border-border-subtle` | strong: `border-border-strong` |
| `ring` / focus | `--border-focus` | |
| hex palettes (agent-avatar, diverging-bars, iso-bars) | `var(--chart-1)` .. `var(--chart-8)` | chart palette is an allowed exemption |

New tokens (value-only additions, both themes, added to `:root`, `[data-theme='dark']` and `@theme`):

| Token | Light | Dark | Purpose |
|---|---|---|---|
| `--surface-shell` | `#f0f0f0` | `#121214` | outer shell of a dense panel |
| `--surface-inset` | `#ffffff` | `#0c0c0e` | inner panel inside a shell |

Geometry: shell `rounded-xl` (12px), inset `rounded-lg` (8px), controls and pills `rounded-md` (5px).
Replace TUFFUI `rounded-[1.375rem]`, `rounded-[1.5rem]`, `p-[2px]` with scale steps. Drop
`shadow-[...]` and `dark:shadow-[...]`; separation comes from surface steps and `--border-subtle`.
Fonts stay on the repo system stacks.

### 9.2 Motion tokens

Add to `@theme` (CSS) and vendor `lib/motion-tokens.ts` (TS) with the same values:

| Token | Value | Use |
|---|---|---|
| `--ease-ui-out` / `EASE_OUT` | `cubic-bezier(0.23, 1, 0.32, 1)` | enter, hover, press |
| `--ease-ui-in-out` / `EASE_IN_OUT` | `cubic-bezier(0.77, 0, 0.175, 1)` | move, reorder |
| `--ease-drawer` | `cubic-bezier(0.32, 0.72, 0, 1)` | drawers and sheets |
| `--duration-enter` | `210ms` (exists) | TUFFUI `enter` 0.2s maps here |
| `--duration-exit` | `150ms` (exists) | TUFFUI `exit` 0.14s maps here |
| `--duration-move` | `400ms` (exists) | layout moves only |
| `spring` | `{ type: 'spring', duration: 0.3, bounce: 0 }` | `motion` / framer only |

Rules: nothing over 300ms except layout moves; animate transform and opacity only; every animated
component reads `useReducedMotion()` and falls back to `instant` (`duration: 0`). Keep using
`apps/web/src/lib/motion.ts`; `motion-tokens.ts` re-exports from it where values match.

### 9.3 Components

Vendor path: `apps/web/src/components/vendor/tuffui/<name>.tsx`, plus `LICENSE` (full MIT text) in that
folder. Keep each file header verbatim:
`// TUFFUI (https://tuffui.com) · MIT License · Copyright (c) 2026 TUFFUI contributors`.
Add one line under it listing the rewrites made (table-kit precedent). Swap Phosphor icons for Lucide
(section 7).

| Component | Source | Use in Polo |
|---|---|---|
| StatusPill, Tag | `registry/status-pill/status-pill.tsx` | delivery status, policy effect, endpoint state |
| AgentConsole | `registry/agent-console/` (+ run-trace, tool-approval-queue, usage-summary, rate-limits, progress-bar, eval-results, context-window-meter, background-agents) | SERUM agent runs, approvals |
| DotHistogram | `registry/dot-histogram/` | webhook response-time distribution |
| RadialDots | `registry/radial-dots/` | success-rate gauge |
| MatchField | `registry/match-field/` | policy condition builder (When / Except) |
| RadarChart | `registry/radar-chart/` | bid scoring |
| DivergingBars | `registry/diverging-bars/` | policy impact preview (gained vs lost access) |
| IsoBars | `registry/iso-bars/` | volume by event type |
| HexDensity | `registry/hex-density/` | delivery heatmap |

Reference screens are style input only: dark delivery heatmap with gauge; message log with dot timeline
and attempts / replay; retry step chart, response-time histogram, endpoint form; light access-policy
builder with When / Then / Except, impact preview, publish version. Do not copy any third-party product
names or copy into Polo.

### 9.4 Layout rules

- App frame unchanged: 56px icon rail, `PageShell` `max-w-7xl`, one vertical scroll per page (no nested
  scroll areas except logs and tables with a fixed header).
- Dense panels use shell + inset: `bg-surface-shell rounded-xl p-1` wrapping `bg-surface-inset rounded-lg`.
- Side panels (message detail, policy editor) become a drawer below `56rem` container width, using
  container queries (native in Tailwind 4: `@container`, `@4xl:`). Drawer closes on Escape and returns
  focus to the trigger.
- Collapsible rails: 64px collapsed, 232px expanded.
- Charts sit in an inset with a one-line title and a value; legends only when there are more than two
  series.

### 9.5 Copy rules

- Cut taglines, helper text under labels, and secondary labels that repeat the primary. One title, one
  value, one action per card.
- Empty states: one sentence, one action.
- No em dashes in new copy; no banned AI words (vault `Preferences/dont.md`).
- **Never cut or reword the pinned consent and safety copy below.** Slice agents must add a test that
  pins these strings (keys in `public/locales/en/*.json` and the inline defaults) before cutting any
  copy. Captured verbatim from `main` `ad2d0839` (quoted UI text, so original punctuation is kept).
  The three signature lines were realigned to `main` after #304: the page and the PDF say this is an
  internal approval signature, not a legally binding e-signature.

```text
# Signatures (PublicSignPage, signatures.json)
This is an internal approval signature, not a legally binding e-signature. This page contains no tracking technologies.
I understand this is an internal approval signature, not a legally binding e-signature, and that it represents my intent to approve this document. I have had the opportunity to review its contents.
{{senderName}} has been notified. A copy of the signed document will be sent to your email address.
I understand this electronic signature is an internal approval signature, not a legally binding e-signature.

# SMS (SmsComposerModal)
This number has requested to stop receiving SMS. Sending is blocked (TCPA compliance).
This message will be sent as {{count}} segments (billed per segment by Twilio).

# Secrets shown once (ApiKeysSection, WebhooksSection, MeetingSourcesSection)
Copy the secret now — it will not be shown again.
You'll see the secret exactly once — copy it before closing.
Copy your new key now — it won't be shown again.
Any client using this key will start failing immediately. This cannot be undone.
Copy the signing secret now
Store this secret in the receiver for
It will not be shown again.
Webhooks are limited to administrators
Webhook subscriptions can push sensitive platform data to external systems, so only admins can view, create, test, pause, or delete them.
The endpoint will stop receiving Polo PreSales events immediately. Delivery history is retained.
Copy this token now. It is shown once and Polo keeps only its fingerprint.

# AI disclosure and review
AI-assisted draft — review before sending
These are AI suggestions only. Review before applying to the deal.
Open-web signal; verify before treating as a Mantu fact.
{{label}} open-web feed checked at {{fetchedAt}} with {{confidence}}% source confidence. Verify before treating it as a Mantu fact.
Source: Google News · verify before treating as a Mantu fact.
Human Review: Pre-Drafting Gate
Extracted fields applied — review before saving
Apply extracted fields (review before saving)
Verify before staging

# Transcripts and data privacy
Show transcript (shared with consent)
No transcript stored. Transcripts are kept only when a Métis user opts in.
No transcript is stored for manual entries.
Data privacy:
Model artifacts contain only learned weights — no raw deal data, names, or emails. Each org trains its own isolated model. Scores are cached for 1 hour in Redis and invalidated on record updates.
Phone numbers and contact leads are not stored
Secrets stay server-side. Add them to local/production env, then restart worker/API.
Create read/write keys only for the exact workflow and keep secrets server-side.
No secrets sent
Raw API keys, passwords, credentials, and secrets are rejected server-side. Use secretRef fields.
Enrichment falls back to free open data. The stored key is removed.
Only admins can manage data-source keys.

# Governance
Standing decision: an opportunity with a recorded No-Go / No-Bid cannot advance until a positive gate or a justified override is on record.

# Destructive actions
This permanently removes "{{name}}". This cannot be undone.
This permanently removes the proposal and all its sections. This cannot be undone.
This will permanently delete the object definition and all records belonging to it. This action cannot be undone.
This action cannot be undone.
Delete all demonstration data? This action cannot be undone.
"{{name}}" will be removed. This can't be undone.
{{recordKey}} will be soft-deleted. It can be restored via the API.
```

### 9.6 Accessibility rules

- WCAG 2.2 AA in both themes. Body text 4.5:1, large text and UI parts 3:1. Use `brand-deep` for
  brand-coloured text on dark surfaces.
- Status is never colour alone: StatusPill carries text and an icon; heatmap cells and dots carry an
  accessible name with value and time.
- Every chart has a text alternative: a visually hidden summary plus a "View as table" toggle for
  HexDensity, DotHistogram, DivergingBars and IsoBars.
- Keyboard: all controls reachable in order; Escape closes drawers and popovers; focus returns to the
  trigger; visible focus ring from `--border-focus`. MatchField rule rows are reorderable by keyboard.
- Live regions: delivery replay and policy publish results announce via `aria-live="polite"`.
- Reduced motion honoured everywhere (9.2). Hit targets at least 24 x 24 px.
- Lighthouse a11y stays at 100 on `/login` and `/dashboard` (baseline in `docs/factory/RECON.md`).

### 9.7 Account direction (slice 12)

One section on the account page, after "What to position": where the company is heading.

- Tabs, in order: Direction (default), Hiring, Financials, News and posts. `role="tablist"`, arrow keys move between tabs.
- Direction: headline, cited claims, three columns (Investing, Cutting, Next 12 months), then bid relevance rows (offering, pitch, next step).
- Every line names its basis. Observed and Stated are plain; Inferred carries an "Inferred" tag. Each line links its evidence: source label, year or date, and the excerpt on hover or focus.
- Hiring: open roles as a big number, 30 and 90 day trend with arrows, a six month bar strip, function mix, top skills, recent postings with source.
- Financials: one row per fiscal year with source and year on every row; registry facts below; the Apollo range only as a labelled fallback.
- News and posts: one list, newest first, each item with a kind label (Product, Partnership, Acquisition, Leadership, Results, Layoffs, Expansion) and origin (company or press).
- Sources strip at the foot of every tab: Job boards, Company posts, Filings, Registries. Each row shows status as text plus icon, last fetched time, the result (new, updated, failed) and a Refresh button (lucide `RefreshCw`) for users with `account-intel:write`. Not configured rows name the env var to set.
- Sample data carries the "Sample" tag. No taglines or helper text. Tokens: signals `.sg` variables, accent `--brand-primary` (#006b4f), both themes, 12px card radius, tabular numbers.

### 9.8 Slice 1 as built (2026-11-06)

Appended by factory slice 1. Values only; no existing token changed.

- Surfaces: `--surface-shell` and `--surface-inset` in both theme blocks, bridged as
  `bg-surface-shell` and `bg-surface-inset`.
- Status aliases: `--color-positive(-tint)` and `--color-negative(-tint)` in `@theme` point at
  `--success(-tint)` and `--danger(-tint)`; `warning` already existed. They exist so vendored chart
  fills keep one meaning across themes. New code still writes `success` and `danger`.
- Motion: `--ease-ui-out`, `--ease-ui-in-out`, `--ease-drawer` in `@theme` (utilities `ease-ui-out`
  and so on), mirrored in `apps/web/src/lib/motion-tokens.ts` with `enter` (210ms), `exit` (150ms),
  `spring`, `instant` and `motionFor(reduced, transition)`. A contract test keeps CSS and TS equal.
- Components: `components/vendor/tuffui/status-pill.tsx` (`StatusPill` with filled lucide glyphs,
  `Tag`) and `surface.tsx` (`Shell`, `Panel`, `Inset`, `IconTile`, `ShellHeader`), plus `LICENSE`.
- Lint ratchet: `no-foreign-token-vocabulary` now also bans bare `text-foreground`, `bg-foreground`,
  `text-background`, `bg-background`, `fill-foreground`, `stroke-foreground`. The last live
  leftovers (funnel-chart, sankey-node, chart-stat-flow) now use `fg-*` tokens.
- Copy: the 9.5 list is pinned by `apps/web/src/copy/consent-copy.pinned.test.ts`, which also checks
  that it matches the block above. The cut list lives in `main-screen-copy-cut.contract.test.ts`.

### 9.16 Technology stack from open data (slice 16)

One technology stack per account, on `/accounts/:accountId` (Technical Stack card) and on
`/companies/:id` (Technology stack section). Same data, same wall.

- Wall: grouped by category (Cloud, Collaboration, Email security, Identity, CRM and marketing,
  ITSM, Data and analytics, ERP, Web platform, DevOps, Languages, Other). Category label in
  uppercase `--fg-tertiary` 12px; items as pills with `TechLogo` (20px), name, a source chip and
  the confidence as a whole percent in tabular numbers.
- Source chips, plain words only: DNS, Cert, Website, Jobs, GitHub, Apollo, Manual, Meeting notes,
  Seamless, Tech intel. Chip uses `--surface-sunken` with `--fg-secondary`; Manual uses
  `--brand-primary` text. No colour-only meaning: the word is always there.
- Evidence: each pill is a button that opens a popover (Radix HoverCard on hover, click toggles a
  pinned popover; Escape closes and focus returns to the pill). Content: source, the record or URL
  observed (URLs are links, `rel="noreferrer"`), observed date, confidence.
- Coverage line under the wall: `Coverage: DNS 6, Cert 2, Website 4, Jobs 3. Nothing found in
  GitHub.` Lanes that failed say `Cert unavailable`. Last checked date on the right, `Checked 7 Nov`.
  Sample data carries the `Sample` tag next to the coverage line.
- Empty: `No technology found yet` plus the coverage line when lanes ran. Loading: skeleton rows.
  Error: `Could not load technology stack` with Retry.
- Accounts list card: up to three `TechLogo` (16px) with names, in the existing `account-card-tech`
  row; it truncates with an ellipsis and carries a `title` with the full list. No new row.
- Layout: no overlap at 1440, 1024 and 390, light and dark; pills wrap; popover stays inside the
  viewport (collision padding 8px). Hit targets 24 x 24 minimum. Copy: no em dashes, no taglines.
- Build note: the empty state keeps the existing copy `No technology detected yet` so current tests
  and screenshots stay valid. Chip and Sample text use 12px (`text-xs`), the audit floor.
### 9.9 Slice 2 console shell as built (2026-11-07)

Appended by factory slice 2. Refines the existing shell (AppShell, Sidebar, MobileNav, Topbar); the look
is unchanged. This supersedes the "56px icon rail" line in 9.4.

- Rail: 232px expanded, 64px collapsed, from `--sidebar-w` on `.app-shell`. The grid track eases
  200ms with `var(--ease-ui-out)`. It is instant for a keyboard toggle (Enter or Space) and under
  `prefers-reduced-motion`, via `data-motion="instant"` on `.sidebar`. Collapsed items keep an
  `aria-label` and a tooltip; section flyouts open on hover and on keyboard focus.
- Breakpoint: `56rem` (`SHELL_WIDE_QUERY` in `components/layout/shellBreakpoint.ts`). Below it the rail
  is hidden and the topbar "Open navigation" button opens the nav as an in-place drawer inside the
  shell (left side, `--ease-drawer`, backdrop button "Close navigation"). The drawer is a
  `role="dialog"` named "Primary navigation"; focus moves in, Tab is trapped, Escape or a link closes
  it, and focus returns to the hamburger. Body scroll is locked while it is open.
- One vertical scroll: the document scrolls; the sidebar keeps only its own safety-net overflow.
- Pinned by `MobileNav.test.tsx`, `Sidebar.console.test.tsx` and `shell-css.contract.test.ts`.

### 9.10 Consulting partners (slice 15)

One section on the account page and the `/accounts/:id` cockpit, after Account direction: which third-party consulting firms work with the client, and how we stand against each one. Our own group entities stay in the MSA "who works with them" panel; this section is outside firms only.

- Partner strip: one tile per firm, strongest first. Tile: monogram (two letters, brand-tinted inset), firm name, relationship tags (Strategic partner, Implementation, Managed services, Audit, Advisory, Engineering), domain chips (IT, Engineering, Digital, Data, SAP, Cloud, Cyber, HEMA / pharma), a three-step strength meter and the evidence count. Selected tile has the accent ring; arrow keys move along the strip (`role="listbox"`).
- Selected partner, two columns at 1440 and 1024, one column at 390:
  - Left: radar (repo `charts/PolarCharts.tsx` `RadarChart`, lazy) with two series, Us (accent) and the partner (muted), on Quality, Price, Speed, Domain depth. Below it a score table, one row per dimension including Relationship: us, partner, evidence count. A dimension without evidence shows "No evidence" in muted text and is left off the radar, never drawn as zero.
  - Right: record line (wins and losses against the firm, years), then 1 to 3 angles. Each angle cites its evidence; an inferred angle carries the "Inferred" tag.
- Timeline strip under both columns: one dot per evidence item on a time axis, public dots outlined, internal dots filled; hover or focus shows date, source and title.
- Evidence list (collapsed by default, "Evidence" toggle): source label, date, excerpt, method, link to the URL or the record; "Load more" pages through the API.
- Header: section title, last fetched time, and Refresh (lucide `RefreshCw`) for users with `account-intel:write`. Not configured status shows the detail text.
- Loading: skeleton renders immediately (no network wait before first paint); the radar chunk loads after. Empty: one line, "No consulting partners found".
- Sample data carries the "Sample" tag. No taglines or helper text. Tokens: `.sg` variables, accent `--brand-primary` (#006b4f), both themes, 12px card radius, tabular numbers, lucide icons only. Text truncates with ellipsis and full text in `title`; nothing overlaps at 1440, 1024 or 390.

### 9.11 Company intel on the Companies page (slice 14)

Where each company is heading, at a glance, on the list and in the account header. Organization-level public signals only; never people.

- List columns, after Company and Domain: Revenue, Revenue growth, Headcount, Headcount growth (6m), Open roles, New roles (30d), Hiring trend, Funding, Signal, Direction. All sortable on the loaded page; filters run on the server.
- Saved views as a segmented row above the table: Hiring fast (5 or more new postings in 30 days), Revenue over 1B (USD equivalent), Contracting. `aria-pressed` on the active one; one click again clears it. A Direction select sits beside them.
- Columns button (lucide `Columns3`) opens a checkbox menu; hidden columns persist per browser in `localStorage` key `polo.companies.columns.v1`.
- Every number names its source, year or as-of date and method in its hover title and accessible label. Derived numbers (revenue growth, filed headcount growth, direction) say "inferred"; growth values render italic when inferred.
- Empty values render an en dash with the reason on hover: Not connected, Private company, No public data, plus one line of detail.
- New roles (30d) is the hiring proxy: postings first published in the last 30 days, with the delta against the prior 30 days. It is never called hires.
- Hiring trend: vendored TUFFUI sparkline (72 x 28), six monthly points, last point dotted; success tone when the 30 day trend is up, danger when down, tertiary when flat.
- Direction: `StatusPill` sm with lucide `TrendingUp`, `Minus` or `TrendingDown` and the word Growing, Steady or Contracting; reasons in a tooltip ending with "Inferred". Signal: `StatusPill` with the post kind.
- Import progress: one row above the table while an import's companies are enriched: origin, done of total, then the result counts when complete (with revenue, headcount growth, new roles 30d).
- Account header: a compact strip under the name with five buttons: Revenue (with FY), Headcount (with 6m growth), Open roles (with 30 day delta), Funding, Direction. Each opens the matching Intel tab (financials, hiring, hiring, financials, direction). A Refresh button (lucide `RefreshCw`) for `account-intel:write` queues every source.
- Intel tab on the account page mounts the slice 12 section (9.7).
- Widths: the table scrolls horizontally inside its card; the strip wraps to two rows at 1024 and stacks at 390. No overlapping text at 1440, 1024 and 390.
- No taglines or helper text. Tokens only, both themes, tabular numbers, sample data tagged.
### 9.x Hiring detail and source rules (2026-11-07)

- Hiring panel adds detail on top of the existing counts, never in place of them: a hiring focus line, share bars (count and percent) for function, tech, practice area and seniority, and a role list that filters when a share is clicked.
- Percent bases are stated next to the number: function and tech over every open role; practice area and seniority over the postings listed.
- Sources: every fact names where it came from. The hiring focus line names the job boards; each role links to its posting. News and posts link to the original and name the site. Items without a source link sit apart behind "Show N without a source link", flagged "No source link". Anything we conclude ourselves (for example "Where we fit") carries the "Inferred" tag.
