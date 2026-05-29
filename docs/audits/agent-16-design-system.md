# Design System Audit — Agent 16

**Domain:** Design System (CSS tokens, Tailwind v4, motion, component states)  
**Scope:** `apps/web/src/index.css`, `apps/web/src/lib/motion.ts`, theme tokens, Tailwind config, component primitives  
**Rubric dimension:** Design 25  
**Date:** 2026-05-23  
**Auditor:** Kimi Code CLI (read-only)

---

## 1. Score

**84 / 100**

The design system has excellent foundations—comprehensive light/dark CSS variable tokens, robust `prefers-reduced-motion` support, a well-documented motion library, and strong focus-ring hygiene. It loses points for a confirmed WCAG 2.5.5 touch-target regression in the legacy `.btn` class, widespread deviation from the self-imposed 9-step type scale and 8px spatial grid, and incomplete state coverage (missing loading/success on Card and success on form primitives).

---

## 2. Strengths

- **Comprehensive CSS variable token architecture.** `index.css:27-211` defines a complete light theme (`:root`) and dark theme (`[data-theme='dark']`) with brand, surface, foreground, border, semantic, tag, and chart palettes. Dark-mode comments explicitly document contrast ratios (e.g. brand-primary white-on-violet 5.36:1, brand-deep 7.59:1).
- **Tailwind v4 `@theme` bridge.** `index.css:214-298` maps design tokens into Tailwind utilities via the v4 `@theme` directive (`--color-brand`, `--color-surface-page`, etc.), eliminating the need for a separate `tailwind.config.js`.
- **Global focus-ring guarantee.** `index.css:379-396` applies a 2px solid `var(--brand-primary)` outline + 3px halo `box-shadow` to `*:focus-visible`, with reinforced rules for native controls. The halo uses `rgba(44, 75, 255, 0.14)` in light and `rgba(168, 85, 247, 0.32)` in dark.
- **`prefers-reduced-motion` respected at three layers.**  
  (a) CSS media query flushes all transitions/animations to `0.01ms` (`index.css:402-410`).  
  (b) `data-motion='reduced'` attribute override for explicit user preference (`index.css:4404-4410`).  
  (c) Every Framer Motion component reads `useReducedMotion()` (e.g. `Button.tsx:48`, `Card.tsx:32`, `StateMessages.tsx:13`).
- **Apple-grade motion token library.** `lib/motion.ts` exports named springs (`springSnap`, `springModal`, `springSmooth`, `springSoft`), easing curves (`easeStandard`, `easeDecel`, `easeAccel`), and common variants (`fadeUp`, `fadeScale`, `staggerParent`) with documented durations and use-cases.
- **Accessible form primitives.** `Input.tsx` and `Select.tsx` both implement `error` (with `aria-invalid` + `aria-errormessage`), `isLoading` (with `aria-busy` + spinner), `disabled`, `helper`, and `label` wiring out of the box.
- **Density modes and print stylesheet.** `index.css:4380-4399` support `[data-density="compact"]` and `[data-density="spacious"]`. `index.css:4416-4453` provide a complete print stylesheet that strips chrome and reflows the cockpit.

---

## 3. P0 Gaps — WCAG 2.2 AA Failures / Broken Motion

### P0-1: Touch target regression on `.btn` class (WCAG 2.5.5 AA)

`apps/web/src/index.css:1739-1758`

The global touch-target safeguard (`button, [role='button'], a { min-height: 44px; min-width: 44px; }`) is deliberately overridden by the legacy `.btn` utility:

```css
.btn {
  height: 34px;
  white-space: nowrap;
  min-height: 0; /* ← defeats the global 44px floor */
}
```

Because `.btn` has higher specificity than the element selector, any `<button class="btn">` renders at 34 px tall on desktop—below the 44×44 px AA requirement. **The modern `Button.tsx` primitive mitigates this** with `pointer-coarse:min-h-11`, but any page or third-party component still using `.btn` directly is non-compliant.

### P0-2: `.link-arrow` zeroes touch targets

`apps/web/src/index.css:2014-2016`

```css
.link-arrow {
  min-height: 0;
  min-width: 0;
}
```

If this class is applied to an `<a>` or `<button>`, the global 44 px floor is removed. The element relies on content height, which may fall below 44 px.

### P0-3: `tb-search` interactive container is 32 px tall

`apps/web/src/index.css:1345-1361`

```css
.tb-search {
  min-height: 32px;
  /* ... */
}
```

While the inner `<input>` receives focus, the visual click target itself is only 32 px high. On desktop pointer devices this is below the 44 px recommendation.

---

## 4. P1 Gaps — Inconsistent Spacing, Type Scale, Missing States

### P1-1: Legacy prototype typography violates the 9-step type scale

**Evidence:** `index.css` contains dozens of fractional and off-scale font sizes:

| Line | Size     | Nearest scale step              |
| ---- | -------- | ------------------------------- |
| 777  | `10.5px` | 10 px (step 1) — off by 0.5 px  |
| 822  | `11px`   | not in scale                    |
| 952  | `14px`   | 14 px (step 4) ✓                |
| 958  | `14.5px` | 14 px — off by 0.5 px           |
| 968  | `10.5px` | 10 px — off by 0.5 px           |
| 1013 | `10px`   | 10 px (step 1) ✓                |
| 1158 | `13px`   | 13 px (step 3) ✓                |
| 1189 | `13px`   | 13 px (step 3) ✓                |
| 1265 | `11.5px` | not in scale                    |
| 1332 | `13px`   | 13 px ✓                         |
| 1358 | `13px`   | 13 px ✓                         |
| 1390 | `13px`   | 13 px ✓                         |
| 1400 | `11px`   | not in scale                    |
| 1470 | `11.5px` | not in scale                    |
| 1484 | `13px`   | 13 px ✓                         |
| 1492 | `11px`   | not in scale                    |
| 1562 | `13px`   | 13 px ✓                         |
| 1624 | `13px`   | 13 px ✓                         |
| 1660 | `22px`   | 22 px (step 6) ✓                |
| 1668 | `13px`   | 13 px ✓                         |
| 1713 | `11px`   | not in scale                    |
| 1744 | `13px`   | 13 px ✓                         |
| 1779 | `12px`   | 12 px (step 2) ✓                |
| 1916 | `12px`   | 12 px ✓                         |
| 1922 | `13px`   | 13 px ✓                         |
| 1928 | `14px`   | 14 px ✓                         |
| 1991 | `13px`   | 13 px ✓                         |
| 2009 | `12px`   | 12 px ✓                         |
| 2264 | `11.5px` | not in scale                    |
| 2269 | `20px`   | not in scale (scale has 17, 22) |
| 2279 | `11px`   | not in scale                    |
| 2292 | `11px`   | not in scale                    |
| 2306 | `13px`   | 13 px ✓                         |
| 2520 | `13px`   | 13 px ✓                         |
| 2546 | `13px`   | 13 px ✓                         |
| 2550 | `11.5px` | not in scale                    |

The design system doc specifies: **10 / 12 / 13 / 14 / 17 / 22 / 28 / 36 / 48 px**. The extracted dashboard styles (`cockpit.css`, `org-dashboard.css`) and the monolithic `index.css` still carry `10.5px`, `11px`, `11.5px`, `12.5px`, `14.5px`, and `20px`, making the typographic rhythm unpredictable.

### P1-2: 8px spatial grid violations in legacy CSS

**Evidence:** `index.css` uses arbitrary padding/gap values that do not align to the 8 px (or 4 px sub-grid) system:

```css
/* index.css:730 */
.sidebar {
  padding: 14px 10px 24px; /* 14, 10, 24 are off-grid */
}

/* index.css:1716 */
.account-meta-chips span {
  padding: 5px 8px; /* 5 px is off-grid */
}

/* index.css:2044 */
.card-head {
  padding: 14px 18px 8px; /* 14, 18 are off-grid */
}

/* index.css:2412 */
.app-shell .page {
  padding: 22px 28px 60px; /* 22, 28, 60 are off-grid */
}
```

The inline comment at `index.css:5-22` explicitly acknowledges that extracted route chunks (`cockpit.css`, `org-dashboard.css`) contain these legacy spacing issues.

### P1-3: Sub-grid 6 px spacing still present in UI primitives

**Evidence:**

- `apps/web/src/components/ui/Breadcrumbs.tsx:72`: `gap-1.5` (6 px)
- `apps/web/src/components/ui/ShowMore.tsx:50`: `gap-1.5` (6 px)
- `apps/web/src/components/ui/Tooltip.tsx:66`: `py-1.5` (6 px)

These violate the documented 4 px / 8 px spatial grid. A prior partial remediation (`docs/audits/findings_ux_ui.md`) replaced many `py-1.5` instances, but these three remain.

### P1-4: Missing `loading` state on `Card`

`docs/design-system.md:63` admits: _"Where a state isn't yet visually implemented (e.g. Loading on Card), the data-fetching wrapper feeds LoadingSkeleton as the fallback."_ The `Card` and `InteractiveCard` primitives in `Card.tsx` have no built-in loading skeleton or shimmer variant; callers must compose `LoadingSkeleton` manually, which leads to inconsistent loading UX across pages.

### P1-5: Missing `success` state on form primitives

`Input.tsx` and `Select.tsx` cover `default`, `hover`, `focus`, `active` (via native `:active`), `loading`, `error`, `disabled`, and `empty` (implied by value). They do **not** implement a `success` state (green border/checkmark). `Button.tsx` covers `default`, `hover`, `active`, `focus`, `disabled`, but lacks `loading`, `error`, `empty`, and `success` visual variants—the caller must handle these by swapping children or disabling the button.

### P1-6: Type scale not encoded in Tailwind `@theme`

`index.css:214-298` maps colors, fonts, radius, and shadows, but **omits `--text-*` tokens**. There is no central `text-step-1` … `text-step-9` mapping, which is why developers fall back to hardcoded pixel values and arbitrary Tailwind utilities (`text-xs`, `text-sm`, `text-[11px]`, etc.).

---

## 5. P2 Gaps — Nice-to-Have Improvements

### P2-1: No spacing token scale in `@theme`

Just as typography lacks formal steps, spacing is not exposed as `--space-*` tokens. The system relies on Tailwind's default `p-2`/`p-4` scale plus hardcoded pixel values in CSS. A custom `--space-1` … `--space-12` scale would enforce grid discipline.

### P2-2: `inline-edit-trigger` suppresses global focus ring

`index.css:397-399`

```css
.inline-edit-trigger:focus-visible {
  outline: none;
}
```

While it adds a bespoke border + box-shadow treatment on the next line, this pattern is risky. If the bespoke treatment is ever removed, focus visibility disappears. Recommendation: keep `outline: 2px solid var(--brand-primary)` and layer the border aesthetic on top.

### P2-3: One-off "liquid glass" and "metal button" styles are ungoverned

`index.css:1794-2003` contains elaborate `liquid-glass-button`, `metal-button`, and gradient variants that are not parameterized by the token system (they use raw `rgba()` and hex values like `#17c285`, `#fde68a`). These feel like marketing-page artifacts transplanted into the CRM shell. They should either be brought under token control or moved to a page-scoped stylesheet.

### P2-4: Missing `dark:` coverage on `.btn` prototype class

The legacy `.btn` / `.btn-primary` / `.btn-secondary` classes in `index.css:1739-1787` have **no dark-mode overrides**. Pages using these classes (rather than the modern `Button.tsx` primitive) render light-mode buttons in dark mode.

### P2-5: `Badge` uses `text-[11px]` (not in scale)

`apps/web/src/components/ui/Badge.tsx:30`

```tsx
'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium';
```

11 px is not one of the 9 documented steps. `text-xs` (12 px / 0.75 rem) is the closest compliant step.

---

## 6. Evidence — Specific Code Snippets

### Theme token coverage (light + dark)

```css
/* apps/web/src/index.css:27-107  (light) */
:root,
[data-theme='light'] {
  --brand-primary: #2c4bff;
  --surface-page: #fafbfd;
  --surface-card: #ffffff;
  --fg-primary: #1a1f36;
  --fg-tertiary: #6b7280; /* 4.6:1 on white, WCAG AA */
  --success: #1f8a5b;
  --danger: #d93849;
  --focus-ring: 0 0 0 3px rgba(44, 75, 255, 0.14);
}

/* apps/web/src/index.css:110-211 (dark) */
[data-theme='dark'] {
  --brand-primary: #9333ea; /* white on this: 5.36:1 AA */
  --brand-deep: #c084fc; /* accent text: 7.59:1 AAA */
  --surface-page: #0a0612;
  --surface-card: #14101e;
  --fg-primary: #f5f3ff; /* 18.3:1 on page — AAA */
}
```

### Reduced-motion layers

```css
/* apps/web/src/index.css:402-410 */
@media (prefers-reduced-motion: reduce) {
  html:not([data-motion='full']) *,
  html:not([data-motion='full']) *::before,
  html:not([data-motion='full']) *::after {
    transition-duration: 0.01ms !important;
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
  }
}
```

```tsx
// apps/web/src/components/ui/Button.tsx:47-57
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', type = 'button', disabled, ...rest }, ref) => {
    const reduced = useReducedMotion();
    return (
      <motion.button
        whileTap={reduced || disabled ? undefined : { scale: PRESS_SCALE[size] }}
        whileHover={reduced || disabled ? undefined : { y: -0.5 }}
```

### Touch-target failure

```css
/* apps/web/src/index.css:412-418 */
button,
[role='button'],
a {
  min-height: 44px;
  min-width: 44px;
}

/* apps/web/src/index.css:1739-1758 */
.btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  font-size: 13px;
  height: 34px;
  min-height: 0; /* ← overrides the 44px safeguard */
}
```

### Form primitive state coverage

```tsx
// apps/web/src/components/ui/Input.tsx:56-69
className={cn(
  'w-full rounded-lg dark:rounded-xl border bg-[var(--surface-card)] text-[var(--fg-primary)] transition-colors',
  'hover:border-[var(--border-strong)]',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)]',
  'disabled:cursor-not-allowed disabled:opacity-60',
  'read-only:bg-[var(--surface-sunken)] read-only:focus-visible:ring-0',
  size === 'sm' ? 'px-3 py-1 text-xs' : 'px-3 py-2 text-sm',
  hasError
    ? 'border-[var(--danger)] focus-visible:border-[var(--danger)]'
    : 'border-[var(--border-subtle)]',
)}
```

### Type-scale violation

```css
/* apps/web/src/index.css:777 */
.sb-group-title {
  font-size: 10.5px;   /* not in 10/12/13/14/17/22/28/36/48 */
}

/* apps/web/src/index.css:1265 */
.sb-sync {
  font-size: 11.5px;   /* not in scale */
}

/* apps/web/src/components/ui/Badge.tsx:30 */
'text-[11px]'            /* not in scale */
```

### Sub-grid spacing violation

```tsx
// apps/web/src/components/ui/Breadcrumbs.tsx:72
<ol className="flex items-center gap-1.5">

// apps/web/src/components/ui/Tooltip.tsx:66
className="... px-2.5 py-1.5 text-xs ..."
```

---

## Summary Matrix

| Criterion                              | Status     | Notes                                                                           |
| -------------------------------------- | ---------- | ------------------------------------------------------------------------------- |
| CSS variable theme tokens (light/dark) | ✅ Strong  | Full palette, documented contrast ratios                                        |
| Tailwind v4 utility usage              | ✅ Strong  | `@theme` bridge present; no legacy config needed                                |
| 8px spatial grid adherence             | ⚠️ Partial | Legacy CSS uses off-grid pixels; sub-grid 6px still in 3 UI files               |
| 9-step type scale                      | ⚠️ Partial | Many fractional sizes (`10.5px`, `11.5px`, `14.5px`) in legacy CSS              |
| Component state coverage               | ⚠️ Partial | Button/Input/Select cover 5–6 states; Card lacks loading; success state missing |
| `prefers-reduced-motion`               | ✅ Strong  | CSS media query + attr override + `useReducedMotion` everywhere                 |
| Touch target sizes (44×44)             | ❌ Failing | `.btn` and `.link-arrow` override global `min-height: 44px`                     |
| Color contrast ratios                  | ✅ Strong  | Explicit ratios in dark-mode comments; `fg-tertiary` fixed to 4.6:1             |
| Focus rings (2px, 3:1)                 | ✅ Strong  | Global `*:focus-visible` with halo; bespoke overrides minimal                   |
