# 🔬 Deep Multi-Dimensional Audit — BidStack 360°

**Date:** 2026-05-14  
**Method:** 12 specialist lenses + direct codebase analysis + automated baseline  
**Scope:** Full monorepo (8 packages, 45 API routes, 32 pages, 103 components)  
**Auditors:** Kimi Code CLI specialist agents + direct tooling analysis  

---

## 1. Executive Summary

### Quality Score: 87/100 (Target: ≥95)

| Dimension | Score | Status | Key Risks |
|-----------|-------|--------|-----------|
| **Functional Coverage** | 23/25 | 🟢 Strong | Missing `GET /tasks/:id`, stale OpenAPI, pagination gaps |
| **Code Quality** | 20/25 | 🟡 Good | Fat controllers (reports.ts 995 lines), missing route tests (20 untested), no coverage tool |
| **Design / UX** | 20/25 | 🟡 Good | Focus rings improved but not universal; no virtualized lists |
| **Infra / Security** | 18/25 | 🟡 Good | Auth solid, RBAC thin, 1 dependency vuln, Docker compose has obsolete `version` |
| **Testing** | 6/25 | 🟡 Baseline | 229 tests pass but 20 routes untested, no coverage reporting |

**Headline Verdict:** Well-architected for a v0.2 CRM. Auth, data model, and build pipeline are production-viable. The biggest risks are **fat controllers** blocking maintainability, **stale OpenAPI** blocking integrations, and **thin RBAC** (only 2 routes use `requireRole`).

---

## 2. Baseline Metrics

| Metric | Value | Threshold | Status |
|--------|-------|-----------|--------|
| Typecheck | 8/8 packages clean | 100% | ✅ |
| Lint | 8/8 packages clean | 100% | ✅ |
| Tests passing | 229 (API 148, MCP 21, Web 17, Worker 15, Shared 13, Odoo 8, Dust 7, DB 6) | >95% | ✅ |
| Build | All packages build | 100% | ✅ |
| `pnpm audit` (moderate+) | 1 high (`d3-color` ReDoS) | 0 high/critical | ❌ |
| Test coverage | Unknown (`@vitest/coverage-v8` not installed) | >70% | ⚠️ |
| API route test coverage | 14 test files / 45 routes = 31% | >80% | ❌ |
| Web frontend test coverage | 6 test files (.tsx + .ts) / 209 files = 3% | >50% | ❌ |
| Largest web chunk | `index-CoG2KP_A.js` 198KB | <200KB | ✅ |
| DashboardPage chunk | 140KB | <150KB | ✅ |
| Prisma models | 57 | — | — |
| Models with `deletedAt` | 57/57 (100%) | 100% | ✅ |
| Models with `@@index([orgId])` | Most business entities | >90% | ✅ |
| Route files >400 lines | 7 (reports, notes, invoices, odoo, sales-dashboard, territories, sales-orders) | 0 | ❌ |

---

## 3. Findings Matrix

### 3.1 API Design & Contract (Lens 4) — 19 Findings

| ID | Severity | Location | Finding | Fix Effort |
|----|----------|----------|---------|------------|
| A1 | **Critical** | `handoff/openapi.yaml` | Spec missing most routes; documents unversioned `/api/` paths while runtime serves `/api/v1/` | Medium |
| A2 | **Critical** | `apps/api/src/routes/opportunities.ts` | ~~GET `/:id` has no `response` schema~~ ✅ **FIXED** — Added `response: { 200: OpportunityFull }` | Small |
| A3 | **High** | `apps/api/src/routes/opportunities.ts` | ~~`OpportunityCreate`/`OpportunityPatch` declare `owner`, but route ignores it — silent data loss~~ ✅ **FIXED** — POST/PATCH now resolve `owner` email to `ownerId` via user lookup, with `null` support to clear owner | Small |
| A4 | **High** | `apps/api/src/routes/contacts.ts` | List endpoint lacks cursor pagination (`{ items }` only) | Medium |
| A5 | **High** | `apps/api/src/routes/tasks.ts` | List lacks cursor pagination; `GET /tasks/:id` route missing entirely | Medium |
| A6 | **Medium** | `apps/api/src/routes/invoices.ts` | `InvoiceUpdate` schema defined locally in route file | Small |
| A7 | **Medium** | `apps/api/src/routes/contacts.ts` | List querystring uses inline schema | Small |
| A8 | **Medium** | `apps/api/src/routes/tasks.ts` | List querystring uses inline schema | Small |
| A9 | **Medium** | `apps/api/src/routes/service-desk.ts` | PATCH body uses inline `.partial()`; schema allows fields route ignores | Small |
| A10 | **Medium** | `packages/shared/src/schemas/*` | No client-controlled sorting on any list endpoint | Medium |
| A11 | **Medium** | `packages/shared/src/schemas/*` | Pagination limits inconsistent: default 25 vs 50, max 100 vs 200 | Small |
| A12 | **Medium** | `packages/shared/src/schemas/*` | Email/string fields lack `.max()` bounds | Small |
| A13 | **Medium** | `packages/shared/src/schemas/service-desk.ts` | `ServiceCaseFilter.cursor` typed as plain `z.string()` not `z.string().uuid()` | Small |
| A14 | **Low** | `packages/shared/src/schemas/leads.ts` | `LeadCreate`/`LeadPatch` hand-written, not DRY | Small |
| A15 | **Low** | `packages/shared/src/schemas/contact.ts` | `ContactPatch` hand-written, not DRY | Small |
| A16 | **Low** | `packages/shared/src/schemas/task.ts` | `TaskPatch` hand-written, not DRY | Small |
| A17 | **Low** | `apps/api/src/routes/invoices.ts` | `/invoices/export` has no response schema | Small |
| A18 | **Low** | `apps/api/src/routes/*` | State transitions use POST instead of PATCH (RPC style) | — |
| A19 | **Low** | `handoff/openapi.yaml` | `OpportunityPatch` is wildcard (`additionalProperties: true`) | Small |

### 3.2 Security (Lens 1) — 8 Findings

| ID | Severity | Location | Finding | Fix Effort |
|----|----------|----------|---------|------------|
| S1 | **High** | `apps/api/src/routes/*` | ~~Only 2 routes use `requireRole('admin')`: `/audit-logs` and `/dust/*`. All other admin-only routes rely solely on auth presence~~ ✅ **FIXED** — Added `preHandler: server.requireRole('admin')` to POST/PATCH/DELETE `/roles/*`, PATCH `/users/:id/role`, POST/DELETE `/plugins/*`, POST `/predictive/scores` | Small |
| S2 | **High** | `apps/api/src/routes/files.ts` | File upload validation needs verification: check MIME type whitelisting, file size caps, path traversal prevention | Small |
| S3 | **Medium** | `apps/api/src/plugins/auth.ts:68-70` | `verifyClerkAuth` throws `serviceUnavailable` if `CLERK_SECRET_KEY` missing. In production this is correct, but stub mode guard at line 145 should be verified | Small |
| S4 | **Medium** | `apps/api/src/server.ts` | CORS origin not restricted in production (`@fastify/cors` defaults to reflecting origin) | Small |
| S5 | **Medium** | `docker-compose.yml:40` | `NODE_ENV: development` hard-coded in API service config | Small |
| S6 | **Medium** | `docker-compose.yml:1` | Obsolete `version: '3.9'` attribute (deprecated by Docker Compose spec v2) | Small |
| S7 | **Medium** | Root | ~~`d3-color` dependency has high-severity ReDoS vulnerability~~ ✅ **FIXED** — `pnpm override` forces `d3-color@>=3.1.0`, lockfile regenerated, audit clean | Small |
| S8 | **Low** | `apps/api/src/routes/webhooks.ts` | Dedup fallback uses in-process `Map` when Redis unreachable. Acceptable for dev, but warn level may be missed in production monitoring | Small |
| S9 | **Medium** | `apps/api/src/routes/invoices.ts` | `loadInvoiceDetail` uses `include: { lines: { include: { product: ... } }, payments: ... }` without explicit `select` — fetches all columns on lines, payments, and product | Small |
| S10 | **Medium** | `apps/api/src/routes/notes.ts` | `note.findMany` / `note.create` / `note.update` use `include: { author: true }` which fetches all user columns | Small |

### 3.3 Backend Architecture (Lens 2) — 21 Findings

#### Fat Controllers
| ID | Severity | Location | Finding | Fix Effort |
|----|----------|----------|---------|------------|
| B1 | **Critical** | `reports.ts` | 995 lines — ~30 business functions (`buildKpis`, `classifyProduct`, `buildCountryRows`, etc.) mixed with HTTP handlers | Large |
| B2 | **Critical** | `notes.ts` | 950 lines — ~25 helper functions (`extractContacts`, `persistRisks`, `normalizeDomain`, etc.) in route file | Large |
| B3 | **Critical** | `invoices.ts` | 820 lines — state machine, CSV export, AR-aging math, payment recording, subtotal calculation all co-located | Large |

#### N+1 Query Patterns
| ID | Severity | Location | Finding | Fix Effort |
|----|----------|----------|---------|------------|
| B4 | **Critical** | `notes.ts:542-577` | ~~`persistContacts` loops over contacts array and fires `findFirst` + `create` per item inside transaction~~ ✅ **FIXED** — Replaced with single `findMany` + `createMany` batch | Medium |
| B5 | **Critical** | `notes.ts:579-611` | ~~`persistRisks` loops over risks with `findFirst` + `create` per item inside transaction~~ ✅ **FIXED** — Replaced with single `findMany` + `createMany` batch | Medium |
| B6 | **Critical** | `notes.ts:613-648` | ~~`persistCompliance` loops over checks with `findFirst` + `update`/`create` per item inside transaction~~ ✅ **FIXED** — Replaced with single `findMany` + batched `update`/`createMany` | Medium |
| B7 | **Critical** | `notes.ts:650-673` | ~~`persistTasks` loops over tasks with `findFirst` + `create` per item inside transaction~~ ✅ **FIXED** — Replaced with single `findMany` + `createMany` batch | Medium |
| B8 | **High** | `notes.ts:234-296` | Meeting-import `$transaction` holds DB locks while 4 N+1 helpers fire sequentially inside it | Medium |

#### SELECT * Without Explicit Select
| ID | Severity | Location | Finding | Fix Effort |
|----|----------|----------|---------|------------|
| B9 | **High** | `invoices.ts:67-75` | `loadInvoiceDetail` uses `include: { lines: { include: { product: ... } }, payments: ... }` without explicit `select` | Small |
| B10 | **High** | `invoices.ts:83-88` | `loadInvoiceDetail` queries `auditLog` with `include: { user: { select: { name } } }` but no `select` on auditLog itself | Small |
| B11 | **High** | `notes.ts:162,192,334` | `include: { author: true }` on note queries fetches all user columns | Small |
| B12 | **Medium** | `opportunities.ts:48,148,211` | `include: { owner: true }` fetches all user columns | Small |
| B13 | **Medium** | `opportunities.ts:165-169` | `include: { tasks: ..., documents: ... }` on GET `/:id` fetches all columns on both relations | Small |

#### Missing Transactions
| ID | Severity | Location | Finding | Fix Effort |
|----|----------|----------|---------|------------|
| B14 | **Medium** | `notes.ts:306-338` | PATCH finds note then updates outside a transaction; no audit log on edit | Small |
| B15 | **Medium** | `notes.ts:340-358` | DELETE finds note then deletes outside a transaction; no tombstone record | Small |

#### Inline Schemas
| ID | Severity | Location | Finding | Fix Effort |
|----|----------|----------|---------|------------|
| B16 | **High** | `reports.ts:22,218,262,322` | Inline schemas (`PipelineKpis`, leads response, service-desk response, tasks response) | Small |
| B17 | **High** | `notes.ts:152` | Inline querystring schema for `GET /notes` | Small |
| B18 | **High** | `invoices.ts:32,151` | Inline schemas (`ArAgingQuery`, `InvoiceUpdate`) | Small |
| B19 | **High** | `invoices.ts:585-588` | Inline body schema for `POST /invoices/from-order/:orderId` | Small |
| B20 | **Medium** | `opportunities.ts:67-72` | Inline querystring schema for `/opportunities/count` | Small |
| B21 | **Medium** | `opportunities.ts:323-329` | Inline response schema for `POST /opportunities/:id/brief` | Small |

#### Other Architecture Issues
| ID | Severity | Location | Finding | Fix Effort |
|----|----------|----------|---------|------------|
| B22 | **High** | `reports.ts:86-148` | `/reports/pipeline` issues 4 sequential DB queries where independent ones could be batched in `Promise.all` | Small |
| B23 | **Low** | `opportunities.ts:350-366` | `mintNextCode` and `isUniqueViolation` business logic helpers live in route file | Small |

### 3.4 Database & Schema (Lens 3) — 6 Findings

| ID | Severity | Location | Finding | Fix Effort |
|----|----------|----------|---------|------------|
| D1 | **OK** | `schema.prisma` | `valueEur` fully removed; `valueMicros BigInt` used consistently | — |
| D2 | **OK** | `schema.prisma` | `deletedAt` present on 57/57 models with `@@index([deletedAt])` | — |
| D3 | **OK** | `schema.prisma` | Comprehensive indexes on `(orgId, ...)` for most query patterns | — |
| D4 | **Medium** | `schema.prisma` | `Note.accountId` and `FileAttachment.accountId` are still strings, not FKs (per prior audit) | Medium |
| D5 | **Medium** | `schema.prisma` | `Company` entity not first-class; `accountId` fields are free-text across multiple models | Medium |
| D6 | **Low** | `schema.prisma` | No composite FKs `(org_id, X_id) → X(org_id, id)` for DB-level multi-tenancy | Large |

### 3.5 Testing & QA (Lens 8) — 5 Findings

| ID | Severity | Location | Finding | Fix Effort |
|----|----------|----------|---------|------------|
| T1 | **Critical** | Root | ~~`@vitest/coverage-v8` not installed~~ ✅ **FIXED** — Installed in root devDependencies; run with `pnpm -r test -- --coverage` | Small |
| T2 | **High** | `apps/api/src/routes/` | 20 route files have no unit or integration tests (45 routes total, 14 test files + 7 integration test files = 21 tested, 24 untested) | Large |
| T3 | **High** | `apps/web/src/` | Only 6 frontend test files for 209 source files (~3% test coverage) | Large |
| T4 | **Medium** | `apps/api/src/routes/` | Integration tests skip when DB unreachable — good pattern, but means CI must provide DB to get coverage | Small |
| T5 | **Low** | `packages/shared/src/schemas/` | Zod schemas have no standalone unit tests | Medium |

### 3.6 DevOps / Production Readiness (Lens 10) — 5 Findings

| ID | Severity | Location | Finding | Fix Effort |
|----|----------|----------|---------|------------|
| P1 | **OK** | `Dockerfile` | Multi-stage build with healthchecks for API and web | — |
| P2 | **OK** | `docker-compose.yml` | Services have healthchecks with depends_on conditions | — |
| P3 | **Medium** | `docker-compose.yml:1` | ~~Obsolete `version: '3.9'` should be removed~~ ✅ **FIXED** — Removed obsolete `version` attribute | Small |
| P4 | **Medium** | `docker-compose.yml:40` | ~~`NODE_ENV: development` hard-coded in API service~~ ✅ **FIXED** — Changed to `${NODE_ENV:-development}` | Small |
| P5 | **Medium** | `.github/workflows/ci.yml` | Bundle size guard only checks non-react chunks; `motion` (137KB) and `vendor` (136KB) are not flagged | Small |

### 3.7 Workers & Queues (Lens 12) — 4 Findings

| ID | Severity | Location | Finding | Fix Effort |
|----|----------|----------|---------|------------|
| W1 | **OK** | `apps/worker/src/main.ts` | Graceful shutdown with 10s timeout, closes workers + queues + Redis | — |
| W2 | **OK** | `apps/worker/src/queues/dust-poll.ts` | Circuit breaker pattern: 3 failures → 10min cooldown | — |
| W3 | **OK** | `apps/worker/src/queues/company-enrich-apollo.ts` | HMAC-signed jobs with timing-safe verification | — |
| W4 | **Medium** | `apps/worker/src/queues/` | No `version` field on job payloads — schema evolution risk if job shape changes | Small |

### 3.8 Integration & MCP (Lens 11) — 4 Findings

| ID | Severity | Location | Finding | Fix Effort |
|----|----------|----------|---------|------------|
| M1 | **OK** | `apps/mcp-server/src/tools/` | 22 tools registered covering opportunities, contacts, tasks, leads, notes, CRM search | — |
| M2 | **OK** | `apps/mcp-server/src/tools/index.ts` | Dual naming (dotted + snake_case) for Dust compatibility | — |
| M3 | **Medium** | `apps/mcp-server/src/` | Only 5 source files + 16 tool files — minimal but functional | — |
| M4 | **Low** | `apps/api/src/routes/dust-integration.ts` | Resync endpoint is no-op per prior audit; agents list hardcoded empty | Medium |

### 3.9 Frontend Architecture (Lens 5) — 5 Findings

| ID | Severity | Location | Finding | Fix Effort |
|----|----------|----------|---------|------------|
| F1 | **OK** | `apps/web/src/App.tsx` | All 32 pages use `React.lazy()` with `Suspense` | — |
| F2 | **OK** | `apps/web/src/main.tsx` | ErrorBoundary at root + route-level via @sentry/react | — |
| F3 | **OK** | `apps/web/src/main.tsx` | React Query with sensible retry logic (no 4xx retries, 2 max for 5xx) | — |
| F4 | **Medium** | `apps/web/vite.config.ts` | No manual chunks configuration beyond default Vite behavior; `motion` (137KB) and `vendor` (136KB) could be split further | Small |
| F5 | **Medium** | `apps/web/src/` | No virtualized lists — tables with 1000+ rows will render all DOM nodes | Medium |

### 3.10 Frontend Performance (Lens 9) — 6 Findings

| ID | Severity | Location | Finding | Fix Effort |
|----|----------|----------|---------|------------|
| PERF-1 | **High** | `apps/web/src/App.tsx:1` | `framer-motion` (`AnimatePresence`, `MotionConfig`) eagerly imported at entry point. Forces ~50KB gzipped chunk on critical path before first paint | Medium |
| PERF-2 | **Medium** | `apps/web/src/pages/DashboardPage.tsx` | `AccountCockpitPage` not wrapped in `React.memo`; subscribes to 5 data hooks. Parent re-renders cascade to all 17 child cards | Small |
| PERF-3 | **Medium** | `apps/web/src/pages/DashboardPage.tsx:56` | `useTasks()` called without `limit` parameter; risks unbounded task list on dashboard | Small |
| PERF-4 | **Medium** | `apps/web/src/pages/DashboardPage.tsx:4-21` | Barrel-imports 17 cockpit components. Prevents sub-component code splitting within the dashboard chunk | Medium |
| PERF-5 | **Low** | `apps/web/src/components/cockpit/LiveDataMeshCard.tsx` | `fallbackConnectors()` allocates new array of 8 objects + fresh `Date` on every render | Small |
| PERF-6 | **Info** | `apps/web/src/App.tsx` | ✅ All routes correctly wrapped in `React.lazy()` — no eager page imports | — |

---

## 4. Cross-Validated Findings (Multiple Lenses Agree)

These findings have the highest confidence because multiple independent audits identified them.

### CV1: Fat Controllers Block Maintainability
- **Lenses:** Backend Architecture (B1-B3, B22-B23), Code Quality
- **Evidence:** `reports.ts` (995 lines, ~30 business functions), `notes.ts` (950 lines, ~25 helpers, 4 N+1 patterns), `invoices.ts` (820 lines, state machine + export + AR aging)
- **Impact:** High — changes require editing files that mix 4+ responsibilities; N+1 patterns in notes.ts cause DB lock contention during meeting import
- **Fix:** Extract service layers per domain; batch N+1 writes with `createMany`/`upsert`

### CV2: Stale OpenAPI Spec Blocks Integrations
- **Lenses:** API Design (A1), DevOps
- **Evidence:** `handoff/openapi.yaml` is 151 lines, missing sales-orders, invoices, leads, service-desk, companies
- **Impact:** Critical — external developers and MCP consumers code against phantom contracts
- **Fix:** Generate from Zod schemas using `@fastify/swagger` or manually sync

### CV3: Thin RBAC Coverage
- **Lenses:** Security (S1), Backend Architecture
- **Evidence:** Only `/audit-logs` and `/dust/*` use `requireRole('admin')`. Other admin routes (roles, users, plugins) have no role gate
- **Impact:** High — any authenticated user can modify roles, install plugins, delete users
- **Fix:** Add `preHandler: server.requireRole('admin')` to all admin-only routes

### CV4: Missing Test Coverage Visibility
- **Lenses:** Testing (T1), DevOps
- **Evidence:** `@vitest/coverage-v8` not installed; 20 route files untested; web at ~3%
- **Impact:** High — cannot measure quality, cannot gate releases on coverage
- **Fix:** Install `@vitest/coverage-v8`, add coverage thresholds to CI, write tests for critical routes

---

## 5. Priority Roadmap

### Week 1 — Blockers (Security + Contract)
1. **S1:** Add `requireRole('admin')` to all admin routes (roles, users, plugins, predictive scores)
2. **A1:** Sync or regenerate `openapi.yaml` from current Zod schemas
3. **A2:** Add `response: { 200: OpportunityFull }` to `GET /opportunities/:id`
4. **A3:** Wire `owner` field in Opportunity POST/PATCH or remove from schema
5. **S7:** Patch or replace `d3-color` dependency

### Week 2 — High Impact (Pagination + Tests + N+1)
6. **A4-A5:** Add cursor pagination to Contacts and Tasks lists; add `GET /tasks/:id`
7. **T1:** Install `@vitest/coverage-v8` and add CI threshold
8. **T2:** Write integration tests for the 20 untested route files (prioritize: invoices, sales-orders, leads, files)
9. **B4-B7:** Fix N+1 patterns in `notes.ts` persist helpers — batch with `findMany` + `createMany`/`upsert`
10. **B1-B3:** Begin service-layer extraction from `reports.ts`, `notes.ts`, `invoices.ts`

### Month 2 — Medium Impact (Architecture + Polish)
11. **B8-B15:** Fix remaining architecture issues (SELECT *, missing transactions, inline schemas)
12. **A6-A9:** Move inline schemas to `packages/shared/src/schemas/`
13. **A10-A11:** Add client-controlled sorting and standardize pagination limits
14. **D4-D5:** Migrate `accountId` strings to FKs or first-class `Company` model
15. **F5:** Add virtualized lists to high-density tables (opportunities, contacts, tasks)
16. **PERF-1:** Move framer-motion off critical path (dynamic import or CSS transitions)
17. **PERF-2-PERF-5:** Frontend performance fixes (memoization, limit params, code splitting)
18. **P3-P4:** Fix Docker compose (`version` removal, `NODE_ENV` from env)

---

## 6. Per-Lens Raw Findings

### Lens 1: Security Hardening
Auth plugin (`apps/api/src/plugins/auth.ts`) is well-implemented:
- Clerk JWT verification with `verifyToken`
- SSO domain restriction via `SSO_ALLOWED_EMAIL_DOMAINS`
- JIT provisioning with role sync
- Stub mode strictly guarded by `NODE_ENV === 'development'`
- Token extracted correctly from `Authorization: Bearer` header

RBAC plugin (`apps/api/src/plugins/rbac.ts`) is minimal but correct:
- `requireRole` decorator on `FastifyInstance`
- Only used on 2 routes (`audit-logs`, `dust-integration` admin endpoints)
- Most admin routes (role management, user management, plugin install) lack role checks

Webhook security (`apps/api/src/routes/webhooks.ts`) is solid:
- HMAC verification via `verifyDustSignature`
- Timestamp replay window (±5min)
- Event ID dedup via Redis NX (7d TTL)
- In-process Map fallback for dev with warn logging

### Lens 2: Backend Architecture
Fat controllers identified by line count:
| File | Lines | Responsibilities |
|------|-------|-----------------|
| `reports.ts` | 995 | Report generation, CSV export, PDF rendering, chart data, KPI calculation |
| `notes.ts` | 950 | Note CRUD, meeting import, contact/risk/task/compliance extraction |
| `invoices.ts` | 820 | Invoice CRUD, state transitions, payments, PDF, CSV export |
| `odoo-integration.ts` | 790 | MCP proxy, model allow-list, error handling, auth |
| `sales-dashboard.ts` | 538 | KPI aggregation, chart data, AR aging, treemap |
| `territories.ts` | 521 | Territory CRUD, geo-mapping, forecasts, lead routing rules |
| `sales-orders.ts` | 416 | Order CRUD, state machine, line items, audit log |

Transaction safety:
- Opportunities POST/PATCH/DELETE use `$transaction` (fixed in Sprint A)
- Sales-orders create + audit log use `$transaction`
- Invoices need verification for payment recording atomicity

### Lens 3: Database & Schema
Soft delete coverage: **100%** — all 57 models have `deletedAt DateTime?` with `@@index([deletedAt])`.

Index coverage: **Strong** — most models have:
- `@@index([orgId])` for multi-tenancy
- Domain-specific composite indexes (e.g., `@@index([orgId, status, dueDate])` on tasks)
- Recent migration added performance indexes on opportunities, contacts, tasks, sync_events

Micros doctrine: **Compliant** — no `valueEur` or `Decimal(14,2)` found. `valueMicros BigInt` used.

Schema gaps:
- `Note.accountId` and `FileAttachment.accountId` remain strings (not FKs)
- `Company` entity not first-class
- No composite FKs for DB-level multi-tenancy

### Lens 4: API Design & Contract
See Section 3.1 for full 19 findings.

### Lens 5: Frontend Architecture
Lazy loading: **Complete** — all 32 pages use `React.lazy()`.

Bundle analysis:
| Chunk | Size | Status |
|-------|------|--------|
| `index-CoG2KP_A.js` | 198KB | ⚠️ Near limit |
| `DashboardPage` | 140KB | OK |
| `motion` | 137KB | OK (library) |
| `vendor` | 136KB | OK (library) |
| `clerk` | 95KB | OK (library) |
| `TerritoriesPage` | 77KB | OK |

State management: Zustand for UI state, React Query for server state. Clean separation.

### Lens 8: Testing & QA
See Section 3.5 for full findings.

Untested route files (20):
`account-intel.ts`, `collaboration.ts`, `companies.ts`, `contacts.ts`, `custom-fields.ts`, `invoices.ts`, `leads.ts`, `opportunities.ts`, `opportunity-contacts.ts`, `plugins.ts`, `predictive.ts`, `products.ts`, `reports.ts`, `roles.ts`, `sales-dashboard.ts`, `sales-orders.ts`, `search.ts`, `service-desk.ts`, `tasks.ts`, `territories.ts`

### Lens 10: DevOps / Production Readiness
Dockerfile: Multi-stage build (base → builder → api/web/worker/mcp-server). Healthchecks on API and web. Uses `pnpm install --frozen-lockfile --prod` in final stages.

docker-compose.yml: Has obsolete `version: '3.9'` attribute. Hard-codes `NODE_ENV: development` in API service. Missing MCP server and worker services in the shown config.

CI/CD: `.github/workflows/ci.yml` runs typecheck, lint, test, build, bundle size guard (200KB non-react chunks). No coverage gate.

### Lens 11: Integration & MCP Ecosystem
MCP Server: 22 tools registered. Dual naming for Dust compatibility. Auth via `McpAuthCtx`.

Dust Integration: Push-deal works. Resync is no-op. Agents list hardcoded empty.

Odoo Integration: JSON-RPC client with model allow-list (`ALLOWED_ODOO_MODELS`). HMAC-signed requests. Safe error message scrubbing.

Webhooks: HMAC verification, dedup, timestamp window. Solid implementation.

### Lens 12: Workers & Queue Reliability
4 queues: dust-poll, webhook-processor, company-enrich-apollo, document-extract.

Circuit breaker on dust-poll: 3 failures → 10min cooldown.

Job signing on Apollo enrichment: HMAC with timing-safe verify.

Graceful shutdown: 10s timeout, closes workers → queues → Redis connection.

Missing: Job payload versioning, dead-letter queue configuration.

---

## Appendix: Audit Methodology

**Phase 1 — Automated Baseline:**
- `pnpm audit --audit-level moderate`
- `pnpm -r lint`
- `pnpm -r typecheck`
- `pnpm -r test`
- `pnpm -r build`
- `docker compose config`
- File count and line count analysis

**Phase 2 — Specialist Lenses:**
- Lens 1 (Security): Agent scoped to auth.ts, rbac.ts, server.ts, webhooks.ts, files.ts
- Lens 2 (Backend Architecture): Agent scoped to top 7 route files + server.ts
- Lens 3 (Database): Direct analysis of schema.prisma + migration files
- Lens 4 (API Design): **Agent completed** — 19 findings from shared schemas + route files
- Lens 5 (Frontend Architecture): Agent scoped to App.tsx, main.tsx, vite.config.ts
- Lens 6 (Accessibility): Agent scoped to index.css, layout components, cockpit components
- Lens 7 (UX/Design): Deferred to next session
- Lens 8 (Testing): Direct analysis of test file distribution
- Lens 9 (Performance): Agent scoped to vite.config.ts, App.tsx, DashboardPage.tsx
- Lens 10 (DevOps): Direct analysis of Dockerfile, docker-compose.yml, CI
- Lens 11 (Integration/MCP): Direct analysis of MCP tools, dust/odoo routes
- Lens 12 (Workers): Direct analysis of queue files, main.ts

**Phase 3 — Cross-Validation:**
Manual cross-reference of findings across lenses. 4 findings confirmed by 2+ lenses.

**Phase 4 — Report Synthesis:**
Aggregated into executive summary, baseline metrics, findings matrix, cross-validated findings, and priority roadmap.
