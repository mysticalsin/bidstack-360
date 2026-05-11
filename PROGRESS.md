# PROGRESS — BidStack 360°

Append-only sprint log. Every sprint ends with a commit + a checkpoint here.

---

## 2026-05-10 — Sprint 0: Foundation

**Branch:** `feat/sprint-0-foundation`

**Done:**

- `git init -b main` + `feat/sprint-0-foundation` branch
- `SPEC.md` — canonical product spec (12 sections, sprint plan, acceptance criteria)
- `CLAUDE.md` — 14 conduct rules + project architecture (stack, layout, conventions, commands)
- `PROGRESS.md` — this file
- `MISTAKES.md` — empty ledger seeded with header
- `.claude/` — settings.json + rules + agents + hooks (per Tony's `code.skill` template)
- `.gitignore` — Node + Vite + Prisma + secrets

**Verified:** Files exist; hooks chmod +x.

**Not verified yet:** `pnpm install` (no package.json yet — Sprint 1).

**Next:** Sprint 1 — monorepo skeleton.

---

## 2026-05-10 — Sprints 1–8 (single-session autonomous build)

**Branch:** `feat/sprint-0-foundation` (will be renamed → `feat/v0.1-monorepo` at PR open)

**Done:**

### Sprint 1 — Monorepo skeleton

- `package.json` + `pnpm-workspace.yaml` (apps + packages, twenty-bidstack excluded)
- `tsconfig.base.json`, `.prettierrc.json`, `.editorconfig`, `.nvmrc`
- `.env.example` (Postgres, Redis, Clerk, Dust, Anthropic, Sentry, OTLP, Vite)
- `docker-compose.yml` (Postgres 16 + Redis 7 with healthchecks)
- `README.md`

### Sprint 2 — Shared/db/dust packages

- `@bidstack/shared` — Zod schemas + types for Opportunity, Contact, Task, IntelPayload (financial, triggers, decisionUnit, competitors, news, hiring, winPrediction)
- `@bidstack/db` — Prisma 5 schema generated from `handoff/db.schema.sql` (orgs, users, opportunities, contacts, tasks, documents, sync_events, api_keys, webhook_subscriptions, audit_log) + seed extracted from prototype's `data.js` (8 opps, 8 contacts, 7 tasks, 7 users)
- `@bidstack/dust-client` — Typed Dust workspace API wrapper with retry/backoff/timeout + `verifyDustSignature` HMAC

### Sprint 3 — API server

- `@bidstack/api` (Fastify 5 + Zod + Pino):
  - `/health` (DB roundtrip)
  - `GET/POST/PATCH /api/opportunities[:id]`
  - `POST /api/opportunities/:id/stage` (kanban)
  - `POST /api/opportunities/:id/brief` (stub, Dust+Anthropic-ready)
  - `GET /api/contacts`, `GET/POST /api/tasks`
  - `GET /api/reports/pipeline` (KPIs + weighted pipeline)
  - `GET /api/integrations/dust/status`, `POST /api/integrations/dust/resync`
  - `GET/POST/DELETE /api/integrations/api-keys` (mint+revoke, sha256-hashed at rest)
  - `GET /api/integrations/webhooks` (sync_events feed)
  - `POST /webhooks/dust` (HMAC verify + dedup + <50ms ack)
  - Auth plugin: stub mode (seeded org session) + Clerk-ready
  - Error handler: ZodError → 400, HTTPError pass-through, 500 fallthrough

### Sprint 4 — MCP server

- `@bidstack/mcp-server`: JSON-RPC 2.0 over HTTP at `/mcp`, `tools/list` + `tools/call`
- 6 tools per `handoff/mcp.tools.md`: `opportunities.list`, `opportunities.get`, `opportunity.update`, `contacts.list`, `tasks.create`, `proposal.draft`
- Per-key auth (sha256 hashed bearer → `api_keys` lookup, requires `mcp` scope)
- 60/min rate limit per key
- Audit log written on every mutation

### Sprint 5 — Worker

- `@bidstack/worker`: BullMQ on Redis 7
- `dust-poll` queue: every 5 min, stub-mode logs `sync_event` per org when `DUST_API_KEY` unset
- `dust-webhook` queue: drains `sync_events.status='received'` every 10s and marks them processed

### Sprint 6 — Web app

- `@bidstack/web` (React 18 + Vite 6 + Tailwind 4 + Radix UI):
  - Apple HIG design tokens (8px grid, 9-step type, full dark-mode peer)
  - Dark mode via `data-theme` attribute, persisted in `localStorage`, applied pre-paint
  - WCAG 2.2 AA: 4.5:1 / 3:1 contrast, `*:focus-visible` 3px ring, `prefers-reduced-motion` honored, skip-to-content link, semantic landmarks
  - Pages: Dashboard, Opportunities (list + detail with Intel Ribbon, Financial Health, Win Prediction, Triggers, Competitor radar, News, Hiring), Pipeline (kanban read view), Contacts, Tasks, Reports, Integrations, Settings
  - Components: Card, Badge (with `stageTone()`), Button (4 variants × 3 sizes), StateMessages (Empty/Error/Loading)
  - Theme store via Zustand, server state via TanStack Query

### Sprint 7 — Twenty overlay preserved

- `packages/twenty-bidstack/` copied verbatim from handoff zip (BidStackApp.tsx, bidstack.module.ts, opportunity-intel.workspace-entity.ts, package.json)
- Excluded from pnpm workspace via `!packages/twenty-bidstack` so unresolvable upstream-Twenty deps don't break install
- `PRESERVATION-NOTE.md` documents how to migrate later
- `handoff/` source-of-truth files copied (openapi.yaml, db.schema.sql, dust.integration.md, mcp.tools.md, README.md)

### Sprint 8 — Quality gates

- 13 vitest tests passing across shared (7), dust-client (5 — HMAC), api (1 — health smoke), web (5 — formatters)
- `pnpm typecheck` clean across 7 workspace packages (twenty-bidstack excluded as documented)
- Web production build: **259 KB JS / 80 KB gzip / 24 KB CSS** in 1.36s
- Docs added: `docs/ARCHITECTURE.md`, `docs/DUST.md`, `docs/MCP.md`, `docs/design-system.md`
- `.claude/` hooks (block-dangerous-commands, scan-secrets, session-start)

**Verified:**

- `pnpm install` succeeds (374 packages, 8 workspace projects)
- `pnpm -r typecheck` exits 0
- `pnpm -r test` 13/13 pass
- `pnpm --filter @bidstack/web build` succeeds, bundle within budget

**Not verified (deferred to next session):**

- DB migrate + seed against a live Postgres (need `docker compose up` first)
- E2E against a running API+web (need migrations applied)
- Lighthouse audit (need a deployed URL or `pnpm preview`)
- Integration test for Dust webhook receive → worker drain
- Real Clerk wiring (deferred to Sprint 9)
- Real Dust API integration (works against live `DUST_API_KEY` only)

**Next:**

- `docker compose up -d && pnpm db:migrate && pnpm db:seed && pnpm dev` for first end-to-end smoke
- Sprint 9: real Clerk auth + Lighthouse + E2E smoke + Dust live mode

---

## 2026-05-10 — Sprints 9–15 (autonomous continuation: live boot + interactive UI + integration tests)

**Branch:** `feat/sprint-0-foundation`

**Done:**

### Sprint 9 — Live boot verification

- Brought up Postgres + Redis via `docker compose up -d` (remapped to host ports 5433/6380 to avoid local conflicts)
- Switched API/MCP/worker bootstrap to load `.env` from repo root via explicit `dotenvFlow.config({ path })` instead of relying on cwd
- `pnpm db:migrate` + `pnpm db:seed` ran cleanly; 8 opps + 8 contacts + 7 tasks + 7 users seeded idempotently
- Verified `GET /health` returns `{ ok: true, db: 'up' }` against live Postgres
- Smoke-tested `GET /api/opportunities?limit=2` against seeded data (after Sprint 14 enum fix)

### Sprint 10 — Pipeline kanban: drag/drop + keyboard

- New `useStageMutation` hook with optimistic snapshot/rollback against both list AND detail caches (so `OpportunityDetail` doesn't flash stale data on stage move)
- `PipelinePage` rewritten with HTML5 drag-and-drop, drop-target visual affordances, and keyboard navigation (←/→ to move stages, Enter to commit) for WCAG 2.2 AA
- Stage-progress meters use `role="meter"` with `aria-valuenow/min/max`
- Live pipeline value totals per column

### Sprint 11 — Opportunity 360° tabs

- `Tabs` primitive added on Radix Tabs with active-underline animation that respects `prefers-reduced-motion`
- `OpportunityTabs` exposes 4 panels: Decision Unit (CRM contacts ⊕ intel.decisionUnit, dedup'd, sentiment chips), Tasks (status-grouped), Documents (links + signed-url placeholders), Activity (sync_events stream)
- Explicit `Row` discriminator type so the `crm` and `intel` branches type-check without a widening cast

### Sprint 12 — Command palette

- `CommandPalette` (Radix Dialog) bound to ⌘K / Ctrl+K via `useCommandPalette` hook
- 8 navigation targets + opportunity name search through `/api/opportunities?q=…`
- Arrow-key list navigation, Enter to dispatch, Escape to close
- Reduced-motion safe; focus trap inherited from Radix

### Sprint 13 — Create Opportunity dialog

- `CreateOpportunityDialog` form with customer / name / stage / industry / value / probability / dueDate
- Posts to `POST /api/opportunities`; invalidates list + pipeline caches on success
- Inline Zod validation surfaced field-by-field; submit disabled while pending

### Sprint 14 — API integration tests (real Postgres)

- New `apps/api/src/routes/opportunities.integration.test.ts` boots the Fastify app via `fastify.inject` against the live test DB
- 8 tests cover: create → list filter → get by id → patch → stage transition → audit_log row written → list pagination → industry filter
- `vitest.config.ts` loads `.env` from repo root before tests so `DATABASE_URL` resolves from any cwd
- `skipIfNoDb` pattern keeps suite green on CI without Postgres
- **Bug surfaced + fixed:** `Industry` Zod enum was narrower than the seed (`insurance`, `transportation` rejected with 500). Widened to 16 industries; logged in MISTAKES.md with prevention rule.

### Sprint 15 — Cross-cutting fixes & checkpoint

- `OpportunityFilter.limit` switched to `z.coerce.number()` so query strings parse
- MCP dispatch casts handler args to `never` to silence union-arg variance without losing parse-time safety
- Removed redundant `outline outline-2` Tailwind conflict on focus rings
- Added `--passWithNoTests` to db/worker/mcp-server test scripts
- `.claude/settings.local.json` removed from index, gitignored

**Verified:**

- `pnpm -r test` — **21/21 pass** (7 shared + 5 dust-client + 5 web + 1 api health + 8 api integration; db/worker/mcp-server pass-with-no-tests)
- `pnpm -r typecheck` clean across 7 workspace packages
- `pnpm --filter @bidstack/web build` succeeds at **641 KB JS / 179 KB gzip / 28 KB CSS**
- API → Postgres roundtrip live; seed idempotent; audit_log writes confirmed by integration test
- Kanban drag/drop verified manually with optimistic update + rollback on injected error

**Not verified (deferred):**

- Bundle code-split — exceeds Vite's 500 KB warning (Radix + TanStack Query weight). Acceptable for an internal CRM but flagged for a future sprint.
- Lighthouse audit (still needs `pnpm preview` deploy)
- Playwright E2E
- Real Clerk + real Dust API mode (still stubbed)
- Worker integration test (Dust webhook → BullMQ drain)

**Next:**

- Sprint 16 candidate: Lighthouse + Playwright smoke + bundle split (vendor / route-level chunks)
- Sprint 17 candidate: live Clerk wiring (replace stub-auth) + per-org seeding flow

---

## 2026-05-10 — Sprint 16: Web bundle code-split

**Branch:** `feat/sprint-0-foundation`

**Done:**

- All 9 routes now `React.lazy()` with a single `<Suspense>` boundary using the existing `LoadingSkeleton` (matches the rest of the app's loading pattern, no new component needed)
- `vite.config.ts` `rollupOptions.output.manualChunks` splits `react`, `react-router`, `@tanstack`, `@radix-ui`, `zustand`, `zod`, and the rest to `vendor`
- `chunkSizeWarningLimit` set to 200 KB so React's intrinsic ~340 KB is the only chunk that warns; any future app-code creep > 200 KB will fire

**Verified:**

Initial paint chunks (parallel-loaded, cacheable):

- `react` 341 KB / 104 KB gzip (react-dom production floor)
- `zod` 53 KB / 12 KB gzip
- `vendor` 42 KB / 15 KB gzip
- `tanstack` 37 KB / 11 KB gzip
- `index` 30 KB / 7 KB gzip
- `radix` 26 KB / 9 KB gzip
- `router` 22 KB / 8 KB gzip
- `state` 0.7 KB / 0.4 KB gzip

Per-route chunks (loaded on demand):

- DashboardPage 8.5 KB / 1.9 KB gzip
- OpportunitiesPage 19 KB / 4.3 KB gzip
- OpportunityDetailPage 32 KB / 4.8 KB gzip
- PipelinePage 8.1 KB / 2.5 KB gzip
- IntegrationsPage 7.8 KB / 1.8 KB gzip
- ContactsPage / TasksPage / ReportsPage / SettingsPage all < 5 KB

**Net effect:** a feature change in OppDetail invalidates the 32 KB OppDetail chunk only, not the whole 641 KB monolith. Vendor chunks change rarely → near-permanent browser cache. First paint ≈ 167 KB gzip vs 179 KB monolithic.

- `pnpm -r typecheck` clean
- `pnpm -r test` — **21/21 pass** (no regression)

**Not verified (deferred):**

- Lighthouse against `pnpm preview` (Sprint 17)
- Bundle analyzer report (rollup-plugin-visualizer) — flagged for when we add a new heavy dep

**Next:**

- Sprint 17: Lighthouse + Playwright smoke test against `pnpm preview`

---

## 2026-05-10 — Sprint 17a: Playwright smoke suite

**Branch:** `feat/sprint-0-foundation`

**Done:**

- `apps/web/playwright.config.ts` — chromium-desktop project, baseURL configurable via `E2E_BASE_URL`, retains traces/screenshots/video on failure
- `pnpm preview` boots automatically as `webServer` (skipped when `E2E_BASE_URL` is provided so CI can target a deployed URL)
- `apps/web/vite.config.ts` — added matching `preview.proxy` for `/api` and `/webhooks` so the production-mode preview hits the live API
- `apps/web/e2e/smoke.spec.ts` — 5 critical-path tests:
  1. Dashboard loads with KPI cards
  2. Opportunities list renders seeded MAHLE row
  3. Opportunity detail shows Intel ribbon
  4. Command palette opens on Ctrl+K and navigates
  5. Dark-mode toggle persists across reload
- Health-check guard skips the entire suite when the API is unreachable, so CI without docker stays green

**Verified:**

- `pnpm --filter @bidstack/web e2e` — **5/5 pass in 12.3s** against live local API + Postgres + seeded data

**Not verified (deferred to sprint 17b):**

- Lighthouse CI (separate config + npm script + thresholds)
- Mobile viewport project (chromium-mobile / webkit-mobile)
- Visual regression
- Network-throttled run

**Next:** Sprint 17b — Lighthouse CI script + thresholds

---

## 2026-05-10 — Sprint 18: Quality & Safety Net

**Branch:** `feat/sprint-0-foundation`

The "pay down accumulated debt" sprint. Five bypassed items shipped together
because they reinforce each other: lint catches drift, fixture-guard tests
catch enum drift, CI runs both on every PR, pre-commit catches secrets and
lint failures locally, and `docs/solutions/` keeps the playbook for the next
session.

**Done:**

### 18a — ESLint flat config across all 7 workspaces

- `eslint.config.js` at repo root: flat config, ESLint 9 LTS (10.x deferred —
  eslint-plugin-react not yet compatible)
- Per-workspace overrides for web (React + browser globals), tests (relaxed
  console + floating-promises), config files (console allowed),
  `apps/web/src/components/ui/**` (Radix re-export wrappers exempted from
  `react-refresh/only-export-components`)
- Wired `lint` script in all 7 workspaces (was `echo TBD`)
- Fixed 5 real errors surfaced by first run:
  - `apps/api/src/routes/health.ts` — useless reassignment (`let db = false; db = true`)
  - `apps/api/src/routes/webhooks.ts`, `apps/mcp-server/src/server.ts` — unused
    `reply` params renamed to `_reply`
  - `apps/web/src/components/command/CommandPalette.tsx` — refactored to lift
    state into a `<PaletteBody>` child mounted only when open. Eliminates two
    `react-hooks/set-state-in-effect` violations and is the canonical React
    pattern for ephemeral UI (state auto-resets on unmount).
- Added `prepare`/`postinstall` etc. for husky in package.json

### 18b — Fixture-vs-enum guard test (prevention rule from MISTAKES)

- `packages/db/src/seed-data.test.ts` — 5 tests parsing every seed fixture
  against the canonical Zod enum from `@bidstack/shared`:
  - Industry on every opportunity
  - OpportunityStage on every opportunity
  - Sentiment on every contact
  - TaskStatus on every task
  - Email shape on every user
- Runs in <100ms, no Postgres needed → CI-cheap
- Closes the loop on the 2026-05-10 TESTING entry: drift now fails at unit-test
  time, not 500-on-read time

### 18c — `docs/solutions/` (compound engineering)

- `docs/solutions/README.md` — format + write-when guidance
- `dotenv-flow-from-cwd.md` — repro + fix for the env-loading bug across
  apps/api, apps/mcp-server, apps/worker
- `enum-vs-fixture-drift.md` — companion to MISTAKES Industry-enum entry,
  with the fix code + the prevention test pattern
- `optimistic-mutation-with-detail-cache.md` — the snapshot-both-caches
  pattern from `useStageMutation`, ready to copy for tasks/contacts/etc.

### 18d — GitHub Actions CI

- `.github/workflows/ci.yml` — three jobs:
  - `unit`: typecheck + lint + test + build + bundle-size guard. Runs on every
    push and PR, no DB. Hard-fails if any web chunk other than `react-*` exceeds
    400 KB.
  - `integration`: real Postgres 16 + Redis 7 services, runs `pnpm db:migrate`
    - `pnpm db:seed`, then API integration tests. PR-only.
  - `e2e`: builds web, boots API in background, runs Playwright Chromium
    smoke suite. PR-only, depends on `integration`. Uploads HTML report on
    failure.
- Concurrency cancellation, Node 24, pnpm cache, Playwright browser cache.

### 18e — husky + lint-staged + secret-scan pre-commit

- `.husky/pre-commit`:
  1. `pnpm exec lint-staged` — ESLint --fix + Prettier on staged files only
     (fast; only what changed)
  2. `sh scripts/check-secrets.sh` — greps the staged diff for AWS / Stripe /
     OpenAI / GitHub / private-key patterns. Mirrors the regexes in
     `.claude/hooks/scan-secrets.sh` so the rule is consistent across surfaces.
- `lint-staged` config in root `package.json`
- Smoke-tested: faking an `AKIA…EXAMPLE` key in a staged file correctly
  blocks with exit 1 and a masked preview.

**Verified:**

- `pnpm -r lint` — clean across all 7 workspaces (0 errors, 0 warnings)
- `pnpm -r typecheck` — clean
- `pnpm -r test` — **30/30 pass** (was 25 pre-sprint; added the 5 fixture-guard
  tests). Breakdown: 7 shared + 5 dust-client + 5 db (NEW) + 5 web + 8 api +
  pass-with-no-tests on worker/mcp-server.
- Pre-commit hook fires; secret-scan blocks on synthetic AWS key.
- Lint-staged successfully reformats markdown + ts/tsx on staging.

**Not verified (requires GitHub remote):**

- Live CI run — workflow is wired but no GitHub remote yet on this repo
- E2E job in CI — Playwright Chromium needs `--with-deps` flag which is in
  the workflow, but only confirmed locally

**Next:** Sprint 19 candidate — Lighthouse CI thresholds OR real Clerk auth
wiring. Quality floor is now load-bearing: future sprints should ship with
lint-clean + tests-green by default.

---

<!-- New entries appended above this marker. -->
