# MISTAKES — BidStack 360°

Per Tony's `mistakes-protocol.md`:

- Read this BEFORE every task
- Log EVERY mistake immediately (root cause, prevention rule, category)
- Never repeat a logged mistake — if a repeat is detected, HALT and escalate
- After completing a non-trivial fix, write a `docs/solutions/` entry for reuse

---

## Format

```
### [TIMESTAMP] CATEGORY: Short description
- **What went wrong:** ...
- **Root cause:** ...
- **Prevention rule:** ...
- **Files affected:** ...
```

Categories: BUG, ARCHITECTURE, SECURITY, PERFORMANCE, UX, TESTING, INFRA, PROCESS.

---

## Ledger

<!-- New entries appended at the top of this section. -->

### 2026-05-11 UX: Broad stat span selector broke animated metrics

- **What went wrong:** `.account-source-stat span` applied `display: block` to nested spans inside `AnimatedMetric`, causing currency values to stack vertically.
- **Root cause:** The old CSS selector targeted all descendant spans instead of only the direct label span.
- **Prevention rule:** For stat/card typography selectors, prefer direct-child selectors before introducing nested animated/text components.
- **Files affected:** `apps/web/src/index.css`.

### 2026-05-11 UX: Animated currency metric wrapped mid-value

- **What went wrong:** The new animated metric split currency prefix, number, and suffix into separate inline nodes, so a narrow KPI tile could wrap `€6.33M` across multiple lines.
- **Root cause:** I animated the numeric portion without wrapping the assembled metric in a no-wrap container.
- **Prevention rule:** Any animated metric that separates prefix/number/suffix must render inside a single `white-space: nowrap` wrapper.
- **Files affected:** `apps/web/src/components/motion/AnimatedMetric.tsx`, `apps/web/src/index.css`.

### 2026-05-11 TOOLING: In-app browser click bridge timed out on dense page

- **What went wrong:** The in-app browser locator found account cockpit links, but the click operation timed out inside the browser automation bridge on the motion-heavy dashboard.
- **Root cause:** I relied on the in-app click path for a dense animated page instead of using direct route navigation once link presence had already been verified.
- **Prevention rule:** For browser QA on dense local pages, verify link presence in the in-app browser, then use direct route navigation or external Playwright for click-through/error collection.
- **Files affected:** none; validation harness only.

### 2026-05-11 TOOLING: Reused persistent browser variable name

- **What went wrong:** I declared `const links` in a Node-backed browser session where that identifier already existed from a prior verification call.
- **Root cause:** I forgot that the browser automation kernel persists top-level bindings across calls.
- **Prevention rule:** In persistent browser sessions, use unique verification variable names or assign to `globalThis` once; avoid redeclaring generic names like `links`.
- **Files affected:** none; validation harness only.

### 2026-05-11 BUG: Motion rail used wrong provider health field

- **What went wrong:** I mapped dashboard provider health with `provider.name`, but the shared API contract exposes the display field as `provider.provider`.
- **Root cause:** I inferred the object shape from nearby UI copy instead of checking the shared schema/typecheck before wiring the rail.
- **Prevention rule:** When consuming dashboard health/provider objects, use the schema field names (`provider`, `status`, `latencyMs`, `lastCheckedAt`, `message`) rather than guessed display names.
- **Files affected:** `apps/web/src/pages/AccountsPage.tsx`.

### 2026-05-11 BUG: Animated metric assumed array index narrowing

- **What went wrong:** `AnimatedMetric` checked that `matches.length === 1` but TypeScript still treated `matches[0]` as possibly undefined.
- **Root cause:** I relied on array length narrowing that TypeScript does not guarantee for indexed reads.
- **Prevention rule:** After collecting regex matches, assign `const match = matches[0]` and guard it explicitly before using capture groups or indexes.
- **Files affected:** `apps/web/src/components/motion/AnimatedMetric.tsx`.

### 2026-05-11 TOOLING: Large patch anchored on mojibake text

- **What went wrong:** I tried to patch `AccountsPage.tsx` with a large context block that included existing mojibake copy, so `apply_patch` could not find the expected lines.
- **Root cause:** I relied on copied terminal output containing replacement characters instead of anchoring on stable ASCII structure.
- **Prevention rule:** For files with known encoding artifacts, patch in small chunks around ASCII-only anchors or replace a clearly bounded function wholesale.
- **Files affected:** none; failed patch only.

### 2026-05-11 TOOLING: In-app browser API called without Playwright namespace

- **What went wrong:** I called `tab.getByRole(...)` while validating the running app, but the in-app browser surface exposes locators through `tab.playwright.getByRole(...)`.
- **Root cause:** I mixed external Playwright page APIs with the Browser plugin's wrapped tab API during a quick smoke check.
- **Prevention rule:** In the in-app browser runtime, all locator/screenshot/load-state calls must go through `tab.playwright.*`; reserve bare `page.*` calls for standalone Playwright scripts only.
- **Files affected:** none; validation harness only.

### 2026-05-11 UX: Tech stack icon CDN returned brand 404s

- **What went wrong:** The cockpit tech-stack pills used Simple Icons slugs that now return 404 for several common enterprise brands, creating browser console errors on account detail pages.
- **Root cause:** I assumed old Simple Icons slugs for Microsoft, AWS, CrowdStrike, and others would remain stable instead of validating the current CDN behavior.
- **Prevention rule:** For decorative tech logos, prefer a resilient domain favicon path with initials fallback, or validate icon CDN slugs in tests before shipping them.
- **Files affected:** `apps/web/src/components/company/TechLogo.tsx`.

### 2026-05-11 UX: Logo fallback produced browser console noise

- **What went wrong:** Account dashboard QA surfaced direct `/favicon.ico` fallbacks that logged failed resource errors, plus a React warning for the `fetchPriority` image prop in the current React/Vite runtime.
- **Root cause:** The logo component treated direct favicons as a harmless fallback, but failed image fetches still pollute browser diagnostics; React 18 also warns on that camelCase image hint.
- **Prevention rule:** Company logos should prefer stored/provider URLs and a resilient favicon service fallback before any direct favicon URL, and avoid image props that the current React runtime does not recognize.
- **Files affected:** `apps/web/src/components/company/CompanyLogo.tsx`.

### 2026-05-11 BUG: Health score render used mutable cursor

- **What went wrong:** The new health donut built its conic-gradient stops by mutating a local `cursor` during render, and TypeScript also flagged indexed health counts as possibly undefined.
- **Root cause:** I wrote the render calculation imperatively instead of using an immutable accumulator and explicit `?? 0` fallbacks for record access.
- **Prevention rule:** Derived render data in React components should be built with pure `map`/`reduce` objects and guarded record reads, especially when eslint immutability rules are active.
- **Files affected:** `apps/web/src/components/cockpit/HealthScoreCard.tsx`.

### 2026-05-11 BUG: Tooltip index narrowed visually but not for TypeScript

- **What went wrong:** I added a chart tooltip under a `tooltip ? ... : null` branch but continued indexing arrays with `hover`, which TypeScript still treated as `number | null`.
- **Root cause:** I assumed the derived `tooltip` object would narrow the original state variable, but TypeScript does not connect those conditions.
- **Prevention rule:** For nullable UI indexes, create a non-null derived object that carries both the index and the point data, then render from that object instead of reusing the nullable state.
- **Files affected:** `apps/web/src/components/sales/MonthlySalesChart.tsx`.

### 2026-05-11 TOOLING: Playwright package name mismatch

- **What went wrong:** After moving the smoke script into the web workspace, I still imported `playwright` directly even though this package exposes the runtime through `@playwright/test`.
- **Root cause:** I assumed the transitive Playwright package name was directly resolvable from pnpm's isolated workspace layout.
- **Prevention rule:** In this repo, ad hoc browser smoke scripts should import from `@playwright/test` unless `playwright` is explicitly listed as a direct dependency.
- **Files affected:** none; validation tooling only.

### 2026-05-11 TOOLING: Root Playwright require failed

- **What went wrong:** I ran a root-level Node smoke script with `require('playwright')`, but the browser dependency is available through the web workspace tooling, not root module resolution.
- **Root cause:** I switched fallback strategies quickly after in-app screenshot timeouts and did not verify package resolution from the current working directory.
- **Prevention rule:** Browser smoke scripts should run through `pnpm --filter @bidstack/web exec ...` or from `apps/web` so Playwright dependencies resolve predictably.
- **Files affected:** none; validation tooling only.

### 2026-05-11 TOOLING: Browser screenshot path timed out

- **What went wrong:** The Playwright screenshot call timed out during visual QA of the sales dashboard.
- **Root cause:** I used the heavier screenshot path first instead of the in-app browser's visible capture path after a motion-heavy page update.
- **Prevention rule:** For quick visual QA in the Codex in-app browser, try `cua.get_visible_screenshot()` first; fall back to Playwright screenshots only when a full-page capture is necessary.
- **Files affected:** none; validation tooling only.

### 2026-05-11 TOOLING: Browser wait used unsupported `networkidle`

- **What went wrong:** I called the in-app browser wait helper with `networkidle`, and the runtime rejected that state.
- **Root cause:** I trusted the skill API reference over the runtime's narrower implementation.
- **Prevention rule:** For this browser runtime, use `load` or `domcontentloaded` waits unless `networkidle` support has been confirmed in the current session.
- **Files affected:** none; validation sequencing only.

### 2026-05-11 PROCESS: Partial Browser skill read

- **What went wrong:** I read only the first chunk of the Browser skill file even though the skill explicitly requires reading the entire `SKILL.md` before browser work.
- **Root cause:** I used a quick `Select-Object -First` habit for context minimization on a file whose instructions overrode that shortcut.
- **Prevention rule:** When a skill says to read the entire file, use one full-file read before any related tool action, even if the first section appears sufficient.
- **Files affected:** none; process log only.

### 2026-05-11 BUG: Mantu official favicon attributed as generic favicon

- **What went wrong:** The enrichment helper picked the favicon fallback source before the Mantu official-website override, so Mantu's official favicon was serialized as `favicon` instead of `official_website`.
- **Root cause:** I changed logo source precedence while extracting a shared enrichment helper and did not preserve the Mantu-specific attribution rule.
- **Prevention rule:** For canonical seed accounts with locked attribution, assert both logo URL and logo source after any enrichment refactor.
- **Files affected:** `apps/api/src/routes/crm.ts`.

### 2026-05-11 PROCESS: Repeated stale shared dist validation sequence

- **What went wrong:** I ran API/web typechecks in parallel with `@bidstack/shared` build after adding a shared CRM contract, so consumers saw stale dist output and failed to import `CompanyAutopopulateResponse`.
- **Root cause:** I treated "shared build is included in the same parallel batch" as equivalent to "shared build completed before consumers start", which repeated an existing stale-dist failure mode.
- **Prevention rule:** Shared contract edits require a completed serial `pnpm --filter @bidstack/shared build` before any consumer package validation starts. Do not parallelize that first build.
- **Files affected:** none; validation sequencing only.

### 2026-05-11 BUG: New shared schema consumed before dist build completed

- **What went wrong:** API route registration and consumer typechecks saw an undefined/missing `CompanyAutopopulateResponse` because consumer checks started before the rebuilt shared dist was available.
- **Root cause:** I diagnosed it as a missing export before confirming the source barrel and dist output; the true issue was validation order.
- **Prevention rule:** For shared contract edits, verify source export and completed dist output before starting API/web route tests.
- **Files affected:** `packages/shared/src/schemas/crm.ts`, `packages/shared/src/index.ts`, `apps/api/src/routes/crm.ts`, `apps/web/src/hooks/useAutopopulateSalesCompanies.ts`.

### 2026-05-11 TOOLING: Browser smoke used unsupported networkidle state

- **What went wrong:** The in-app browser runtime rejected `waitForLoadState({ state: "networkidle" })` during the sales page smoke.
- **Root cause:** I followed generic Playwright habit instead of verifying the local browser runtime's supported load-state behavior.
- **Prevention rule:** For this browser plugin, prefer `domcontentloaded` or a concrete DOM/screenshot check after reload unless `networkidle` has already been proven supported in the current runtime.
- **Files affected:** none; browser smoke only.

### 2026-05-11 BUG: Open enrichment metadata was too wide for Prisma JSON

- **What went wrong:** The API route stored open-provider metadata typed as `Record<string, unknown>`, which TypeScript correctly rejected as wider than Prisma's JSON input contract.
- **Root cause:** I used Zod/shared metadata types directly at the Prisma write boundary instead of narrowing them to `Prisma.InputJsonValue`.
- **Prevention rule:** Before assigning provider metadata to Prisma JSON fields, cast only at the final write boundary or build the object as a `Prisma.InputJsonObject` with JSON-compatible values.
- **Files affected:** `apps/api/src/routes/crm.ts`.

### 2026-05-11 TOOLING: Prettier was not run before checking formatting

- **What went wrong:** `pnpm format:check` failed on the new open enrichment provider and CRM route.
- **Root cause:** I added multi-line TypeScript objects and ran the check before formatting the touched files.
- **Prevention rule:** After adding a new TypeScript file or large object literal, run `pnpm format -- <files>` or Prettier on the touched files before `format:check`.
- **Files affected:** `apps/api/src/providers/company-open-enrichment.ts`, `apps/api/src/routes/crm.ts`.

### 2026-05-11 TOOLING: Patch context copied mojibake instead of source text

- **What went wrong:** My first `CompanyLogo` patch failed because I copied the terminal-rendered mojibake form of an em dash instead of the actual source line.
- **Root cause:** I trusted `Get-Content` rendering for a line containing non-ASCII punctuation.
- **Prevention rule:** When a patch misses on a displayed non-ASCII line, re-read the exact line with `Select-String` or patch around ASCII-only anchors.
- **Files affected:** none; the failed patch did not mutate files.

### 2026-05-11 TOOLING: Browser smoke reused a persistent const name

- **What went wrong:** My first in-app browser smoke cell redeclared `snapshot`, which already existed in the persistent browser session, so the check failed before running.
- **Root cause:** I forgot the browser execution context keeps top-level bindings between calls.
- **Prevention rule:** Use unique names for browser smoke variables or a short scratch block when values do not need to persist.
- **Files affected:** none.

### 2026-05-11 TOOLING: Inline TSX probe used wrong package context

- **What went wrong:** I tried to run an inline `tsx` probe from the repo root and then through a filtered package command, which first failed to resolve `tsx` and then imported the API server from the wrong working directory.
- **Root cause:** I mixed root-relative imports with pnpm's package-scoped execution context instead of using the existing Vitest/route tests as the debugging surface.
- **Prevention rule:** For BIDCRM route debugging, prefer focused Vitest tests or `server.inject` inside an existing test file. If an inline probe is unavoidable, run it from the target package directory with package-relative imports and a short timeout.
- **Files affected:** none.

### 2026-05-11 BUG: Malformed Apollo queue patch left duplicate code

- **What went wrong:** My first Apollo job-signing patch left a duplicate tail block in `apps/api/src/queues/company-enrich-apollo.ts` and enqueued the unsigned job instead of the signed payload.
- **Root cause:** I edited the enqueue block too broadly and did not immediately re-read the changed file before continuing.
- **Prevention rule:** After any security-boundary patch that changes control flow, re-open the exact edited file before moving on and verify the payload variable is the value actually passed across the boundary.
- **Files affected:** `apps/api/src/queues/company-enrich-apollo.ts`.

### 2026-05-11 TOOLING: Repeated Prisma generate while API server locked Windows DLL

- **What went wrong:** I reran the root `pnpm typecheck` while the local API dev server was live, so `prisma generate` again failed to rename `query_engine-windows.dll.node`.
- **Root cause:** I parallelized validation after restarting the API for browser QA and did not re-check for DB-client-owning Node processes before the root gate.
- **Prevention rule:** Any root gate containing `pnpm db:generate` must be preceded by a BIDCRM API/worker process check and stop step, even if the API was started only minutes earlier for QA.
- **Files affected:** none; validation sequencing only.

### 2026-05-11 TESTING: Odoo autocomplete response source widened to string

- **What went wrong:** I returned an Odoo autocomplete `source` through a nested ternary without annotating it, so TypeScript widened the literal union to `string` and the Fastify Zod response type rejected the route handler.
- **Root cause:** I trusted value inference inside a returned object instead of typing the public response discriminator.
- **Prevention rule:** For route response discriminators, assign the value to a `z.infer<typeof ResponseSchema>['field']` variable before returning it.
- **Files affected:** `apps/api/src/routes/odoo-integration.ts`.

### 2026-05-11 TOOLING: Prisma generate while API server locked Windows DLL

- **What went wrong:** I ran the root `pnpm typecheck` while the local API dev server was still running, so `prisma generate` failed to rename `query_engine-windows.dll.node`.
- **Root cause:** I forgot the Windows-specific Prisma client file lock before invoking a gate that runs `db:generate`.
- **Prevention rule:** Before any root gate that calls `pnpm db:generate`, stop BIDCRM API/worker Node processes that may have loaded `@bidstack/db`.
- **Files affected:** none; validation order only.

### 2026-05-11 TOOLING: Repeated web typecheck against stale shared dist

- **What went wrong:** I ran `pnpm --filter @bidstack/web typecheck` immediately after adding shared CRM exports, so the web package resolved stale `@bidstack/shared` dist output and reported missing `CrmConnector`/`OpenDataSignal` exports.
- **Root cause:** I remembered the stale-dist issue for full gates but still ran a targeted sibling typecheck before rebuilding shared.
- **Prevention rule:** After any `packages/shared/src/**` contract edit, the very next validation command must be `pnpm --filter @bidstack/shared build` or a root script that performs that build first.
- **Files affected:** none; validation order only.

### 2026-05-11 SHELL: Repeated Bash separator in PowerShell

- **What went wrong:** I ran a PowerShell command containing `&&`, which this shell mode rejects.
- **Root cause:** I bundled a format command and lint command out of habit instead of keeping PowerShell tool calls single-purpose.
- **Prevention rule:** In this workspace, run sequential commands as separate shell tool calls unless using explicit PowerShell control flow.
- **Files affected:** none.

### 2026-05-11 TOOLING: Repeated targeted Prettier unsupported-file mistake

- **What went wrong:** I included `.prettierignore` in another targeted `prettier --write` command, so Prettier formatted the source files but exited nonzero because no parser applies to the ignore file.
- **Root cause:** I used a manual file list after patching the ignore file instead of trusting `pnpm format:check` to validate it.
- **Prevention rule:** Never pass `.prettierignore`, `.gitignore`, Prisma schema, or other tool metadata to targeted Prettier commands unless `--ignore-unknown` is included. Use `pnpm format:check` as the gate for ignore-file changes.
- **Files affected:** none beyond successfully formatted source files.

### 2026-05-11 TOOLING: API tests consumed stale shared dist contracts

- **What went wrong:** The API route schema imported new shared Zod contracts, but `@bidstack/shared` resolves from `dist`, so `pnpm --filter @bidstack/api test` saw stale exports until the shared package was rebuilt.
- **Root cause:** The root `test` script ran workspace tests without first building shared package artifacts consumed by sibling packages.
- **Prevention rule:** Build `@bidstack/shared` before recursive test runs whenever API/MCP/frontend packages import shared contracts from package exports.
- **Files affected:** `package.json`.

### 2026-05-10 BUG: Audit-injected auth abstraction violated Rules of Hooks

- **What went wrong:** `apps/web/src/lib/auth.tsx` from the audit pipeline shipped three `useAuth/useUser/useSignOut` hooks that called Clerk's hooks **after** an early return for stub mode (`if (stub.user?.id === 'stub-user-1') return …; const clerk = useClerkAuth();`). React's hook order is per-component-instance, not per-app — so any component using these hooks could trigger "Rendered fewer hooks than expected" if it ever switched providers, and Clerk's hooks throw at runtime when there's no `<ClerkProvider>` ancestor (stub mode). ESLint's `react-hooks/rules-of-hooks` flagged it correctly.
- **Root cause:** The author assumed the app would only ever be in one mode per session, then used a runtime conditional to skip Clerk's hooks in stub mode. Both assumptions are right _operationally_ but wrong _for React_. Hooks are unconditional contracts.
- **Prevention rule:** When integrating an SDK whose hooks throw without their provider, never call those hooks conditionally. Instead: gate the _provider tree_ (mount one of two non-overlapping subtrees in `AuthProvider`) and have each subtree expose the same shared `Context`. Consumers always read the shared context — same hooks, same order, every render. The `ClerkAuthBridge` pattern.
- **Files affected:** `apps/web/src/lib/auth.tsx` (refactored).

### 2026-05-10 BUG: Audit used `require()` in a Vite ESM module

- **What went wrong:** `apps/web/src/App.tsx` had `const { SignIn } = require('@clerk/clerk-react')` to "lazy-load" Clerk's SignIn component. Vite's ESM build doesn't have CommonJS `require` at runtime; it would have failed in the browser. ESLint's `@typescript-eslint/no-require-imports` caught it.
- **Root cause:** Pattern carried over from a Node CJS context. In a Vite project, the lazy-load idiom is `React.lazy(() => import(...))`.
- **Prevention rule:** In Vite/ESM apps, `require()` is always wrong. The lint rule already enforces this — keep `@typescript-eslint/no-require-imports: error` on. For genuine lazy loading of named exports use `lazy(() => import(pkg).then(m => ({ default: m.Named })))`.
- **Files affected:** `apps/web/src/App.tsx`.

### 2026-05-10 PROCESS: Audit ran in parallel without a contract for which workspace owns lint

- **What went wrong:** A separate audit pipeline modified ~13 files between my commits, partially applying a 10-phase remediation. Some changes left the workspace in a half-broken state (typecheck fails, tests fail) and contradicted earlier work (Industry enum widening invalidated my fixture-guard test for industry; CI workflow rewritten without the bundle-size guard or 3-job split).
- **Root cause:** No coordination protocol between the audit pipeline and the active session — both wrote to the same tree without locking or branching.
- **Prevention rule:** When two automation pipelines could run in parallel, they MUST work on separate branches (or worktrees) and converge via PR. Never let a long-running audit write directly into the same branch a session is editing. If it happens anyway: pause, run `pnpm -r typecheck && pnpm -r lint && pnpm -r test`, and adopt-or-revert per file before continuing.
- **Files affected:** ~13 audit-modified files across `apps/`, `packages/`, `handoff/`.

### 2026-05-10 TESTING: Industry Zod enum was narrower than seed data

- **What went wrong:** Integration test `POST /opportunities` returned 500 because the `Industry` Zod enum was missing `insurance` (MAPFRE seed) and `transportation` (Logistec seed). The seed wrote those rows directly via Prisma, but the API rejected anything containing the same values on read serialization.
- **Root cause:** I built the Zod schema and the SQL seed in separate sittings and never reconciled them. Closed enums lie in two places and drift if the source of truth isn't enforced.
- **Prevention rule:** When extending a closed enum that constrains an external boundary (HTTP/GraphQL/MCP input), grep every fixture, seed, and migration for literal values of that enum and add a parse-the-fixtures unit test so the build fails on drift. Treat the enum and the seed as one change.
- **Files affected:** `packages/shared/src/schemas/opportunity.ts`, `packages/db/src/seed.ts`, `apps/api/src/routes/opportunities.integration.test.ts`.

### 2026-05-10 PROCESS: Master prompt assumed React 19 + Twenty fork as base

- **What went wrong:** Initial framing assumed Twenty CRM uses React 19 and has a stable `ApplicationRegistration` marketplace contract; both turned out to be wrong (React 18.2.39, marketplace WIP, registry path 404).
- **Root cause:** Trusted prose specs without verifying against upstream code.
- **Prevention rule:** Before committing to a fork/extension architecture, spawn an Explore agent to verify the actual upstream tech stack and extension-point contracts. Treat any prose claim about an upstream's internals as a hypothesis until grepped.
- **Files affected:** SPEC.md (architecture decision documented as standalone-first, Twenty overlay preserved for future).
