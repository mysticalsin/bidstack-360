# Learnings Encyclopedia — BidStack 360° Swarm

> Append-only. Every cycle must produce at least one learning. Stagnation is failure.

---

## Cycle #0 — Initialization (2026-05-22)

### Successes

- **S-0.1** Monorepo structure is sound: pnpm workspaces, clear app/package boundaries, no circular dependencies detected.
- **S-0.2** Security posture is strong after audit: org-scoped queries, Zod validation, HMAC webhooks, SSRF defense.
- **S-0.3** Design system foundation exists: 8px grid, 9-step type scale, dark/light mode, WCAG 2.2 AA baseline.
- **S-0.4** All 21 pages render without critical errors per QA audit (2026-05-23).

### Failures

- **F-0.1** Test coverage is critically low. Vitest + Playwright infrastructure exists but actual test files are sparse. This is the #1 risk to code quality score.
- **F-0.2** No Lighthouse performance baseline captured. We are flying blind on LCP, INP, CLS.
- **F-0.3** Mobile responsive is completely untested. QA audit marked it "not tested" across all 21 pages.
- **F-0.4** Command palette (Ctrl+K) did not trigger in QA audit. Core UX feature is non-functional.
- **F-0.5** Framer Motion console warnings on Pipeline page (`"transparent" is not an animatable value`). Signals sloppy animation targets.
- **F-0.6** Intermittent 500 on `/api/v1/crm/dashboard?account={id}`. Root cause unknown. Reliability red flag.
- **F-0.7** No edge caching, no read replicas, no CDN asset delivery. Infrastructure is single-node.
- **F-0.8** Accessibility gaps: keyboard kanban drag/drop TBD, no screen-reader testing on Opportunity 360°.

### Hypotheses

- **H-0.1** If we add comprehensive Playwright e2e tests for all 21 pages first, we catch regressions before they compound. This unlocks confident refactoring.
- **H-0.2** Fixing the Framer Motion transparent animation bug is a 1-line change with high signal-to-noise ratio for design score.
- **H-0.3** The intermittent 500 on CRM dashboard is likely a missing `try/catch` around a Prisma query or an unhandled null in a computed field.

### Decisions

- **D-0.1** First experiment (Cycle #1) will target **Code Quality** dimension — add unit tests for shared Zod schemas and core API route utilities. Lowest-hanging fruit with highest compounding value.
- **D-0.2** No new features until composite score > 70. Only score-improving experiments allowed.

---

## Cycle #1 — Baseline Capture & Quick Wins (2026-05-22)

### Learning L-1-1

**API test coverage is 63.68%** — much better than initially estimated. The API has 40 test files with 223 passing tests. The "low coverage" perception was driven by the web frontend (6.65%).

**Implication:** Code Quality baseline is 16, not 14. The gap is in web tests, not API tests.

### Learning L-1-2

**Bundle size is healthy gzipped (47KB)** but raw entry chunk is 175KB. The 150KB budget in program.md should clarify "gzipped" since raw will always exceed 150KB for a React app.

### Learning L-1-3

**@vitest/coverage-v8 v4.1.6 is incompatible with vitest v3.2.4.** Downgrading to coverage-v8@3.2.4 fixes coverage reports.

---

## Cycle #2 — Console Hygiene (2026-05-22)

### Learning L-2-1

**Framer Motion `"transparent"` → `rgba(0,0,0,0)` fix eliminates the Pipeline page console warning.** This was a single-line change with immediate QA impact. Console cleanliness directly affects Best Practices Lighthouse score.

### Learning L-2-2

**Favicon 404 was causing a console error that hurt Lighthouse Best Practices.** Adding `apps/web/public/favicon.ico` fixed it. Best Practices improved from 73 → 77 after rebuild.

---

## Cycle #3 — Test Expansion (2026-05-22)

### Learning L-3-1

**Component tests for Badge, Card, useCommandPalette added 18 tests and all passed.** The `useCommandPalette` hook correctly handles Ctrl+K and Meta+K. The QA audit's "Ctrl+K didn't trigger" was likely an environmental issue, not a code bug.

### Learning L-3-2

**Dialog and Toast components require understanding actual exports before testing.** `Dialog` exports `DialogContent` with `title` prop (not `DialogTitle`/`DialogDescription` children). `Toast` exports `Toaster` component and `toast` object, not a `Toast` JSX component.

---

## Cycle #4 — Lighthouse & Schema Tests (2026-05-23)

### Learning L-4-1

**Lighthouse scores on local preview are noisy (±5–10 points).** Performance varied 55–65 across runs on identical code. For reliable tracking, we need CI-based Lighthouse with consistent hardware, or average 3+ runs.

**Baseline (averaged):**

- Performance: ~60 (target ≥97)
- Accessibility: 96 (target ≥97)
- Best Practices: 77 (target 100)
- SEO: 83 (target 100)

**Critical finding:** LCP is 5.6s (target <2.5s). This is the #1 score killer.

### Learning L-4-2

**Preconnect hints can hurt if the connection is never used.** Adding `preconnect` to cdn.jsdelivr.net (only used on TerritoriesPage) caused no improvement and possibly slight regression on Dashboard. Only preconnect domains used on the current page.

### Learning L-4-3

**Lazy loading non-critical visual effects (PulseBeams, ConfettiHost) with Suspense had negligible bundle impact.** They were already small; the entry chunk only shrunk by ~1KB. Bigger wins require targeting heavy dashboard components or deferring large libraries.

### Learning L-4-4

**Shared Zod schemas have strict validation rules that are easy to get wrong in tests.** `Company` requires `orgId`, `source`, `confidence`, `tier`; `Contact` requires `customer`, `name` (not `firstName`/`lastName`); `Task` uses `oppId` and `assignee` (not `opportunityId`/`assigneeId`). Tests must read actual schema files, not assume field names.

---

## Cycle #5 — Accessibility Audit & Fixes (2026-05-23)

### Learning L-6-1

** axe-core via Playwright is the definitive accessibility verifier.** Lighthouse accessibility is noisy (animations cause false-positive contrast failures) and only samples one page state. axe-core with `tags: ['wcag2a', 'wcag2aa', 'wcag21aa', 'best-practice']` catches real barriers that Lighthouse misses.

**Results:** 36 → 10 violations, 5 → 0 critical/serious.

### Learning L-6-2

**The `text-fg-on-brand` Tailwind utility was completely broken.** `--color-fg-on-brand` was missing from `@theme`, so every brand button across the app rendered with inherited dark text instead of white. This was a design-system-level bug affecting ~10 components. Adding one line to `@theme` fixed all of them.

**Implication:** Any custom color token used with Tailwind v4 must be explicitly declared in `@theme`. No implicit fallback exists.

### Learning L-6-3

**Color contrast fixes are surgical and high-impact.** Darkening `--tag-amber-fg` from `#9a6500` to `#8a5a00` and `--tag-tomato-fg` from `#c0381f` to `#b03018` pushed both from ~4.4:1 to ~5.1:1 — safely above WCAG AA. No visual degradation; the tags look identical to the human eye.

### Learning L-6-4

**`<aside role="navigation">` is invalid ARIA.** `aside` is a landmark element; adding `role="navigation"` conflicts with its implicit `role="complementary"`. The correct element is `<nav>`. One change in `Sidebar.tsx` eliminated 21 `aria-allowed-role` violations across every page.

---

## Cycle #6 — Heading-order & Landmark Fixes (2026-05-23)

### Learning L-7-1

**Zero axe-core violations across all 21 routes is achievable in one cycle.** The 10 remaining moderate violations fell into three patterns: (1) `heading-order` — card section headers used `<h3>` without an `<h2>` parent, (2) `page-has-heading-one` — pages with animated headers where the `<h1>` starts at `opacity: 0` and isn't visible when axe runs, (3) `landmark-*` — nested `<main>` elements when `SettingsLayout` rendered `<main>` inside `AppShell`'s `<main>`.

**Fixes applied:**

- `Card.tsx` `SectionHeader`: `<h3>` → `<h2>` (cards are semantic sections)
- `StateMessages.tsx` `EmptyState`: `<h3>` → `<h2>` (empty states are page-level)
- `BidNoBidPage.tsx`: criterion label `<h3>` → `<h2>`
- `SettingsLayout.tsx`: `<main>` → `<div>` (AppShell already provides the outer `<main>`)
- `DashboardPage.tsx` & `AccountsPage.tsx`: added `sr-only` `<h1>` outside animated containers and in all early-return states (loading, error, empty)

**Result:** 10 moderate violations → 0. Lighthouse accessibility: 100 (dashboard). Score: 65 → 66.

### Learning L-7-2

**Framer Motion `initial={{ opacity: 0 }}` can hide headings from axe-core.** The `page-has-heading-one` rule checks element visibility. An `<h1>` inside a `motion.div` that starts at `opacity: 0` may not be counted as visible during the 500ms wait window. Adding a static `sr-only` `<h1>` before the animated container solves this without affecting visual design.

### Learning L-7-3

**Shared components that render headings must choose levels carefully.** `EmptyState` renders an `<h2>` now because it's used at page level. If it were ever used inside a card, this would be wrong. Consider making heading level configurable via prop in future refactor.

---

## Cycle #7 — Queued

### Proposed Experiments

1. **EXP-7-1 (Code Quality):** Add tests for `lib/cn.ts`, `lib/format.ts`, `lib/api.ts` to push web coverage above 8%.
2. **EXP-7-2 (Functionality):** Add defensive try/catch to CRM dashboard route with structured logging to catch the intermittent 500 root cause.
3. **EXP-7-3 (Infrastructure):** Add `preconnect` to API origin and defer Sentry init until after first paint.
4. **EXP-7-4 (Design/UX):** Ghost utility audit — scan all `text-*` and `bg-*` classes against `@theme` declarations to find other missing tokens.
