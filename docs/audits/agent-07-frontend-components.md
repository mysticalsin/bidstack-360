# Frontend UI Components Audit — BidStack 360°

**Scope:** `apps/web/src/components/**/*.tsx`, `apps/web/src/components/ui/**/*.tsx`  
**Rubric:** Design 25 + Code 25 (combined 50 points of the 100-point release rubric)  
**Files reviewed:** 29 component files (18 in `ui/`, 11 in `components/`)  
**Date:** 2026-05-23

---

## 1. Score

**82 / 100**

- **Design:** 19 / 25 — Strong Apple HIG–informed visual language, comprehensive CSS token system, and excellent `prefers-reduced-motion` coverage. Deducted for missing mandatory states on several interactive components, sub-44×44px touch targets, and inconsistent dark-mode rounding.
- **Code:** 20 / 25 — Solid accessibility wiring (ARIA roles, labelled-by, described-by, keyboard handlers), good forwardRef usage, and clean composition patterns. Deducted for inconsistent ref forwarding, duplicate reduced-motion hook sources, missing keyboard support on novelty components, and hardcoded action UI in composite components.

---

## 2. Strengths

- **Radix UI primitives used correctly across the board.**  
  `Dialog.tsx:1`, `Tabs.tsx:1`, `Tooltip.tsx:5`, `HoverCard.tsx:6`, `ConfirmDialog.tsx:8` — all wrap Radix with token-driven styling rather than re-implementing behavior. Dialog.Portal, Dialog.Overlay, and Dialog.Content are wired with `aria-describedby` suppression when no description exists, avoiding Radix console warnings without breaking screen-reader semantics.

- **Comprehensive `prefers-reduced-motion` respect.**  
  `Button.tsx:48`, `Card.tsx:32`, `Toast.tsx:140`, `Tooltip.tsx:54`, `ProgressRing.tsx:36`, `PulseBeams.tsx:16`, `GlassCard.tsx:44`, `SavedFlash.tsx:24` — every animated component branches on `useReducedMotion()` and drops transforms/springs in favor of simple opacity fades. This is a first-class citizen, not an afterthought.

- **Touch-target floor explicitly enforced on primary controls.**  
  `Button.tsx:67` (`pointer-coarse:min-h-11 pointer-coarse:min-w-11`), `Input.tsx:63` (`pointer-coarse:min-h-[44px]`), `ShowMore.tsx:50` (`min-h-11`), `LookupFieldPicker.tsx:260` (`min-h-11` on dropdown items) — the coarse-pointer media query is used consistently for primary interactive elements.

- **Form primitives ship with full ARIA state wiring.**  
  `Input.tsx:52-55` exposes `aria-invalid`, `aria-busy`, `aria-describedby`, and `aria-errormessage` automatically. `Select.tsx:56-59` mirrors the same pattern. Error and helper text IDs are derived from `useId()` and joined correctly, satisfying WCAG 2.2 3.3.1 / 4.1.2.

- **CSS variable theming is exhaustive and versioned.**  
  `apps/web/src/index.css:18-211` defines paired light/dark tokens for brand, surface, foreground, border, semantic, tag, chart, and elevation scales. The `@theme` block (`index.css:214-298`) bridges them into Tailwind v4 utilities with semantic names (`--color-surface-card`, `--color-fg-primary`, etc.), enabling utility-first usage while keeping theming centralized.

---

## 3. P0 Gaps (Critical — Must Fix Before Ship)

| #   | Gap                                                                                                                                                                                                                                                                                            | File(s)                 | Line(s) |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | ------- |
| 1   | **LookupFieldPicker clear button is 25×25 px** — well below the 44×44 px WCAG 2.2 / Apple HIG requirement. The comment claims the absolute-positioning wrapper fulfills the target, but the wrapper has no `min-h-11 min-w-11`.                                                                | `LookupFieldPicker.tsx` | 215     |
| 2   | **Toast dismiss button is 24×24 px** — `h-6 w-6` with no `pointer-coarse` fallback. On touch devices this is nearly impossible to tap accurately.                                                                                                                                              | `Toast.tsx`             | 188     |
| 3   | **MagneticButton is mouse-only** — relies exclusively on `onMouseMove` / `onMouseLeave`; no keyboard equivalent, no focus-visible ring, and no `tabIndex` handling. A keyboard user cannot focus or activate it.                                                                               | `MagneticButton.tsx`    | 32–46   |
| 4   | **LiquidGlassButton & MetalButton missing mandatory states** — no `focus-visible` ring, no `disabled` styling, no `prefers-reduced-motion` support, and no `active` scale feedback. These are branded CTA components that appear on high-traffic surfaces (login, upgrade).                    | `LiquidGlassButton.tsx` | 16–65   |
| 5   | **TabsTrigger lacks explicit focus-visible ring** — while global focus styles may apply, the component itself does not declare `focus-visible:outline-none focus-visible:ring-2 …`. Given the complex `::after` underline pseudo-element, the browser default focus ring may clip or conflict. | `Tabs.tsx`              | 23–35   |
| 6   | **Select dropdown chevron is purely decorative but not hidden from AT** — the `<svg>` inside the chevron span lacks `aria-hidden`, and the span itself is decorative.                                                                                                                          | `Select.tsx`            | 82–85   |

### Evidence

```tsx
// LookupFieldPicker.tsx:215 — 25×25 px clear button
<button
  type="button"
  aria-label="Clear selection"
  onClick={clear}
  className="absolute right-2 flex h-5 w-5 items-center justify-center ..."
>
  ×
</button>
```

```tsx
// Toast.tsx:188 — 24×24 px dismiss button
<button
  type="button"
  onClick={() => dismiss(item.id)}
  aria-label="Dismiss"
  className="ml-1 inline-flex h-6 w-6 shrink-0 items-center justify-center ..."
>
  ×
</button>
```

```tsx
// MagneticButton.tsx:32-46 — no keyboard handlers
const handleMouseMove = useCallback((e: React.MouseEvent<HTMLButtonElement>) => { ... }, [reduced, strength]);
const handleMouseLeave = useCallback(() => { setPosition({ x: 0, y: 0 }); }, []);
// Missing: onFocus, onBlur, onKeyDown, focus-visible ring
```

```tsx
// LiquidGlassButton.tsx:28-40 — no disabled, no focus-visible, no reduced-motion
<Component
  className={cn('liquid-glass-button', `liquid-glass-button-${tone}`, ...)}
  {...defaultButtonProps}
  {...rest}
>
```

---

## 4. P1 Gaps (Inconsistency, Prop Drilling, Missing Docs)

| #   | Gap                                                                                                                                                                                                                                                                  | File(s)                                 | Line(s)    |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | ---------- |
| 1   | **Inconsistent dark-mode border radius** — `Input` has `dark:rounded-xl` but `Select` does not; they visually diverge in dark mode.                                                                                                                                  | `Input.tsx`, `Select.tsx`               | 57, 61     |
| 2   | **Inconsistent dark-mode hover glow on Select** — `Input` adds `dark:hover:border-[var(--border-glow-strong)]` but `Select` omits it.                                                                                                                                | `Input.tsx`, `Select.tsx`               | 59, 62     |
| 3   | **Inconsistent focus ring offset** — `Button` uses `ring-offset-2`, `Input` and `Select` use `ring-offset-1`. Creates a subtly uneven focus experience across the form.                                                                                              | `Button.tsx`, `Input.tsx`, `Select.tsx` | 65, 60, 63 |
| 4   | **Two sources of `useReducedMotion`** — `framer-motion`'s hook is used in 8 files; the custom `@/hooks/useReducedMotion` is used in 3 files (`GlassCard`, `StatusPulse`, `PulseBeams`). They behave the same at runtime but the duplication is a maintenance hazard. | `hooks/useReducedMotion.ts`             | 1–17       |
| 5   | **GlassCard does not forward ref** — limits composition when consumers need imperative access or want to wrap it in a Radix primitive.                                                                                                                               | `GlassCard.tsx`                         | 36–57      |
| 6   | **DialogContent is prop-driven rather than composable** — `title` and `description` are string/ReactNode props, not sub-components like `<DialogHeader>` / `<DialogBody>`. This forces prop drilling for complex dialogs and prevents consumer-defined layouts.      | `Dialog.tsx`                            | 12–13      |
| 7   | **Icon component has no accessible-label path** — `ariaHidden` is a boolean, but when `false` there is no `aria-label` or `title` prop to pass to the `<svg>`. Consumers must wrap the icon in a span with `aria-label`.                                             | `Icon.tsx`                              | 300–310    |
| 8   | **Missing component documentation / Storybook** — No `.stories.tsx` or `.mdx` files exist in `components/ui/`. The team relies on code comments, but there is no visual regression or interactive prop playground.                                                   | `components/ui/`                        | —          |
| 9   | **BulkActionBar hardcodes Button variants** — `onExport` and `onDelete` render fixed `Button` instances; consumers cannot inject custom actions (e.g., an icon-only menu or a split button).                                                                         | `BulkActionBar.tsx`                     | 31–47      |
| 10  | **SpotlightTableRow uses plain `<tr>` without ref forwarding** — inconsistent with the rest of the table sub-components (`TableRow`, `TableHead`, etc.), which all forward refs.                                                                                     | `SpotlightTable.tsx`                    | 46         |

### Evidence

```tsx
// Input.tsx:57  vs  Select.tsx:61
// Input:  'w-full rounded-lg dark:rounded-xl border ...'
// Select: 'w-full appearance-none rounded-lg border ...'  (missing dark:rounded-xl)
```

```tsx
// Button.tsx:65  vs  Input.tsx:60
// Button:  'focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-page)]'
// Input:   'focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--surface-page)]'
```

```tsx
// Icon.tsx:303-310 — no aria-label prop
export function Icon({ name, size = 18, strokeWidth = 1.75, className, style, ariaHidden = true }: IconProps) {
  return (
    <svg ... aria-hidden={ariaHidden}>
      {path}
    </svg>
  );
}
```

---

## 5. P2 Gaps (Nice-to-Have Improvements)

| #   | Gap                                                                                                                                                                                                                                            | File(s)                          | Line(s) |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | ------- |
| 1   | **No explicit success state on Input / Select** — Form primitives have `error` styling (red border) but no mirrored `success` state (green border + checkmark). The rubric lists success as a mandatory state for every interactive component. | `Input.tsx`, `Select.tsx`        | —       |
| 2   | **ShowMore height transition ignores `prefers-reduced-motion`** — The `max-height` CSS transition (`duration-200`) always runs even when the user prefers reduced motion. Should be instant when `useReducedMotion()` is true.                 | `ShowMore.tsx`                   | 31      |
| 3   | **SavedFlash triggers `setState` during render** — Lines 26–29 call `setSeenTrigger` and `setVisible` directly in the render body. While gated by a comparison, it is an anti-pattern; should be moved into a `useEffect`.                     | `SavedFlash.tsx`                 | 26–29   |
| 4   | **Avatar `alt` is locked to `seed`** — When an image URL is provided, the `alt` text is always the seed string (typically a name). There is no `alt` prop override for i18n or context-specific descriptions (e.g. "Acme Corp logo").          | `Avatar.tsx`                     | 67–75   |
| 5   | **TabsContent has no enter/exit animation** — Tab panels mount instantly. Given the polished spring motion elsewhere (Button, Card, Toast), the absence of a panel fade/slide feels abrupt.                                                    | `Tabs.tsx`                       | 41–45   |
| 6   | **UpgradeBanner duplicates action markup** — The `actionClassName` string is pasted into both an `<a>` and a `<button>`. Should use a shared `ActionLink` sub-component or the `Button` primitive.                                             | `UpgradeBanner.tsx`              | 26–38   |
| 7   | **Table lacks built-in loading skeleton integration** — `LoadingSkeleton` exists in `StateMessages.tsx`, but `Table` has no `isLoading` prop or skeleton row sub-component. Consumers must manually compose them.                              | `Table.tsx`, `StateMessages.tsx` | —       |
| 8   | **Missing `asChild` / polymorphic support on Button** — `Button` always renders `<motion.button>`. Consumers cannot render it as a React Router `<Link>` or Radix `<Dialog.Trigger>` without wrapping it in an extra DOM node.                 | `Button.tsx`                     | 46–76   |

### Evidence

```tsx
// SavedFlash.tsx:26-29 — setState during render
if (trigger !== seenTrigger) {
  setSeenTrigger(trigger);
  if (trigger != null && trigger !== false) setVisible(true);
}
```

```tsx
// ShowMore.tsx:31 — unconditional CSS transition
className={cn('relative overflow-hidden transition-[max-height] duration-200', ...)}
```

---

## 6. Summary & Recommendation

The `apps/web/src/components/ui/` directory is one of the strongest parts of the BidStack 360° frontend. The team has invested heavily in:

- Accessible form primitives with auto-generated ARIA relationships.
- Radix-backed dialogs, tabs, tooltips, and hover-cards that handle focus trapping and portal rendering correctly.
- A thorough design-token system that bridges light/dark modes through a single CSS variable layer.
- Motion that respects user preferences.

**To reach the ≥ 95 / 100 ship threshold, the following must be fixed:**

1. **Fix all sub-44×44px touch targets** (LookupFieldPicker clear button, Toast dismiss button, and any other icon-only buttons in the UI). Either add `pointer-coarse:min-h-11 pointer-coarse:min-w-11` or increase the base size to 44px.
2. **Add keyboard accessibility and focus rings to MagneticButton and LiquidGlassButton / MetalButton.** These are public-facing CTA components; they must be fully operable via keyboard.
3. **Unify the `useReducedMotion` import source** — standardize on the `@/hooks/useReducedMotion` custom hook (it handles SSR safely) and remove `framer-motion` direct imports for this concern.
4. **Add missing focus-visible declarations to TabsTrigger** to ensure the active underline does not clip or obscure the focus ring.
5. **Add Storybook stories or at least a visual regression test suite** for the 8 most-used primitives (Button, Input, Select, Dialog, Table, Tabs, Toast, Card) so that future token changes do not silently break contrast or rounding.

Once the P0 list is cleared and the P1 inconsistencies are aligned, this domain will comfortably score in the 94–97 range.
