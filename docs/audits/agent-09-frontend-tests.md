# Agent 09 — Frontend Tests Audit Report

**Scope:** `apps/web/src/**/*.test.{ts,tsx}`, `apps/web/e2e/**/*.spec.ts`, Playwright config, Vitest config  
**Rubric dimension:** Code 25 + Functional 25 (scaled to 0–100)  
**Date:** 2026-05-23  
**Auditor:** Kimi Code CLI (read-only)

---

## 1. Score: 72 / 100

**Rationale:** The E2E suite is mature, well-architected, and covers accessibility, performance, visual regression, and responsive breakpoints. The unit-test suite, however, is shallow—dominated by render-only smoke tests with almost no user-interaction coverage, no MSW, and no coverage thresholds. The gap between E2E quality and unit-test depth is the primary drag on the score.

---

## 2. Strengths

- **Comprehensive accessibility gating with axe-core**  
  `apps/web/e2e/a11y/axe.spec.ts:42–87` scans 19 routes against WCAG 2.2 AA (`wcag2a`, `wcag2aa`, `wcag21aa`, `wcag22aa`, `best-practice`), hard-fails on `critical`/`serious` violations, and logs non-blocking issues as annotations. `apps/web/e2e/a11y/color-contrast.spec.ts:35` adds a narrow `color-contrast` rule sweep in both light and dark modes.

- **Performance budgets enforced in CI**  
  `apps/web/e2e/performance/core-web-vitals.spec.ts:24–28` sets stricter-than-public budgets (LCP < 2.0 s, CLS < 0.05, INP < 100 ms) and uses `PerformanceObserver` injection to measure real browser paint timings. `apps/web/e2e/performance/bundle-size-budget.spec.ts:61–94` gates individual JS chunks at 150 KB gzipped and total payload at 400 KB gzipped.

- **Visual-regression baselines for mobile & tablet**  
  `apps/web/e2e/responsive/mobile-iphone-se.spec.ts:49–58` and `tablet-ipad.spec.ts:67–75` capture `toHaveScreenshot` baselines with a 2 % pixel-diff tolerance across 6 key routes per device profile.

- **Auth lazy-loading contract tested in unit tests**  
  `apps/web/src/lib/auth.test.tsx:62–112` documents _why_ the lazy Clerk boundary exists (Frontend B2 from the 2026-05-10 deep audit) and asserts both stub-mode synchronous mount and Clerk-mode async bridge behavior, including the defensive empty-string key case.

- **Auto-orchestrated E2E server bootstrap**  
  `apps/web/playwright.config.ts:22–43` boots the API and Vite preview in sequence, probes `/health`, and wires stub-auth env vars. This makes `pnpm e2e` a single-command operation with no manual server management.

- **Page-Object Model (POM) pattern across E2E**  
  `apps/web/e2e/pages/LeadsPage.ts`, `LoginPage.ts`, `PipelinePage.ts`, etc. encapsulate selectors and business actions (e.g., `createLead`, `dragCardToColumn`), keeping specs declarative and DRY.

---

## 3. P0 Gaps (Critical)

### 3.1 Unit tests lack user-interaction coverage

**Files:** `apps/web/src/components/ui/Button.test.tsx`, `Dialog.test.tsx`, `Tabs.test.tsx`, `Input.test.tsx`, etc.  
**Evidence:**

```tsx
// Button.test.tsx:6–11
it('renders with primary variant by default', () => {
  render(<Button>Click me</Button>);
  const btn = screen.getByRole('button', { name: /click me/i });
  expect(btn).toBeDefined();
  expect(btn.tagName).toBe('BUTTON');
});
```

Of the 25 unit-test files, **zero** import `@testing-library/user-event`. The single use of `fireEvent` lives in `CommandPalette.test.tsx:79` (`fireEvent.change`). Components like `Tabs`, `Dialog`, `Toast`, and `Input` have no tests for clicks, focus, keyboard navigation, or state changes. This means regressions in interaction logic (the most breakable surface of a UI) are only caught in E2E.

### 3.2 No MSW (Mock Service Worker) — brittle module-level mocks

**Files:** `apps/web/src/hooks/useProducts.test.tsx`, `OpportunitiesPage.test.tsx`, `apiMutationBodies.test.tsx`  
**Evidence:**

```tsx
// useProducts.test.tsx:8–21
vi.mock('@/lib/api', () => ({
  api: vi.fn(async () => ({ ... })),
}));
```

All API mocking is done via `vi.mock()` at the module level. This:

- Prevents testing error responses or network-edge cases (timeouts, 500s, race conditions).
- Makes tests order-dependent because `vi.mock()` is hoisted.
- Tightly couples tests to internal module paths rather than HTTP contracts.

### 3.3 E2E suite has 88 conditional `test.skip` calls, masking data-dependency fragility

**Files:** `apps/web/e2e/flows/auth.spec.ts`, `lead-management.spec.ts`, `audit-log.spec.ts`, etc.  
**Evidence:**

```ts
// lead-management.spec.ts:28–30
const hasLinks = (await leads.leadLinks.count()) > 0;
test.skip(!hasLinks, 'No lead rows — seeded data absent');
```

Across 44 spec files there are **88** `test.skip` invocations. Many skips are data-dependent ("seeded data absent"). In CI this can silently reduce the executed test surface without failing the build, leading to false confidence.

### 3.4 Single-browser E2E matrix

**File:** `apps/web/playwright.config.ts:60–65`  
Only `chromium-desktop` is configured. No Firefox or WebKit projects. Cross-browser layout, focus-ring, and flexbox bugs (common in Safari) are not caught in CI.

---

## 4. P1 Gaps (Important)

### 4.1 No coverage thresholds or reporting

**File:** `apps/web/vitest.config.ts:10–14`  
The Vitest config has no `coverage` block (no `istanbul` or `v8` provider), and `apps/web/package.json` contains no coverage script. There is no quantitative gate preventing untested files from merging.

### 4.2 `happy-dom` instead of `jsdom` may miss a11y behaviors

**File:** `apps/web/vitest.config.ts:11`

```ts
environment: 'happy-dom',
```

While faster, `happy-dom` historically lacks full `Element` semantics (e.g., `offsetHeight`, some focus events, certain `aria-*` computations). The project has no verification that `happy-dom` parity is sufficient for the a11y assertions made in `form-primitives.test.tsx`.

### 4.3 Limited async testing patterns in unit tests

**Evidence:** Only **2** occurrences of `waitFor`/`findBy` across all 25 unit-test files:

- `auth.test.tsx:106` (`waitFor` for lazy Clerk boundary)
- `OpportunitiesPage.test.tsx` uses none (synchronous render assertions only)

Async UI states (loading → data → empty) are asserted with immediate `screen.queryByRole`, which can pass falsely if React hasn't flushed the next render cycle.

### 4.4 Shallow Toast tests

**File:** `apps/web/src/components/ui/Toast.test.tsx:5–22`

```tsx
it('toast.success does not throw', () => {
  expect(() => toast.success('Saved')).not.toThrow();
});
```

The test only verifies the imperative API doesn't throw. It does not assert DOM presence, auto-dismiss timing, stacking order, or screen-reader announcements.

### 4.5 Tooltip tests do not assert a11y attributes

**File:** `apps/web/src/components/ui/Tooltip.test.tsx:7–35`  
Tests verify children render but do not assert `aria-describedby`, hover-trigger behavior, or focus management.

---

## 5. P2 Gaps (Nice-to-have)

### 5.1 No desktop visual-regression baselines

Mobile (`iPhone SE`) and tablet (`iPad Mini`) have screenshot baselines, but desktop Chromium does not. Layout regressions at full width (e.g., dashboard grid collapse, pipeline board overflow) are not visually diffed.

### 5.2 No Storybook or component-screenshot tests

There is no `*.stories.tsx` test harness or Chromatic/Argos integration. Visual regression is purely page-level E2E.

### 5.3 `waitForTimeout` used in E2E specs

**Count:** 16 occurrences across 53 E2E files.  
Examples:

- `axe.spec.ts:51` (`await page.waitForTimeout(500)`)
- `color-contrast.spec.ts:33` (`await page.waitForTimeout(300)`)
- `mobile-iphone-se.spec.ts:52` (`await page.waitForTimeout(500)`)

These are anti-patterns that increase flakiness. Prefer `waitForFunction`, `waitForSelector`, or component-specific `data-testid` readiness signals.

### 5.4 Missing unit tests for complex stateful components

- `CommandPalette.test.tsx` only tests name filtering; no keyboard navigation, no empty state, no action execution.
- `ErrorBoundary.test.tsx` tests reload click but not error-boundary reset behavior or Sentry integration.
- `KeyboardShortcutsHelp.test.tsx` not examined in depth, but likely limited given project patterns.

### 5.5 Currency test uses `console.log` in test body

**File:** `apps/web/src/stores/currency.test.tsx:132–135`

```tsx
console.log('--- DIAGNOSTIC ---');
console.log('Display Currency (from store):', useCurrencyStore.getState().currency);
```

Per `AGENTS.md` conventions ("No `console.log` in shipped code"), diagnostic logging should be removed or redirected to a test reporter.

---

## 6. Evidence (Code Snippets)

### 6.1 Playwright auto-orchestration

```ts
// apps/web/playwright.config.ts:22–43
const servers = process.env.E2E_BASE_URL
  ? undefined
  : [
      {
        command: `pnpm exec cross-env PORT_API=${API_PORT} ... pnpm --filter @bidstack/api exec tsx src/main.ts`,
        url: `${API_URL}/health`,
        reuseExistingServer,
        timeout: 120_000,
        stdout: 'pipe',
        stderr: 'pipe',
      },
      {
        command: `pnpm exec cross-env ${webEnv} pnpm --filter @bidstack/web build && ... vite preview ...`,
        url: baseURL,
        reuseExistingServer,
        timeout: 120_000,
        stdout: 'pipe',
        stderr: 'pipe',
      },
    ];
```

### 6.2 Axe-core blocking-violation logic

```ts
// apps/web/e2e/a11y/axe.spec.ts:59–71
const blockingViolations = results.violations.filter(
  (v) => BLOCKING_IMPACTS.includes(v.impact as (typeof BLOCKING_IMPACTS)[number]),
);
if (blockingViolations.length > 0) {
  const summary = blockingViolations.map((v) => ...).join('\n');
  throw new Error(
    `${blockingViolations.length} critical/serious axe violation(s) on ${route.path}:\n${summary}`,
  );
}
```

### 6.3 Auth lazy-load unit-test contract

```tsx
// apps/web/src/lib/auth.test.tsx:96–112
it('lazy-loads Clerk and bridges its hooks into the unified context', async () => {
  render(
    <AuthProvider publishableKey="pk_test_dummy">
      <Probe />
    </AuthProvider>,
  );
  await waitFor(() => {
    expect(screen.getByTestId('email').textContent).toBe('real@mantu.com');
  });
  expect(screen.getByTestId('loaded').textContent).toBe('true');
});
```

### 6.4 No user-event usage

```bash
$ grep -r "userEvent\|user-event" apps/web/src --include="*.test.tsx" --include="*.test.ts"
# (no output)
```

### 6.5 E2E conditional skip pattern

```ts
// apps/web/e2e/flows/auth.spec.ts:16–18
test('stub-auth mode auto-authenticates and lands on app', async ({ page }) => {
  test.skip(!STUB_MODE, 'Only applicable in stub-auth mode');
  ...
});
```

### 6.6 Bundle-size budget enforcement

```ts
// apps/web/e2e/performance/bundle-size-budget.spec.ts:61–94
test('no single JS chunk exceeds 150 KB gzipped', async () => {
  const LIMIT_BYTES = 150 * 1024;
  const oversized: Array<{ file: string; kb: number }> = [];
  for (const file of files) {
    const gz = await gzippedSize(file);
    if (gz > LIMIT_BYTES) {
      oversized.push({ file: file.split(/[\\/]/).pop() ?? file, kb: Math.round(gz / 1024) });
    }
  }
  expect(oversized.length).toBe(0);
});
```

---

## 7. Summary Table

| Category                              | Count / Status                    |
| ------------------------------------- | --------------------------------- |
| Unit-test files (`*.test.{ts,tsx}`)   | 25                                |
| E2E spec files (`*.spec.ts`)          | 44                                |
| Vitest config                         | `apps/web/vitest.config.ts`       |
| Playwright config                     | `apps/web/playwright.config.ts`   |
| Browser projects in Playwright        | 1 (Chromium desktop only)         |
| Axe routes covered                    | 19                                |
| Responsive device profiles tested     | 3 (iPhone SE, Pixel 7, iPad Mini) |
| `test.skip` occurrences in E2E        | 88                                |
| `waitForTimeout` occurrences in E2E   | 16                                |
| `@testing-library/user-event` imports | 0                                 |
| MSW usage                             | None                              |
| Coverage configuration                | None                              |
| Visual-regression (desktop)           | None                              |

---

## 8. Recommendations (Prioritized)

1. **Adopt MSW** for unit and hook tests to replace brittle `vi.mock('@/lib/api')` patterns. This enables testing error states, latency, and race conditions deterministically.
2. **Add `@testing-library/user-event`** and write interaction tests for at least `Button`, `Tabs`, `Dialog`, `Input`, and `CommandPalette` (click, keyboard, focus).
3. **Replace data-dependent `test.skip` with seeded fixtures** in E2E so the CI matrix always executes the full suite. Use `test.beforeAll` to seed via the API if necessary.
4. **Add a second browser project** (WebKit minimum) to `playwright.config.ts` to catch Safari-specific layout/focus regressions.
5. **Configure Vitest coverage** (`@vitest/coverage-v8`) with a threshold gate (e.g., 70 % functions) in CI.
6. **Remove `waitForTimeout` anti-patterns** from E2E in favor of explicit readiness selectors or `waitForFunction`.
7. **Add desktop screenshot baselines** to the visual-regression suite.
8. **Remove diagnostic `console.log` from `currency.test.tsx`** to align with project logging conventions.
