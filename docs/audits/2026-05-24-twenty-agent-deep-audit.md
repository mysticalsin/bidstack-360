# BidStack 360° — 20-Agent Full-Stack & CRM Deep Audit

**Date:** 2026-05-24
**Branch:** `running_best` (411 uncommitted files at time of audit — WIP)
**Method:** 20 parallel specialist sub-agents, read-only investigation
**Benchmark:** Salesforce Sales Cloud + Odoo Enterprise

---

## TL;DR

| Score | Value |
|---|---|
| **Overall composite** | **55 / 100** |
| Full-Stack (12 image layers) | 59 / 100 |
| CRM Capability (8 dimensions) | 48 / 100 |

**Headline:** The application **code** is materially above its category (auth, idempotency, multi-tenancy, a11y, observability *hooks* are at or near Salesforce-grade). The **operations layer** (backups, IaC, CDN, secrets) and the **CRM functional layer** (Quote object, cadences, email/calendar, workflow execution) are well behind. Three hard enterprise blockers exist today.

**Three hard blockers — fix before any enterprise pitch:**
1. **No backups, no PITR, no Redis persistence** — single host loss = total tenant data loss
2. **Workflow action executors are silent no-ops** — `executeAction()` returns `{executed: true}` while doing nothing (violates Conduct Rule 12)
3. **RBAC admin bypass** — any Clerk `org:admin` with un-seeded UserRole rows skips every `requirePermission` check (`apps/api/src/plugins/rbac.ts:62-64`)

**Time to Salesforce/Odoo parity:** ~30 weeks, peak 4–5 engineers, ~85/100 achievable on the same code base.

---

## Master Scorecard — 20 Audits

### Full-Stack image layers (12)

| # | Layer | Score | One-line verdict |
|---|---|---|---|
| 1 | Frontend (apps/web) | **79** | Lazy routes, command palette, kanban, deep a11y — missing virtualization + saved views |
| 2 | Backend / API (apps/api) | **86** | Strongest dimension. Idempotency + multi-tenancy + Pino redact are Stripe-grade |
| 3 | Database / Prisma | **78** | 76 models, bulletproof tenant isolation; missing Quote/PriceBook/createdBy/pgvector |
| 4 | Server runtime & workers | **76** | Graceful shutdown + lease/heartbeat reaper good; single-replica worker + in-memory MCP sessions risky |
| 5 | Networking & API design | **64** | Idempotency + per-route rate limits + MCP solid; no live OpenAPI, versioning is theatre, no bulk |
| 6 | Cloud Infrastructure | **28** | Zero IaC. Single-host Postgres in Docker. No Multi-AZ. No secrets manager. No TLS in repo |
| 7 | CI/CD pipelines | **52** | Tests pass; no image build/push, no SAST/CodeQL, no preview env, no release automation |
| 8 | Security | **78** | Tenant isolation excellent; 3 HIGH: MCP rate-limit not Redis, RBAC admin bypass, un-sandboxed parsers |
| 9 | Containerization | **58** | Multi-stage + healthchecks good; root user everywhere, no tini, Swarm-only `deploy.*` ignored |
| 10 | CDN / static delivery | **56** | Vite chunking great; **service worker caches `/api/` without org-scope = tenant leak risk** |
| 11 | Monitoring & Logging | **48** | Pino + Sentry + audit log strong; **zero `/metrics` endpoint, no SLOs, no alerts, no queue dashboards** |
| 12 | Backups & Recovery | **6** | None. No `pg_dump`, no PITR, no Redis AOF, no GDPR export. Single host loss = total loss |
|   | **Stack average** | **59 / 100** |

### CRM Capability layers (8)

| # | Capability | Score | One-line verdict |
|---|---|---|---|
| 13 | Sales Pipeline & Opportunities | **47** | Accessible kanban + stage guards; **no Quote object**, hard-coded stage enum, no StageHistory/LossReason |
| 14 | Account / Contact / Lead | **52** | Solid Lead → Opportunity flow; **no account hierarchy**, no merge UX, anemic Contact, no GDPR consent |
| 15 | Activities / Tasks / Email | **38** | Activity model good; **zero email pipeline**, MS Graph is placeholder, no cadences, no notifications |
| 16 | Reporting & Analytics | **51** | Beautiful prebuilt dashboards; no custom report builder, no scheduled delivery, no drillthrough, missing RBAC |
| 17 | Workflow Automation | **22** | Schema is ~60% of Salesforce Flow; **execution is placeholder** — triggers don't fire, actions are no-ops |
| 18 | Integration Capabilities | **38** | MCP + Dust mature; outbound webhooks **don't deliver**, no OpenAPI, no SDK, no OAuth2 provider |
| 19 | Accessibility & i18n | **71** | A11y near Salesforce parity (route announcer, ARIA, reduced motion); **i18n effectively non-existent** |
| 20 | Testing & Quality | **62** | Tiered CI good; no coverage gate on backend, no transaction isolation, shallow specs |
|   | **CRM average** | **48 / 100** |

---

## Cross-cutting critical findings (collected across audits)

### Tenant-isolation regressions (multi-tenancy floor)
1. `apps/api/src/plugins/redis-cache.ts:23` reads `server.auth?.orgId` (always `'anon'`) — currently unused but a single enable away from cross-tenant cache leak.
2. `apps/web/public/sw.js` caches `/api/` GETs without per-org/per-user key scoping — cross-tenant leak risk on shared devices.
3. `apps/api/src/plugins/rbac.ts:62-64` falls back to `req.auth.role === 'admin'` — bypasses every granular `requirePermission` gate when UserRole rows are unseeded.

### Fail-loud violations (Conduct Rule 12)
1. `workflows.ts:executeAction()` returns `{executed: true}` for `send_email`, `send_slack`, `update_field`, `assign_owner`, `run_dust_agent`, `call_webhook`, `create_notification` — silently does nothing.
2. `apps/web/src/components/settings/NotificationPrefsSection.tsx` writes to `localStorage` only; no server prefs table.
3. `apps/web/src/components/settings/PipelineStagesSection.tsx` writes pipeline stages to `localStorage` only; API/validator/kanban don't read them.
4. `apps/web/src/lib/web-vitals.ts` only `console.log`s Web Vitals in prod despite collection wired correctly.
5. `apps/api/src/otel.ts:12` silently returns when OTLP endpoint env unset — no startup warning.

### Untracked technical debt (already flagged in code)
1. Six tables carry `accountId String @deprecated` alongside UUID `companyId?` (schema lines 802, 836). Dual-write referential-integrity hole.
2. `OpportunityStage` is a Postgres enum + `OrgSettings.pipelineStages` JSON that nothing reads. Renaming a stage today desyncs UI, API, reports.
3. `apiVersioningPlugin` has unreachable code — `/api/*` is rewritten to `/api/v1/*` before negotiation can run.
4. `vite.config.ts:45` hard-defines `NODE_ENV=production`, making dev-only branches in `main.tsx`/`ErrorBoundary.tsx` unreachable.

---

## The path to Salesforce / Odoo parity — phased plan

Effort labels: **S** ≤ 1 wk · **M** 1–3 wks · **L** 3–8 wks · Impact: **H/M/L**. Phases can overlap where dependencies allow.

### Phase 0 — Don't lose anyone's data (Weeks 1–2)

| Action | Effort | Impact | Files / scope |
|---|---|---|---|
| `pg_basebackup` + `wal-g` to S3 versioned bucket; nightly + WAL streaming | S | H | new `scripts/backup/`, cron in compose |
| Redis: `--appendonly yes`, `appendfsync everysec`, mount `redis_data:/data` | S | H | `docker-compose.prod.yml` |
| S3 bucket: versioning ON, lifecycle 30/90, SSE-KMS, cross-region replication | S | H | docs/INFRA.md + bucket policy |
| Quarterly restore drill + `docs/runbooks/restore.md` | S | H | new runbook |
| Define RPO 1h / RTO 4h, publish in `docs/SLO.md` | S | H | new doc |
| GDPR tenant export: `POST /api/orgs/:id/export` → BullMQ job → signed S3 zip + tenant-delete with 30d soft window | M | H | new route + new worker queue |

**Score lift:** Backups 6 → 55, Cloud Infra 28 → 40.

### Phase 1 — Production substrate (Weeks 3–6)

| Action | Effort | Impact |
|---|---|---|
| Adopt Terraform: VPC, RDS Multi-AZ Postgres, ElastiCache Multi-AZ Redis (cluster mode + AOF), ECS Fargate, ALB + ACM (TLS 1.3 + HSTS), S3, IAM. State in S3 + DynamoDB lock | L | H |
| AWS Secrets Manager + External Secrets Operator. Delete plaintext env vars from compose; rotate Clerk/Dust/DB creds | M | H |
| CI: `.github/workflows/docker-build-push.yml` with `docker/build-push-action@v5`, multi-target matrix → `ghcr.io/<org>/bidstack-<svc>:${sha}` | S | H |
| CI: Trivy CVE scan (fail on CRITICAL/HIGH), CodeQL JS/TS workflow, `gitleaks-action` on full repo, SBOM with `docker buildx --sbom=true`, `cosign sign` | M | H |
| Per-PR preview deploys (Fly.io/Render) with sticky PR comment | L | H |
| `changesets/action` for release automation + `CHANGELOG.md` + `CODEOWNERS` + required-check declaration | S | M |
| CDN: CloudFront in front of nginx; brotli + `gzip_static`; long-cache hashed `/assets/`; pre-compress at build | M | H |
| Self-host + subset fonts; drop Google Fonts blocking `<link>`; add `<link rel=preload as=font crossorigin>` for LCP weight; `font-display: swap` | S | H |
| Image pipeline: `vite-imagetools` → AVIF/WebP for `hero_bg.jpeg` + `<picture>` `srcset` + `fetchpriority=high` + preload in `index.html` | M | H |

**Score lift:** Cloud Infra 28 → 75, CI/CD 52 → 80, CDN 56 → 82.

### Phase 2 — Container & runtime hardening (Weeks 4–6, parallel to Phase 1)

| Action | Effort | Impact |
|---|---|---|
| Add `USER node` (Node stages) + `USER nginx` (web) + `chown -R node:node /app` | S | H |
| Add `tini` to all images; `ENTRYPOINT ["/sbin/tini","--"]` — critical for worker (OCR child processes) | S | H |
| Replace Swarm-only `deploy.*` with `mem_limit`/`cpus`/`pids_limit`; add `image:` tags wired to GHCR | M | H |
| Switch `api` + `mcp-server` to `gcr.io/distroless/nodejs24-debian12:nonroot`; copy `node_modules` from builder | L | M |
| Externalize MCP sessions to Redis (currently `new Map()` in `apps/mcp-server/src/server.ts:125-126`) — unblocks `replicas ≥ 2` | M | H |
| Real worker readiness probe (DB ping + `Worker.isRunning()` + queue lag) replacing the Redis-only check | S | H |
| Per-queue concurrency caps in `apps/worker/src/queues/dust-poll.ts`, `webhook-processor.ts` (currently unbounded) | S | H |
| `WorkflowFailureAlert` queue: subscribe to `failed` events across all queues → Slack/PagerDuty; mirror `document-extract`'s DLQ pattern | M | H |
| Split `document-extract` into its own service replica so OCR spikes don't impact webhook latency | M | M |
| `preStop` hook (30s sleep) for K8s drain before SIGTERM | S | M |

**Score lift:** Containers 58 → 85, Runtime 76 → 90.

### Phase 3 — Security floor to enterprise grade (Weeks 6–8)

| Action | Effort | Impact |
|---|---|---|
| Move MCP `hourly-rate-limit` Map + @fastify/rate-limit to shared Redis backend; per-key sliding window across replicas (`apps/mcp-server/src/plugins/hourly-rate-limit.ts:14`) | S | H |
| Remove `req.auth.role === 'admin'` fallback in `apps/api/src/plugins/rbac.ts:62-64`; backfill admin UserRole rows; gate removal on migration | S | H |
| ClamAV (or hosted scanner like VirusTotal) on `files/finalize`; default `STORAGE_SCAN_REQUIRED=true` in prod; quarantine until scan passes | M | H |
| Sandbox document-extract parsers: run pdf-parse / mammoth / OLE inside `worker_threads` or separate container with `--max-old-space-size` + seccomp; replace `pdf-parse@2.4.5` with `unpdf` or `pdf2json` | M | H |
| AuditLog for auth events (`auth.login`, `auth.login_failed`, `auth.role_change`, `apikey.created`, `apikey.used` sampled, `apikey.revoked`); expose append-only `/audit-logs` org-scoped read view | M | H |
| Drop `redisCachePlugin` or fix orgId source (currently `'anon'` fallback creates latent leak risk) | S | H |
| Fix service worker: never cache `/api/` on shared devices without per-user/org scope; NetworkFirst for `index.html`; use Workbox | M | H |
| Drop `'unsafe-inline'` from style-src CSP | S | M |
| SOC2 Type II readiness assessment | M | M |

**Score lift:** Security 78 → 92.

### Phase 4 — Observability & operations (Weeks 7–9)

| Action | Effort | Impact |
|---|---|---|
| `prom-client` + `/metrics` on api + worker + mcp-server (HTTP duration histogram, queue depth/active/failed gauges, Prisma/Redis pool gauges) | S | H |
| OTel metrics `MetricReader` + Pino → OTLP log transport in `apps/api/src/otel.ts`; replicate in worker + mcp-server | M | H |
| Bull-Board dashboard + `QueueEvents` Pino emitter (completed/failed/stalled with `jobId` + `orgId`); enrich `worker/health` with `getJobCounts` per queue | S | H |
| Commit `monitoring/`: PrometheusRules + Grafana dashboards JSON for: API 5xx burn rate, p95 > 500ms, worker DLQ > N, Redis disconnect, DB pool exhaustion | M | H |
| `docs/runbooks/`: deploy, rollback, restore, failed-job replay, Sentry-to-PagerDuty mapping | M | H |
| Wire Web Vitals + frontend errors to real RUM sink via `Sentry.metrics.distribution()` with `tenantId`/`userId` tags | S | M |

**Score lift:** Monitoring 48 → 88.

### Phase 5 — CRM core depth (Weeks 9–14)

| Action | Effort | Impact |
|---|---|---|
| `Quote` + `QuoteLine` + `QuoteVersion` tables + `quotes.ts` route + UI; states: draft / sent / accepted / expired; e-sign integration optional; wire `Opportunity → Quote → SalesOrder` | L | H |
| Promote `PipelineStage` from Postgres enum to tenant-scoped table `{id, key, name, order, probability, isClosed, isWon, color, processId}`; migrate `OrgSettings.pipelineStages` JSON; remove `OpportunityStage` enum | L | H |
| `OpportunityStageHistory` + `LossReason` + `Competitor` tables; add `closeDate`, `expectedRevenueMicros`, `nextStep`, `nextStepDueDate`, `lossReasonId`, `competitorId` to `Opportunity`; backfill stage history from audit log | M | H |
| `Contract`, `PriceBook`, `PriceBookEntry`, `Campaign`, `CampaignMember` | L | M |
| `Company.parentCompanyId` + recursive org tree + `GET /api/companies/:id/tree` + breadcrumb UI | S | H |
| Split `Contact` model: `firstName` / `lastName` / `title` / `preferredChannel` / address JSON; add `tags`, `timeZone`, `linkedinUrl` | M | H |
| GDPR consent fields on Lead + Contact: `marketingOptIn`, `doNotContact`, `consentDate`, `lawfulBasis`, `dataRetentionUntil` | S | H |
| `POST /api/companies/merge` with `pg_trgm` fuzzy duplicate detection; transactional consolidation of Notes/Files/Opps/Contacts | M | H |
| `createdById` + `updatedById` UUID FK to User on every mutable model; backfill from audit log | M | H |
| Migrate `Note.accountId` / `FileAttachment.accountId` / `AccountSolution.accountId` / `AccountProduct.accountId` / `DocumentExtraction.accountId` / `BidDocument.accountId` / `ServiceCase.accountId` from `String @deprecated` to UUID `companyId` FK; drop legacy column | M | M |
| Enable `pgvector`; add `embedding vector(1536)` to `SourceChunk`, `Requirement`, `MemosPolicy`, `Reference`, `AccountSolution` for semantic search | M | H |
| `CompanyDetailPage` expansion: wire Activities, Tasks, Files, Solutions, Products, Insights tabs (data already modeled); fix hardcoded `'CAD'` currency to read org locale | M | M |

**Score lift:** Pipeline 47 → 80, Accounts 52 → 80, Database 78 → 92.

### Phase 6 — Activities, Email, Calendar (Weeks 12–17)

| Action | Effort | Impact |
|---|---|---|
| Real Microsoft Graph: replace `client_id=PLACEHOLDER` (`apps/api/src/routes/microsoft.ts:77-84`) with full OAuth callback → encrypted token vault → BullMQ delta-sync worker → ingest to new `EmailMessage` / `CalendarEvent` tables linked to `Activity` | L | H |
| Parallel Google Workspace integration (Gmail + Calendar) | L | H |
| Cadences: `Cadence` / `CadenceStep` / `CadenceEnrollment` schema + step-runner BullMQ worker (email/task/call steps with delays + reply-pause) + enroll-from-list UI | L | H |
| Notification engine: `Notification` table; `task.due` / `mention` / `activity.reminder` producers; fan-out to in-app bell + email digest + web-push (VAPID); persist `NotificationPrefs` to `User` + `OrgSettings` (currently localStorage only) | M | H |
| Promote `Task`: add `priority`, `description`, polymorphic `entityType`/`entityId`, `reminderAt`, `recurrenceRrule`, `parentTaskId`, `tags`, server-side `sortOrder`; migrate `apps/web/src/stores/taskOrder.ts` from localStorage to server | M | M |
| `CallLog` model + Twilio/Aircall webhook receiver | M | M |
| Calendly-style public booking page on top of `CalendarEvent` slots | M | M |

**Score lift:** Activities 38 → 80.

### Phase 7 — Automation engine (Weeks 16–21)

| Action | Effort | Impact |
|---|---|---|
| **Trigger event bus**: Prisma middleware or service-layer hooks emit `record_created` / `record_updated` / `stage_changed` events for Opportunity stage, Lead created, Account updated → enqueue `workflow-execute` BullMQ jobs | L | H |
| `startWorkflowRunner()` in worker; consume `workflow-execute` queue | M | H |
| **Replace `executeAction` stubs** in `apps/api/src/routes/workflows.ts:342-385` with real strategy registry: HTTP webhook with retries, transactional email via SES/Resend, Slack via `@slack/web-api`, dynamic Prisma field-update, owner assignment, Dust agent run, notification insert | L | H |
| `ApprovalChain` + `ApprovalStep` (sequential / parallel / quorum N-of-M / escalation timeout / delegate-on-OOO); `POST /approval-gates/:id/decide` with audit + notifications | M | H |
| Activate `LeadRoutingRule` on `POST /api/leads` (currently zero callers) | M | M |
| No-code workflow builder UI: trigger picker → JSON-Logic condition tree → drag-drop action list + test-run + run-history drawer (replace 75-line read-only `WorkflowsPage.tsx`) | L | H |

**Score lift:** Workflows 22 → 80.

### Phase 8 — Reporting & analytics (Weeks 18–22)

| Action | Effort | Impact |
|---|---|---|
| Add `requirePermission('reports:read')` to all `/api/reports/*` and `/api/sales-dashboard/*`; introduce manager/rep scoping (`ownerId: req.auth.userId` when role ≠ admin) | S | H |
| CSV + Excel export on every report/dashboard page (currently 0 of them); add `@e965/xlsx` to apps/web for `.xlsx` multi-sheet | S | H |
| Drillthrough on every chart element: stage bars, leaderboard rows, country tiles, monthly chart points, funnel stages → navigate to filtered list views | M | H |
| `ReportSubscription` model + `report-digest` BullMQ queue (cron via `repeat: { pattern }`) + email/Slack delivery of CSV/PDF snapshots | L | H |
| Server-persist `SavedView` per surface; share across users in org | M | M |
| Real report builder: drop `DashboardWidget @@unique [orgId, kind]`, add grid layout (`react-grid-layout`), field picker over a JSON metric registry | L | H |

**Score lift:** Reporting 51 → 85.

### Phase 9 — Integration platform (Weeks 21–27)

| Action | Effort | Impact |
|---|---|---|
| Outbound webhook delivery worker: `WebhookDelivery` table (status, attempts, nextRetryAt, responseCode), HMAC `X-BidStack-Signature`, exponential backoff, per-subscription circuit-breaker | M | H |
| `@fastify/swagger` + `swagger-ui` over existing Zod schemas → `/api/openapi.json` + `/api/docs`; gate CI on schema diff; autogen JS + Python SDKs via `openapi-generator` | M | H |
| Extend API key auth to gate REST routes (not just MCP): `Bearer bidstack_*` with granular scopes (`opportunities:read`, `contacts:write`, etc.) — unlocks Zapier/n8n/Make | S | H |
| Bulk + composite APIs: `POST /api/v1/composite` (ordered sub-requests with referenced IDs, Salesforce-style), `POST /api/v1/{resource}/bulk` returning `202` + job id, `GET /api/v1/jobs/{id}` for status | L | H |
| OAuth2 authorization-server role: use bundled `@modelcontextprotocol/sdk` OAuth handlers → `/oauth/authorize`, `/oauth/token`, `/.well-known/oauth-authorization-server` | L | M |
| Real Plugin manifest validator (replace hardcoded fake in `apps/api/src/routes/plugins.ts:68-73`); `IntegrationRegistry` marketplace route; finish Salesforce + Microsoft `sync()` methods; add HubSpot + Slack + Gmail connectors | L | H |
| RFC 7807 Problem envelope across `error-handler.ts` + every `httpErrors.*` call (add `type`, `title`, `status`, `detail`, `instance`, `traceId`) | S | M |
| Real versioning: `/api/v2` namespace + `Sunset` / `Deprecation` / `Link rel="deprecation"` headers; remove dead `apiVersioningPlugin` negotiation or wire it | S | M |

**Score lift:** Integrations 38 → 80, Networking 64 → 85.

### Phase 10 — Frontend depth (Weeks 24–28)

| Action | Effort | Impact |
|---|---|---|
| `@tanstack/react-virtual` on Opportunities (currently `limit: 100` no virtualization), Tasks (756-line page), Companies, and kanban columns | S | H |
| Lift route table from `App.tsx:181-456` into `routes.ts` config; split files >500 lines: `OpportunitiesPage.tsx` (942), `TasksPage.tsx` (756), `CommandPalette.tsx` (625), `App.tsx` (530), `CompaniesPage.tsx` (533), `AccountsPage.tsx` (532), `PipelinePage.tsx` (518) | M | H |
| Hydrate `stores/savedViews.ts` to a server table; surface in Topbar/Sidebar; add a Tasks calendar route (FullCalendar) | L | H |
| Odoo-style list-view grouping (group-by field with collapsed totals) | M | M |
| Raise vitest thresholds (70 lines / 60 branches / 70 statements); backfill page tests for the 8 lazy-loaded routes with zero coverage | M | H |
| Add `<link rel="modulepreload">` for first-paint chunks | S | M |
| Remove dead `process.env.NODE_ENV === 'development'` branches (vite hard-defines `'production'`) | S | L |
| Saved-view sharing + favourites per user/org | M | M |

**Score lift:** Frontend 79 → 92.

### Phase 11 — Testing & quality (Weeks 26–28, parallel)

| Action | Effort | Impact |
|---|---|---|
| Hard coverage gate at 75% lines / 70% branches in every workspace (mirrors Salesforce's Apex 75%); backfill `coverage` blocks in api/worker/mcp-server/packages configs; wire `pnpm -r test:coverage` into CI | S | H |
| Per-test transaction isolation: wrap each integration test in `prisma.$transaction(async tx => { ... throw ROLLBACK })` or adopt `@quramy/prisma-fabbrica`; enable `fileParallelism: true` | M | H |
| `packages/test-factories` workspace (Opportunity, Org, User, Document factories); MSW handlers for Dust, Odoo, Apollo clients | M | H |
| Consumer-driven contract tests: emit OpenAPI at build, validate web's React Query hooks against it in CI | L | H |
| ESLint rule or PR-checklist: every test file >5 lines must contain a `// Why:` comment; backfill `Button.test.tsx`, `smoke.spec.ts`, `bid-matrix.spec.ts` first | M | M |

**Score lift:** Testing 62 → 88.

### Phase 12 — i18n & globalization (Weeks 27–30)

| Action | Effort | Impact |
|---|---|---|
| Install `i18next` + `react-i18next`; externalize all hardcoded English strings; ship English + French + Spanish pilot locales; Crowdin/Lokalise pipeline | L | H |
| Make `apps/web/src/lib/format.ts` read user locale + currency from `CurrencyLocaleSection`/preferences slice (today: hardcoded `'en-US'` and `'CAD'`) | S | H |
| RTL support: set `dir` on `<html>` from locale; swap `left-`/`right-`/`ml-`/`mr-` to logical `start-`/`end-`/`ms-`/`me-` (Tailwind 4 logical-property variants); test Arabic | M | M |
| `Accept-Language` middleware on apps/api; localize Zod error messages + MCP tool descriptions | M | M |
| `date-fns` locale imports + `Intl.RelativeTimeFormat` in `relativeTime()` (today: hardcoded `"just now"`, `"5m ago"`) | S | M |
| Add visible-on-focus "Skip to main content" link as first child of `AppShell` (WCAG 2.4.1) | S | M |

**Score lift:** A11y/i18n 71 → 92.

---

## Resource & timeline summary

| Phase | Weeks | Engineers | Lift focus |
|---|---|---|---|
| 0 — Don't lose data | 1–2 | 1–2 | Backups, GDPR export |
| 1 — Production substrate | 3–6 | 2–3 | IaC, secrets, CI, CDN |
| 2 — Container/runtime | 4–6 | 1–2 | Hardening, MCP replicas |
| 3 — Security floor | 6–8 | 1 | RBAC, sandbox, audit |
| 4 — Observability | 7–9 | 1–2 | Metrics, alerts, runbooks |
| 5 — CRM core depth | 9–14 | 2 | Quote, PriceBook, hierarchies, GDPR |
| 6 — Email/Calendar/Cadences | 12–17 | 2–3 | Graph, sequences, notifications |
| 7 — Automation engine | 16–21 | 2–3 | Triggers, executors, builder |
| 8 — Reporting | 18–22 | 2 | RBAC, drillthrough, subscriptions, builder |
| 9 — Integration platform | 21–27 | 2–3 | OpenAPI, SDK, OAuth2, bulk, marketplace |
| 10 — Frontend depth | 24–28 | 2 | Virtualization, saved views, calendar |
| 11 — Testing | 26–28 | 1 | Coverage gate, factories, contracts |
| 12 — i18n | 27–30 | 1–2 | Externalize, RTL, locale-aware formatters |

**Total: ~30 weeks, peak 4–5 engineers.**
**Projected final score: ~85/100 (Salesforce/Odoo parity in the meaningful dimensions; surpasses both in bid-management depth since that's the project's native strength).**

---

## What's already best-in-class — don't regress these

- **Tenant isolation** (`apps/api`: 262 explicit `orgId: req.auth.orgId` filters across 31 route files; `findFirst` not `findUnique({where:{id}})` in production code; `keyBelongsToOrg()` storage scoping; webhook payload-vs-subscription orgId cross-check) — tighter than most Odoo deployments.
- **Idempotency** (`apps/api/src/plugins/idempotency.ts`) — Stripe-grade fingerprinted with Redis NX lock and conflict on body mismatch.
- **Accessibility** (`RouteAnnouncer`, primitive-level ARIA in `Input`/`Dialog`, `prefers-reduced-motion` with `[data-motion='full']` opt-in, focus ring with WCAG 2.4.11 tagging, contrast remediation with inline ratio comments) — Salesforce-parity.
- **Bid-management domain** (`BidDocument`, `Requirement`, `ComplianceMatrixRow`, `ApprovalGate`, `SubmissionPackage`, `BidScore`) — **exceeds Salesforce out-of-box** without AppExchange.
- **Document extraction worker** (`apps/worker/src/queues/document-extract.ts`: 5-min stage timeouts, 30s DB heartbeat lease, stale-job reaper, tenant-scoped updateMany count check) — pattern to replicate across other workers.
- **Idempotent + replay-proof inbound webhooks** (`apps/api/src/routes/webhooks.ts`: HMAC + 5-min replay window + Redis NX dedup + payload-org cross-check).
- **OrgDashboard + SalesDashboardPage** — visually richer than Odoo default, competitive with Salesforce Lightning on insight depth.

---

## Critical-path recommendation

If only **two weeks** of work can be funded before the next enterprise pitch, do Phase 0 + the three Phase 3 HIGH security items + the three Phase 7 "real action executor" + trigger bus items. This closes the three hard blockers without touching IaC or CRM features. Score moves from **55 → ~64** with no new features, but **the three "you'll be sued" risks become "production-grade defaults"**.
