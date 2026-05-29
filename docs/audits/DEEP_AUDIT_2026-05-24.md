# BidStack 360° — Deep Audit Master Synthesis Report

**Date:** 2026-05-24  
**Synthesizer:** Agent-Synthesis (read-only)  
**Rubric:** Functional 25 / Code 25 / Design 25 / Infra 25  
**Ship Threshold:** ≥ 95 / 100

---

## 1. Executive Summary

BidStack 360° is a **functionally rich but structurally uneven** codebase. The frontend Design layer is the strongest suit (pages, components, and tokens all score in the low-to-mid 80s), while the backend Worker layer, API Services, and core CRM domains (Opportunities/Pipeline, Companies/Contacts) drag the composite score into the low 70s. The most critical systemic issue is **incomplete authorization enforcement**: the RBAC matrix and permission keys are well-designed, but ~80 % of write routes remain unguarded, making the six canonical roles honorary labels rather than access controls.

**Current composite score: 70.2 / 100.**

Reaching the 95/100 ship threshold requires a **two-phase remediation**:

- **Phase 1 (this report):** Close the 10 highest-impact P0 gaps. Estimated lift: **+8 to +10 points**, bringing the composite to **~78–80**.
- **Phase 2:** Systematic P1 cleanup, test-depth expansion (MSW, user-event), and design-system hardening (type-scale discipline, spacing-grid enforcement) to close the remaining ~15–17 point gap.

---

## 2. Domain Scorecard

| #   | Domain                   | Score | Rubric Dimensions  | Status                                                                     |
| --- | ------------------------ | ----- | ------------------ | -------------------------------------------------------------------------- |
| 01  | API Routes               | 72    | Functional, Code   | ✅ Available                                                               |
| 02  | API Services             | 62    | Functional, Code   | ✅ Available                                                               |
| 03  | DB Schema                | 72    | Infra, Functional  | ✅ Available                                                               |
| 04  | DB Queries               | 72    | Code, Infra        | ✅ Available                                                               |
| 05  | Auth / Security          | 72    | Infra              | ✅ Available                                                               |
| 06  | Frontend Pages           | 84    | Design, Functional | ✅ Available                                                               |
| 07  | Frontend Components      | 82    | Design, Code       | ✅ Available                                                               |
| 08  | Frontend State           | 72    | Design, Code       | ✅ Available                                                               |
| 09  | Frontend Tests           | 72    | Code, Functional   | ✅ Available                                                               |
| 10  | Worker Jobs              | 52    | Infra, Functional  | ✅ Available                                                               |
| 11  | Integrations             | 68    | Functional, Infra  | ✅ Available                                                               |
| 12  | MCP Server               | 74    | Functional, Code   | ✅ Available                                                               |
| 13  | Marketing Site           | 72    | Design, Infra      | ✅ Available                                                               |
| 14  | Shared Libs              | 72    | Code, Functional   | ✅ Available                                                               |
| 15  | Infra / DevOps           | 72    | Infra              | ✅ Available                                                               |
| 16  | Design System            | 84    | Design             | ✅ Available                                                               |
| 17  | Opportunities / Pipeline | 62    | Functional, Code   | ✅ Available                                                               |
| 18  | Companies / Contacts     | 58    | Functional, Code   | ✅ Available                                                               |
| 19  | Reports / Analytics      | _65_  | Functional         | ⚠️ **Missing report** — imputed as average of available Functional domains |

### Score Distribution

```
90–100 │ ░░░░░░░░░░  (none)
80–89  │ ████        (Frontend Pages 84, Design System 84, Frontend Components 82)
70–79  │ ██████████  (API Routes 72, DB Schema 72, DB Queries 72, Auth 72, Frontend State 72,
       │             Frontend Tests 72, Shared Libs 72, Infra 72, Marketing 72, MCP 74)
60–69  │ ███         (API Services 62, Opportunities 62, Integrations 68, Reports* 65)
50–59  │ █           (Workers 52, Companies/Contacts 58)
```

---

## 3. Rubric Dimension Breakdown

### 3.1 Functional (25 pts)

**Contributing domains:** API Routes, API Services, Opportunities/Pipeline, Companies/Contacts, Reports/Analytics, Integrations, MCP Server, Workers, Marketing Site

```
(72 + 62 + 62 + 58 + 65 + 68 + 74 + 52 + 72) / 9 = 585 / 9 = 65.0
Functional contribution = 65.0 × 0.25 = 16.25 / 25
```

**Key drags:**

- **Workers (52)** — Call-processing pipeline is completely unwired (`apps/worker/src/main.ts` never imports `startCallWorkers`). Four queues (`call.fetch-recording`, `call.transcribe`, `call.analyze`, `call.update-deal`) are dead code.
- **Companies/Contacts (58)** — Soft-delete unique constraint collisions orphan data, contact→company linkage is decoupled, and hierarchy N+1 recursion has no depth limit.
- **Opportunities/Pipeline (62)** — Zero stage-transition guardrails; probability is not synced on stage move; win/loss tracking hard-codes the deprecated `OpportunityStage` enum instead of `PipelineStage.isWon` / `isLost`.
- **API Services (62)** — `dashboard.service.ts` injects fabricated KPIs (e.g., `Total devices: 1,842` as a literal string) mixed with real queries.

### 3.2 Code (25 pts)

**Contributing domains:** API Routes, API Services, DB Queries, DB Schema, Shared Libs, MCP Server, Frontend Tests, Workers

```
(72 + 62 + 72 + 72 + 72 + 74 + 72 + 52) / 8 = 548 / 8 = 68.5
Code contribution = 68.5 × 0.25 = 17.125 / 25
```

**Key drags:**

- **Workers (52)** — No DLQ for failed jobs; circuit-breaker state is process-local and racy; document-extract worker misnames a `BullWorker` as `queue`.
- **API Services (62)** — Global `prisma` singleton destroys testability; N+1 in `tenantEntitiesBelongToOrg`; external HTTP calls interleaved with DB writes with no compensating rollback.
- **Frontend Tests (72)** — Zero `@testing-library/user-event` imports across 25 unit-test files; no MSW; 88 conditional `test.skip` calls in E2E mask data-dependency fragility.

### 3.3 Design (25 pts)

**Contributing domains:** Frontend Pages, Frontend Components, Frontend State, Design System, Marketing Site

```
(84 + 82 + 72 + 84 + 72) / 5 = 394 / 5 = 78.8
Design contribution = 78.8 × 0.25 = 19.7 / 25
```

**Key drags:**

- **Frontend State (72)** — Most mutations lack user-facing error handling; overly broad `invalidateQueries` risks cache thrashing; `useNotes` has a closure race over `accountId`.
- **Marketing Site (72)** — Broken Open Graph image reference (`og-default.png` vs actual `.svg`); deceptive footer links (10 labels all route to `/`); catch-all route returns 200 OK for missing pages.

### 3.4 Infra (25 pts)

**Contributing domains:** DB Schema, DB Queries, Auth/Security, Infra/DevOps, Workers, Integrations, Marketing Site

```
(72 + 72 + 72 + 72 + 52 + 68 + 72) / 7 = 480 / 7 ≈ 68.57
Infra contribution = 68.57 × 0.25 ≈ 17.14 / 25
```

**Key drags:**

- **Workers (52)** — No dead-letter queues; no Bull Board or Prometheus queue metrics; no `worker.on('stalled')` handlers.
- **Auth/Security (72)** — RBAC enforcement is missing on ~80 % of routes; Zapier routes bypass global auth plugin and lack rate limits; API keys have no expiry or rotation.
- **Integrations (68)** — Odoo credentials are global env vars (multi-tenancy violation); Zoom token cache is in-process; Dust poll pulls all documents every 5 minutes with no delta cursor.

---

## 4. Final Weighted Score

| Dimension     | Raw Average | Weighted Contribution |
| ------------- | ----------: | --------------------: |
| Functional    |  65.0 / 100 |        **16.25 / 25** |
| Code          |  68.5 / 100 |        **17.13 / 25** |
| Design        |  78.8 / 100 |        **19.70 / 25** |
| Infra         |  68.6 / 100 |        **17.14 / 25** |
| **Composite** |           — |        **70.2 / 100** |

---

## 5. Top 10 P0 Actions (Highest Impact / Effort Ratio)

> Each action is mapped to specific audit evidence. Estimated impacts are conservative, first-order effects on the composite score.

### P0-1 — Wire up call-processing pipeline in worker bootstrap

- **Source:** Agent-10, §3.1
- **Evidence:** `apps/worker/src/main.ts:12-26` imports 12 queue starters but omits `./queues/calls.js`. `startCallWorkers` is exported but never invoked.
- **Fix:** Import `startCallWorkers` and invoke it in the bootstrap sequence.
- **Impact:** Workers 52 → 78. Raises composite by **~+1.8 pts** (spans Functional, Code, Infra).

### P0-2 — Apply RBAC `preHandler` guards to all unguarded write routes

- **Source:** Agent-05, §P0-1; Agent-01, §P0.2
- **Evidence:** `opportunities.ts`, `contacts.ts`, `leads.ts`, `tasks.ts`, `notes.ts`, `activities.ts`, and `files.ts` all have zero `preHandler` checks on POST/PATCH/DELETE. By contrast, `companies.ts` correctly uses `requirePermission('companies:write')` + `requireRole('admin')`.
- **Fix:** Either add `preHandler: [server.requirePermission('resource:write')]` to every mutating route, or introduce a default-deny Fastify `onRequest` hook that consults the RBAC service when no explicit permission is declared.
- **Impact:** Auth/Security 72 → 88; API Routes 72 → 85. Raises composite by **~+1.5 pts**.

### P0-3 — Remove or gate all hardcoded fallback KPIs in `dashboard.service.ts`

- **Source:** Agent-02, §3.4
- **Evidence:** Lines 630 (`Total devices: 1,842`), 608 (`2,500+` fallback), 993-1013 (`defaultRisks`), 1016-1061 (`defaultCompliance`), 1140-1155 (`defaultReleaseScore`), and 1157-1213 (`defaultTechnicalStack`) inject fabricated metrics.
- **Fix:** Gate every fallback behind `isDemo === true` or remove them entirely. Return `null` for missing data so the UI can render empty states.
- **Impact:** API Services 62 → 80. Raises composite by **~+0.9 pts**.

### P0-4 — Add stage-transition guardrails, probability sync, and PipelineStage backfill migration

- **Source:** Agent-17, §3.1–3.5
- **Evidence:** `opportunities.ts:526` explicitly allows _"Any stage can move to any stage within the same pipeline for now."_ `probability` is never updated on stage move. The `canonicalize_opportunity_stage` migration is 0 bytes; `pipeline_stages` was created inside the catch-all `sync_drift` migration with no backfill.
- **Fix:** (a) Enforce `orderIndex` progression and `isWon`/`isLost` irreversibility. (b) Sync `Opportunity.probability` from `PipelineStage.probability` inside the stage-move transaction. (c) Write a migration that creates default `PipelineStage` rows per org and backfills `opportunity.pipeline_stage_id`.
- **Impact:** Opportunities/Pipeline 62 → 82. Raises composite by **~+0.7 pts**.

### P0-5 — Fix Companies soft-delete unique collisions and orphan hierarchies

- **Source:** Agent-18, §3.1–3.2
- **Evidence:** `schema.prisma:285-286` defines `@@unique([orgId, name])` and `@@unique([orgId, domain])` without filtering `deletedAt`, so a soft-deleted "Acme" blocks re-creation. `companies.ts:304-307` soft-deletes a parent without clearing `parentId` on children, causing them to vanish from the tree.
- **Fix:** (a) Add partial unique indexes (`WHERE deleted_at IS NULL`) or switch to application-layer dedup. (b) On soft-delete, nullify `parentId` on children or re-parent to the grandparent.
- **Impact:** Companies/Contacts 58 → 75. Raises composite by **~+0.6 pts**.

### P0-6 — Add missing foreign-key indexes and fix migration hygiene

- **Source:** Agent-03, §3.1–3.4
- **Evidence:** 14+ FK columns lack indexes (e.g., `Opportunity.companyId`, `Invoice.customerId`, `HealthScore.accountId`). Two migrations share timestamp `20260524000000_*`, causing non-deterministic ordering. The `sync_drift` migration is 2,847 lines of destructive schema reconciliation.
- **Fix:** (a) Add `@@index` for every FK column identified in Agent-03, then generate a targeted migration. (b) Rename one colliding migration. (c) Document that `sync_drift` is a baseline and future migrations must be incremental.
- **Impact:** DB Schema 72 → 85. Raises composite by **~+0.6 pts**.

### P0-7 — Cap unbounded worker `findMany` queries and add missing `orderBy`

- **Source:** Agent-04, §3.1–3.2
- **Evidence:** `apps/worker/src/queues/cs.ts` loads **every org** without `take` in five separate polling loops. `apps/worker/src/queues/dust-poll.ts:76` and `:98` do the same. Eight `findMany` calls specify `take` but omit `orderBy`, yielding non-deterministic result sets.
- **Fix:** Add `take: 1000` (or smaller) to every worker `org.findMany` with a continuation cursor. Add `orderBy` to all `findMany` that specify `take`.
- **Impact:** DB Queries 72 → 82. Raises composite by **~+0.5 pts**.

### P0-8 — Fix Twilio Voice SHA-256 bug, Odoo global credentials, and Gmail empty-string token refresh

- **Source:** Agent-11, §P0-1–P0-4
- **Evidence:** `twilio-voice.service.ts:94-115` uses `createHmac('sha256', ...)` instead of `sha1`, rejecting every valid voice webhook. `packages/integrations/src/odoo/index.ts:17-26` reads `ODOO_MCP_URL` from `process.env` for all tenants. `email-integration.service.ts:62-63` passes `''` for missing `GMAIL_CLIENT_ID` / `GMAIL_CLIENT_SECRET`.
- **Fix:** (a) Change Twilio Voice to `sha1`. (b) Move Odoo credentials to per-org `IntegrationConfig`. (c) Throw on missing Gmail env vars instead of passing empty strings.
- **Impact:** Integrations 68 → 82. Raises composite by **~+0.5 pts**.

### P0-9 — Sanitize MCP tool errors and fix `leadsConvert` split transaction

- **Source:** Agent-12, §3.1 & §3.4
- **Evidence:** `apps/mcp-server/src/server.ts:59-61` returns `err.message` directly to MCP clients, leaking Prisma error codes. `leads-convert.ts:49-90` updates `lead.status` inside a transaction but writes `convertedToOpportunityId` in a second, non-transactional update.
- **Fix:** (a) Map errors to generic safe labels before returning. (b) Move `convertedToOpportunityId` and `convertedAt` into the single `$transaction` block.
- **Impact:** MCP Server 74 → 85. Raises composite by **~+0.4 pts**.

### P0-10 — Fix broken Open Graph image, deceptive footer links, and soft-404 catch-all

- **Source:** Agent-13, §3.1–3.3
- **Evidence:** `index.html:28` references `og-default.png` but only `og-default.svg` exists. `Footer.tsx:10-55` routes 10 distinct labels to `/`. `App.tsx:52-54` renders `<HomePage />` for `path="*"` with HTTP 200.
- **Fix:** (a) Update OG meta to `.svg` or generate a `.png`. (b) Remove placeholder footer links or create actual pages. (c) Render a dedicated `NotFoundPage` with HTTP 404.
- **Impact:** Marketing Site 72 → 84. Raises composite by **~+0.4 pts**.

### Combined Phase-1 Impact

| Phase                                                       | Estimated Composite |          Lift |
| ----------------------------------------------------------- | ------------------: | ------------: |
| Baseline                                                    |                70.2 |             — |
| Phase 1 (Top 10 P0s)                                        |          **~78–80** | **+8 to +10** |
| Phase 2 (All remaining P0 + critical P1)                    |          **~88–92** |     +8 to +12 |
| Phase 3 (Polish, full test depth, design-system discipline) |            **≥ 95** |      +3 to +7 |

---

## 6. Summary Narrative

BidStack 360° is **not a greenfield prototype**—it is a production-grade CRM with sophisticated multi-tenancy, audit logging, soft-delete discipline, and a polished frontend design system. The architecture is sound: React Query + Zustand on the client, Fastify + Prisma on the API, BullMQ + Redis for workers, and Clerk for auth. The team has invested heavily in accessibility (axe-core gating, keyboard nav, `prefers-reduced-motion`), performance (LCP < 2.0s budgets, bundle-size guards), and security (penetration-test suite, HMAC verification, PII encryption).

**Why the score is 70.2 instead of 90+:**

1. **Execution gaps in critical paths.** The call-processing pipeline exists as code but is never bootstrapped. The RBAC permission matrix exists as a type-system artifact but is not enforced. The PipelineStage table exists in schema but has no backfill migration. These are **“wiring” failures**, not design failures—and wiring failures are the cheapest to fix.

2. **Data-integrity hazards at the DB layer.** Missing FK indexes, missing `deletedAt` on ~20 models, missing unique constraints on `Contact.email`, and a 2,847-line drift-fix migration all signal that the database state has diverged from the Prisma schema. This is operational debt that will degrade query performance and complicate rollbacks.

3. **Inconsistent middleware and error handling.** Dual error patterns (`throw` vs `reply`), dual authZ conventions (opt-in vs default-deny), and dual `useReducedMotion` imports create friction for new developers and increase regression risk.

4. **Frontend test depth is shallow.** E2E is mature (accessibility, performance, visual regression), but unit tests are render-only smoke tests. With zero `user-event` coverage and no MSW, interaction regressions are only caught in the browser.

**The path to 95:**

- **Week 1–2:** Execute the Top 10 P0 actions above. These are surgical, evidence-based fixes with the highest return on effort.
- **Week 3–4:** Address the remaining P0 gaps (DLQ for workers, SSRF IPv6 hardening, contact-company FK sync, custom-field transaction wrapping, API key expiry).
- **Week 5–6:** Expand test depth (MSW adoption, `user-event` for Button/Dialog/Tabs/CommandPalette, replace `test.skip` with seeded fixtures).
- **Week 7–8:** Design-system hardening (remove `.btn` touch-target override, encode type scale in `@theme`, enforce 8px grid via lint rules).

If the team maintains the existing quality bar for new code while closing the audited gaps, **95/100 is achievable within two sprints**.

---

_End of synthesis._
