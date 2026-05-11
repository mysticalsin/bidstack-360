# BidStack 360° — Deep Audit, 2026-05-10

Six parallel specialist audits over the full monorepo (read-only). All findings
are cross-referenced where multiple audits flagged the same issue — those are
the highest-priority items because two independent reviewers found them.

| Audit                       | CRIT/BLOCK | HIGH/MAJOR | MED/MINOR | LOW |
| --------------------------- | ---------: | ---------: | --------: | --: |
| Security                    |          3 |          8 |        12 |   8 |
| Backend Architecture        |          3 |         10 |        15 |   8 |
| Frontend Architecture       |          2 |         14 |        14 |   — |
| Code Quality                |          0 |         10 |        18 |   — |
| Accessibility (WCAG 2.2 AA) |          8 |         12 |         9 |   — |
| DevOps / Prod Readiness     |          4 |         11 |         8 |   — |

**Headline verdict**: feature-complete for staging; **NOT ready for production**.
The blockers cluster in three areas: (1) deploy surface doesn't exist
(no Dockerfiles, no migration pipeline, no secret store), (2) auth fail-open
risks if `NODE_ENV` is unset, (3) light-mode contrast / focus-ring failures
across the entire shell. Each is a small fix; together they take ~1 sprint.

---

## Cross-validated findings (multiple audits agree)

These are the highest-confidence items.

### CV1 — Webhook dedup is in-process Map, not Redis

_Flagged by Security (H3), Backend (C1)_

`apps/api/src/routes/webhooks.ts:14-25` — comment claims Redis, code uses
`Map<string, number>`. Two API replicas accept duplicates; restart resets
state; replay window after the in-memory map is gone is unbounded.
**Fix**: `redis.set(key, '1', 'PX', 7d, 'NX')`. Redis client already exists
at `apps/api/src/redis.ts`.

### CV2 — Stub auth bypass risk if `NODE_ENV` unset

_Flagged by Security (C1), Backend (M8)_

`apps/api/src/plugins/auth.ts:103-127` and `apps/api/src/server.ts:54-64`.
`process.env.NODE_ENV ?? 'development'` defaults to development → stub auth
runs as the seed org with full write access. CORS likewise widens.
**Fix**: refuse to boot if `NODE_ENV` is unset; gate stub on an explicit
`AUTH_STUB=1` env, never on absence of a key.

### CV3 — Money type contradicts CLAUDE.md doctrine

_Flagged by Backend (H9)_

`packages/db/prisma/schema.prisma` stores money as `Decimal(14,2)`. CLAUDE.md
Part 2 (Conventions → Money) mandates **micros (integer × 1e6)**. Worse:
`apps/api/src/routes/reports.ts:53` reduces via `acc + Number(o.valueEur) * (...)`,
losing precision.
**Fix**: pick one. Either migrate the column to `BigInt` micros (preferred per
the canonical doctrine), or amend CLAUDE.md to allow `Decimal(14,2)` and stop
coercing through `Number()` in aggregations (use `Decimal.js` math).

### CV4 — DashboardPage is too long, ships demo data, uses inline styles

_Flagged by Code Quality (#1, #2, #3), Frontend (#6, #7, #19)_

`apps/web/src/pages/DashboardPage.tsx` is **540 lines** (cap is 400), has
**26 inline `style={{...}}` blobs**, and ships **`RECENT_ACTIVITY`,
`TEAM_LOAD`, `INDUSTRY_WIN_RATES`** as hardcoded mock data with no `import.meta.env.DEV`
gate or LESSONS.md entry. Means demo content goes to prod silently — Rule 12
violation.
**Fix**: extract `KpiTile`, `ActivityRow`, `WinRateBars`, `TeamLoadList`,
`OpportunityTableRow` into `apps/web/src/components/dashboard/`. Move fixtures to
`apps/web/src/lib/mock-data.ts` behind `import.meta.env.DEV`. Lift inline styles
to prototype CSS classes in `index.css` (`.proto-mark`, `.proto-owner-avatar`,
`.proto-pbar-row`).

### CV5 — Sidebar pulls 200-row opp list + full task list for two badges

_Flagged by Code Quality (#22), Frontend (#4)_

`apps/web/src/components/layout/Sidebar.tsx:31` calls
`useOpportunities({ limit: 200 })` and `useTasks()` purely to compute
`openBids` and `overdueTasks` integers. Refetches on every route mount.
**Fix**: dedicated `GET /api/badges` returning `{ openBids, overdueTasks }`
(or fold into the dashboard summary endpoint per CV6).

### CV6 — Dashboard fires 3 sequential RTTs that should be 1

_Flagged by Frontend (#3), Code Quality (#9)_

Dashboard mounts `usePipelineReport` + `useOpportunities` + `useTasks`. All
the derived KPIs (`totalPipeline`, `weighted`, `winRate`, `atRisk`, `avgHealth`,
`overdueCount`) plus the top-6 opportunity slice and overdue-task slice can be
one server payload.
**Fix**: `GET /api/reports/dashboard` returning `DashboardSummary`. Server-side
also wraps `/reports/pipeline`'s 4 sequential queries in `Promise.all`
(Code Quality #9, Backend H4).

### CV7 — Tertiary text fails 4.5:1 contrast across the entire shell

_Flagged by Accessibility (B1)_

`apps/web/src/index.css:26` — `--fg-tertiary: #8a93a6` on white = **3.09:1**.
WCAG 1.4.3 fails. Affects KPI labels, sidebar group titles, sidebar foot,
breadcrumbs, table headers, eyebrow type, search placeholder, kbd, user-chip
role, KPI subtitles, activity meta, contact role.
**Fix**: darken to `#6B7280` (4.6:1) or `#646b7d`. **One-line change, ~12 issues
resolved.**

### CV8 — No visible focus rings on `.btn*`, `.tb-search`, `.link-arrow`

_Flagged by Accessibility (B2)_

`apps/web/src/index.css:419-441, 329-352, 460-466`. The `:focus-visible` global
rule sets `box-shadow: var(--focus-ring)`, but each button declares its own
`box-shadow`, which overrides. WCAG 2.4.7, 2.4.11.
**Fix**: per-class `:focus-visible` rules that compose `var(--focus-ring),
<existing>` shadows.

### CV9 — No prod deploy artifacts; no migration pipeline; no secret store

_Flagged by DevOps (B1, B2, B3)_

No `Dockerfile` for any of the 4 apps. No `vercel.json` / `fly.toml` / Helm
chart / Terraform. CI runs `prisma migrate dev` (interactive, dev-only) — no
`migrate deploy` job. `.env.example` declares 12+ prod secrets but no managed
store is referenced.
**Fix**: multi-stage Dockerfiles per app + chosen PaaS manifest + gated
`migrate-deploy` GitHub Actions job + GitHub Environments / Doppler / AWS
Secrets Manager wiring.

### CV10 — No observability beyond stdout Pino

_Flagged by DevOps (M1, M2, M3), Backend (M9, M10)_

`.env.example` declares `SENTRY_DSN` and `OTEL_EXPORTER_OTLP_ENDPOINT` but
nothing reads them. No `/metrics`. `/health` mixes liveness + readiness.
Worker + MCP server have no health endpoint. BullMQ has no dashboard.
**Fix**: split `/livez` + `/readyz`. Add `@sentry/node`. Add OTEL
auto-instrumentation. Mount `@bull-board/fastify` behind admin auth or export
queue metrics to Prometheus.

---

## All findings by severity (raw, per-audit)

### CRITICAL / BLOCKER (must fix before next ship)

#### Security

- **C1** Stub auth bypass if `NODE_ENV` unset → see CV2
- **C2** Worker `dust-poll` writes events to _every_ org without scope check (`apps/worker/src/queues/dust-poll.ts:69-82`). Stub branch loops `prisma.org.findMany()` and inserts a `syncEvent` for every tenant. Multi-tenant data crossover.
- **C3** Webhook receiver falls back to seed org `'org_seed_mantu'` when no subscription matches (`apps/api/src/routes/webhooks.ts:86-89`). No env guard. In prod, an attacker who learns `DUST_WEBHOOK_SECRET` can inject `sync_events` into the seed org.

#### Backend Architecture

- **C1** Webhook dedup in-memory Map → see CV1
- **C2** `addContentTypeParser` registered inside route plugin after server start → if any other plugin parses JSON first, `rawBody` is missing and HMAC silently fails-open
- **C3** No timestamp / replay window on webhook (no `X-Dust-Timestamp`)

#### Frontend

- **B1** Theme flash — store doesn't read localStorage, only `dataset.theme` (`apps/web/src/stores/theme.ts:11-13`). On hard reload before DOMContentLoaded the saved dark theme is overwritten on first toggle.
- **B2** Clerk SDK collapses into eager `react` chunk (341 KB). Should be lazy-loaded behind `auth.tsx` runtime branch.

#### Accessibility

- **B1** Tertiary text fails 4.5:1 contrast → see CV7
- **B2** No focus rings on `.btn*`, `.tb-search`, `.link-arrow` → see CV8
- **B3** Primary button white-on-brand fails contrast in DARK mode (`#fff` on `#6e85ff` = 3.25:1)
- **B4** KPI tile + activity icon backgrounds hardcoded light hex; break in dark mode (`DashboardPage.tsx:14-21`)
- **B5** Active-opportunities table rows mouse-only (no Enter/Space, no Link wrap)
- **B6** Modal field labels are 10px and grey (3.09:1 contrast)
- **B7** Required fields have no perceivable required indicator
- **B8** `<select>` Stage/Industry labels concatenate option text in the a11y tree

#### DevOps

- **B1** No Dockerfiles / PaaS config → see CV9
- **B2** CI never runs `prisma migrate deploy` → see CV9
- **B3** No prod secret-management strategy → see CV9
- **B4** No backup / DR plan

### HIGH / MAJOR

#### Security

- **H1** Clerk JWT verification has no `issuer` / `audience` pinning
- **H2** Frontend uses `credentials: 'include'` but no Clerk Bearer attached
- **H3** No webhook timestamp / replay protection (in-memory dedup) → CV1
- **H4** Webhook persists arbitrary attacker-controlled JSON to `sync_events.payload`
- **H5** Rate limiter is global per-IP, no per-route caps on auth/webhook
- **H6** Helmet missing HSTS + frame-options + COOP/COEP overrides; CSP `unsafe-inline` for styles
- **H7** MCP rate-limit truncates token hash to 64 bits; anonymous fallback shares one global bucket
- **H8** MCP hourly rate-limit state is in-process Map → bypassed on horizontal scale + restart

#### Backend

- **H1** No FK indexes on `opportunities.owner_id`, `tasks.opp_id`, `tasks.assignee_id`, `documents.opp_id`
- **H2** No composite index for tasks list query `(orgId, status, dueDate)`
- **H3** `contacts.email` is `Citext` but not unique within org
- **H4** `/reports/pipeline` fetches every open opportunity into Node — OOM at scale
- **H5** Search query doesn't use the GIN trigram index (Prisma `contains: ..., mode: 'insensitive'` on individual columns)
- **H7** MCP tool errors lose JSON-RPC code mapping (everything → -32603)
- **H8** `apiKey.update(lastUsedAt)` write storm potential — throttle via Redis
- **H9** Decimal → `Number()` precision loss in reports → CV3
- **H10** CORS denied origins not logged

#### Frontend

- **#3** Dashboard fires 3 RTTs → CV6
- **#4** Sidebar refetches all opps on every page → CV5
- **#5** Default `staleTime: 30s` on every query — too aggressive for reports/contacts/tasks
- **#6** `DashboardPage` 540 LOC > 400 cap → CV4
- **#7** 26 inline `style={{...}}` in DashboardPage → CV4
- **#8** No memoization on derived dashboard arrays
- **#9** `React.StrictMode` in production
- **#10** No forms library; `CreateOpportunityDialog` uses raw FormData + manual Zod parse
- **#11** No optimistic update on `CreateOpportunityDialog`
- **#12** Sidebar/Topbar tightly coupled to global CSS class names — no compile-time signal on rename
- **#13** Zero unit tests for refactored Sidebar / Topbar / AppShell / Dashboard
- **#14** No per-route Suspense fallback
- **#15** No Error Boundary at the route level
- **#16** Tabs primitive used by only one consumer

#### Code Quality

- **#1** DashboardPage 540 lines → CV4
- **#2** Inline styles in DashboardPage → CV4
- **#3** Mock fixtures shipped in prod page → CV4
- **#4** `ownerInitials()` comment explains WHAT not WHY
- **#5** Webhook dedup in-process Map → CV1
- **#6** `console.error` in shipped frontend `ErrorBoundary`
- **#7** `/dust/status` mixes real metrics with hardcoded `lastSyncAt: null` / synthesized `nextSyncAt`
- **#8** PATCH no-op friendly fields use truthy check instead of `!== undefined`
- **#9** `/reports/pipeline` 4 sequential queries → CV6
- **#10** `IntelPayload` interface duplicated in `OpportunityDetailPage.tsx` instead of importing from `@bidstack/shared`

#### Accessibility

- **#9** Sidebar/iconbtn/btn touch targets under 44×44 (WCAG 2.5.8)
- **#10** Breadcrumb "current page" lacks `aria-current="page"`
- **#11** Charts (.pbar) have no `role="progressbar"` and no `aria-valuenow`
- **#12** AppShell wraps unauthenticated LoginPage — sidebar reads before redirect
- **#13** Notifications button has decorative red dot but no announcement
- **#14** Skip-link works but `<main>` has duplicate landmark labels
- **#15** Theme toggle button label flips wrong direction with `aria-pressed`
- **#16** `cs-pulse` infinite animation under reduced motion (note only)
- **#17** Search box wrapper has no `:focus-within` styling
- **#18** Topbar avatar text mid-button focus order awkward
- **#20** No live region / title update for SPA route changes

#### DevOps

- **M1** No observability beyond stdout Pino → CV10
- **M2** No `/readyz` separate from `/health`; no worker/MCP health endpoints → CV10
- **M3** No BullMQ queue observability → CV10
- **M4** No Postgres connection pooling configured
- **M5** No CDN / static-asset hosting plan
- **M6** CI lacks Node-version matrix
- **M7** `pnpm audit` is `continue-on-error: true` (vulnerabilities surface but never block)
- **M8** No zero-downtime deployment strategy considered
- **M9** Pre-commit hooks bypassable via `--no-verify`; no server-side secret-scan workflow
- **M10** No required-checks enforcement visible (untestable from filesystem)
- **M11** Docker compose lacks `bidstack_shadow` database init script

### MEDIUM / MINOR (samples — full lists in agent transcripts)

A long tail across all audits. Highlights:

- **Security M1**: no Pino redaction config — future code that logs `req.headers` will spill `Authorization` headers
- **Backend M1-M15**: in-memory rate-limit state, fire-and-forget BullMQ failures, no DLQ, mintNextCode race, hardcoded `lastSyncAt`, `dust/resync` doesn't actually enqueue a job
- **Frontend MINOR**: 5 array-index keys in dynamic lists, `RECENT_ACTIVITY` shipped to prod, theme toggle `aria-pressed` semantics, manualChunks doesn't isolate Clerk
- **Code Quality #11-#28**: IntelPayload duplication, `formatStage` empty-segment edge case, seed `console.log` calls, `ApiKey.update` swallows errors, dialog indentation drift, untyped JWT casts

---

## Recommended fix order

### Sprint A — safety floor (1–2 days)

- CV2: refuse to boot if `NODE_ENV` unset; introduce `AUTH_STUB` flag
- CV1: Redis-backed webhook dedup with `SET NX EX 604800`
- Backend C2 / C3: timestamp + 5-min replay window on webhook; move parser to top-level
- Security C2 / C3: gate seed-org fallback + worker stub fan-out behind `NODE_ENV === 'development'`
- Security H1: pin Clerk `issuer`; fail closed if `PUBLIC_BASE_URL` unset
- Security H2: web client attaches `Authorization: Bearer` from Clerk session

### Sprint B — accessibility (1 day)

- CV7: darken `--fg-tertiary` to `#6B7280` (one-line, ~12 issues)
- CV8: per-class `:focus-visible` shadow composition
- A11y B5: dashboard rows wrapped in `<Link>`
- A11y B4: `KPI_TONES` driven from `--tag-*` tokens
- A11y B6 / B7 / B8: modal field labels + `aria-required` + select outside label
- A11y #10 / #14 / #15 / #20: aria-current, drop duplicate main label, fix theme toggle, document.title per route

### Sprint C — frontend hygiene (2–3 days)

- CV4: decompose DashboardPage into `dashboard/` directory; extract fixtures
- CV5 + CV6: `GET /api/reports/dashboard` + `GET /api/badges` (or fold)
- Frontend B1: theme store reads localStorage
- Frontend B2: lazy-load Clerk in `auth.tsx`
- Frontend #5 / #8: per-hook `staleTime` + `useMemo` on derived dashboard data
- Frontend #9: gate StrictMode behind `import.meta.env.DEV`

### Sprint D — backend perf + correctness (2 days)

- Backend H1: add four missing FK indexes
- Backend H2: composite index `(orgId, status, dueDate)` on tasks
- Backend H4: SQL aggregation in reports; `Promise.all` the four queries
- Backend H5: search via `$queryRaw` against the GIN-indexed concatenation
- Backend H7: differentiate JSON-RPC error codes
- Backend H8 / M1 / M2: Redis-backed rate-limit + `lastUsedAt` throttle + circuit-breaker state
- CQ #8: PATCH `!== undefined` consistency
- CQ #10: import `IntelPayload` from `@bidstack/shared`

### Sprint E — prod readiness (3–5 days)

- DevOps B1-B4: Dockerfiles, migrate-deploy job, secret store, backup/DR runbook
- DevOps M1-M3: Sentry + OTEL + `/livez` + `/readyz` + bull-board
- DevOps M9: server-side Gitleaks workflow
- Backend M3 / M4: BullMQ concurrency tuning + dead-letter handling
- CV3: pick money policy and either migrate or amend doctrine

---

## What's already excellent

Worth preserving:

- `useStageMutation` — exemplary optimistic update with snapshot/rollback (Code Quality)
- `verifyDustSignature` — constant-time compare, sha256-pinned, with security WHY in test (Code Quality)
- `seed-data.test.ts` — drift-guard tests with explicit WHY + how-to-fix assertion messages (Code Quality)
- `apps/api/src/plugins/error-handler.ts` — clean Prisma → HTTP code mapping (Code Quality)
- `apps/web/src/pages/PipelinePage.tsx` keyboard alternative to drag-and-drop with WCAG citation in comment (Code Quality)
- `apps/web/src/lib/auth.tsx` — Rules-of-Hooks-safe Clerk/stub split documented at top (Code Quality)
- `pnpm audit --prod` is clean (Security L8)
- Multi-tenancy: every Prisma query against tenant tables includes `where: { orgId }` modulo C2/C3 caveats (Security)
- Dark-mode token coverage is mirror-complete for light (Accessibility)
- Skip-link, landmarks, sidebar `aria-current` automatic, decorative SVG `aria-hidden` defaults — all present (Accessibility)
- `useReducedMotion` hook used in `LoadingSkeleton` (Accessibility)
- Local dev quality: CI structure, secret scan, hooks, health check (DevOps)
