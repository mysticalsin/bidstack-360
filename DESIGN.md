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

---

_DESIGN.md is a living document. Every design decision must be traceable to a Principle. When taste_profile.json evolves, update the relevant sections here._
