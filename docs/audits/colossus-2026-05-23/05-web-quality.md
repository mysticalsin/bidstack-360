# Frontend Quality Audit — `apps/web`

**Audited:** 2026-05-23  
**Scope:** TypeScript strictness, test coverage, type safety, a11y, state management, component hygiene  
**Method:** Static analysis (grep + read) — no runtime execution.

---

## Summary

| Metric | Value | Assessment |
|--------|-------|------------|
| TypeScript strictness | `strict: true`, `noUncheckedIndexedAccess: true`, `noImplicitOverride: true` enabled; `exactOptionalPropertyTypes: false` | Strong |
| Test files found | 16 | Moderate |
| `any` usage | ~0 explicit type annotations | Excellent |
| `@ts-ignore` / `@ts-expect-error` | 0 | Excellent |
| `console.log` / `console.error` in production code | 3 instances | Needs cleanup |
| a11y attributes (`aria-*`) | 250 across components | Good |
| `onClick` on non-interactive elements (div/span) | 0 | Excellent |
| `useState` in components | 190 hooks | — |
| `useEffect` in components | 39 hooks | — |
| `as` type assertions | 268 instances | High — review for unsoundness |
| `eslint-disable` lines | 9 | Mostly acceptable |
| TODO / FIXME / HACK / XXX | 0 | Excellent |
| React Query (`useQuery` / `useMutation`) | 301 instances | Good server-state discipline |
| Raw `fetch(` calls | 28 instances | Review for missing error normalisation |
| Barrel export (`components/ui/index.ts`) | Missing | Mild DX friction |
| UI components with tests | 6 / 35 (~17%) | Low — expand coverage |
| Default exports in library code | 0 | Conforms to AGENTS.md |

---

## Findings

### TypeScript & Type Safety

| Severity | File | Line | Issue | Fix |
|----------|------|------|-------|-----|
| Low | `tsconfig.base.json` | 16 | `exactOptionalPropertyTypes: false` — allows implicit `undefined` on optional keys | Enable when team is ready for the breaking churn |
| Medium | `apps/web/src` | — | 268 `as` type assertions across the codebase (e.g. `JSON.parse(raw) as Partial<State>`, `document.documentElement.dataset.theme as Theme`) | Replace narrowable assertions with runtime type guards or Zod schemas |
| Low | `apps/web/src/stores/theme.ts` | 12 | `document.documentElement.dataset.theme as Theme` — no runtime validation | Add a discriminating check before cast |
| Low | `apps/web/src/stores/savedViews.ts` | 28 | `const o = v as Record<string, unknown>` inside `isSavedView` — unnecessary; `v` already narrowed to `object` | Use `Object.entries(v)` or refactor guard to avoid cast |

### Testing

| Severity | File | Line | Issue | Fix |
|----------|------|------|-------|-----|
| Low | `apps/web/vitest.config.ts` | 10–14 | No `coverage` reporter configured; CI cannot gate on thresholds | Add `coverage: { reporter: ['text', 'lcov'], thresholds: { branches: 70, functions: 70, lines: 70, statements: 70 } }` |
| Medium | `apps/web/src/components/ui/` | — | Only 6 of 35 UI primitives have test files (Badge, Button, Card, Dialog, Toast, form-primitives) | Add tests for Input, Select, Table, Tabs, Tooltip, etc. |
| Low | `apps/web/src/lib/auth.test.tsx` | — | High-quality test: covers stub + Clerk branches, lazy boundary, and documents *why* the lazy split exists (bundle size) | — (keep as exemplar) |

### Console Noise in Production

| Severity | File | Line | Issue | Fix |
|----------|------|------|-------|-----|
| Medium | `apps/web/src/main.tsx` | 84 | `console.error('[unhandledrejection]', event.reason)` — logs in production builds | Route to Pino / Sentry instead; gate behind `import.meta.env.DEV` |
| Low | `apps/web/src/main.tsx` | 104 | `navigator.serviceWorker.register('/sw.js').catch(console.error)` — bare `console.error` in prod | Replace with structured logger or silent fail |
| Low | `apps/web/src/components/ErrorBoundary.tsx` | 30 | `console.error('ErrorBoundary caught:', error, componentStack)` — acceptable for debugging but should also report to observability | Add `logger.error({ error, componentStack })` if Pino is available |

### Accessibility

| Severity | File | Line | Issue | Fix |
|----------|------|------|-------|-----|
| Low | `apps/web/src/components/account-intel/AccountIntelPanel.tsx` | 82–91 | Tab list uses `aria-selected` and `aria-controls` but lacks `role="tablist"` / `role="tab"` on the container and buttons | Add explicit `role="tablist"` to `<nav>` and `role="tab"` to each button |
| Low | `apps/web/src/components` | — | 250 `aria-*` attributes found — quantity is healthy, but spot-check for missing `aria-expanded` on custom dropdowns | Audit Dropdown / Select components for `aria-expanded` + `aria-haspopup` |

### State Management (Zustand)

| Severity | File | Line | Issue | Fix |
|----------|------|------|-------|-----|
| Low | `apps/web/src/stores/` | — | 9 stores; none use `zustand/middleware` (persist, devtools) — all hand-roll localStorage read/write | Migrate to `persist` middleware to remove boilerplate and gain hydration safety |
| Low | `apps/web/src/stores/preferences.ts` | 123–130 | `window.addEventListener('storage', …)` mutates store state outside React batching | Wrap `usePreferences.setState(next)` in a microtask or use Zustand subscribe pattern |
| Low | `apps/web/src/stores/ui.ts` | 44 | `mobileNavOpen` is not persisted to localStorage (intentional?) | Document if ephemeral; if not, add to `write()` |

### Component Hygiene

| Severity | File | Line | Issue | Fix |
|----------|------|------|-------|-----|
| Low | `apps/web/src/components/ui/` | — | No barrel export (`index.ts`) — consumers must import from deep paths | Add `components/ui/index.ts` exporting all public primitives |
| Low | `apps/web/src/` | — | 1 remaining `import React from 'react'` (old JSX transform) | Remove; project uses `"jsx": "react-jsx"` |
| Low | `apps/web/src/App.tsx` | 26–126 | 28 `lazy()` calls — good code splitting, but no `Suspense` fallback other than a single `<LoadingSpinner />` | Verify each route has a meaningful skeleton; avoid layout shift on slow networks |

### Hooks & React Patterns

| Severity | File | Line | Issue | Fix |
|----------|------|------|-------|-----|
| Medium | `apps/web/src/components/motion/AnimatedNumber.tsx` | 59 | `eslint-disable-next-line react-hooks/exhaustive-deps` | Verify missing deps are intentional; add comment with ticket reference |
| Medium | `apps/web/src/components/opportunity/BriefingDialog.tsx` | 29 | `eslint-disable-next-line react-hooks/exhaustive-deps` | Same as above |
| Medium | `apps/web/src/pages/TasksPage.tsx` | 136 | `eslint-disable-next-line react-hooks/exhaustive-deps` | Same as above |
| Low | `apps/web/src/pages/BidNoBidPage.tsx` | 179 | `eslint-disable react-hooks/set-state-in-effect` | Review — may indicate a derived-state smell |

### API & Data Fetching

| Severity | File | Line | Issue | Fix |
|----------|------|------|-------|-----|
| Low | `apps/web/src/` | — | 28 raw `fetch(` calls outside React Query | Wrap in a typed API client layer (`lib/api.ts`) to centralise error normalisation and auth headers |

### Lint Overrides

| Severity | File | Line | Issue | Fix |
|----------|------|------|-------|-----|
| Low | `apps/web/src/lib/auth.tsx` | 199–223 | 5× `eslint-disable-next-line react-refresh/only-export-components` | These are hook exports from a module that also exports JSX — acceptable, but consider splitting hooks into `auth.hooks.ts` |
| Low | `apps/web/src/lib/web-vitals.ts` | 171 | `eslint-disable-next-line no-console` — dev-only helper | Acceptable; ensure it is tree-shaken in prod |

---

## Positive Observations

1. **Zero `@ts-ignore` / `@ts-expect-error`** — team does not paper over type errors.
2. **Zero `any` type annotations** — codebase maintains strong typing.
3. **Zero `onClick` on `<div>` or `<span>`** — no obvious keyboard-accessibility traps.
4. **Zero TODO/FIXME/HACK/XXX** — code is either clean or tracked elsewhere.
5. **All Zustand stores are typed** — `create<StoreInterface>()` used consistently.
6. **Auth test is exemplary** — documents architectural intent (bundle-size regression guard) alongside behaviour.
7. **Heavy React Query usage (301)** — server state is well-separated from client state.
8. **No default exports in library code** — follows AGENTS.md conventions.

---

## Recommendations (Priority Order)

1. **Enable `coverage` in Vitest config** so CI can track test gaps.
2. **Add barrel export to `components/ui/`** to reduce deep-import churn.
3. **Audit the 268 `as` assertions** — start with `as any` (none found) and then `as Theme`, `as Partial<T>`, etc.
4. **Remove or gate `console.error` in `main.tsx`** — replace with Pino/Sentry in production.
5. **Expand UI primitive test coverage** from 6/35 to at least 20/35.
6. **Migrate stores to `zustand/middleware/persist`** to delete ~50 lines of hand-rolled localStorage logic per store.
7. **Add runtime validation** to `theme.ts` before casting `dataset.theme`.
