# BidStack 360 Full-Stack Production Reality Audit

Date: 2026-05-22
Repository: `D:\BIDCRM`
Audit standard: Salesforce, Odoo, Twenty, Apple HIG, Fortune 10 SaaS readiness
Disposition: BLOCK
Overall score: 57 / 100

## Assumptions

- This score measures the current repository state, not the ambition or roadmap.
- External infrastructure does not count unless the repository configures or documents it.
- The worktree is very dirty, so this audit rates the current local tree and flags release hygiene as a blocker.
- Prior sub-agent findings are used as evidence, but final scoring is normalized by current local gates run on 2026-05-22.

## Executive Summary

BidStack 360 has a serious product surface: web app, API, worker, MCP server, CRM objects, sales/orders/invoices/products, reports, service desk, workflows, integrations, audit log, document/RFP agent direction, and a modern React shell. It is much more than a "frontend plus backend" prototype.

It is not production-ready against Salesforce, Odoo, or Twenty standards. The blockers are not cosmetic. They sit in tenant isolation, RLS, cross-tenant FK validation, MCP auth/rate limiting, production storage, Docker/ingress wiring, dependency security, e2e stability, CI orchestration, observability gaps, and disaster recovery.

The product can become differentiated because the RFP/Bid/Presales workflow is sharper than a generic CRM. The current repo, however, is closer to an ambitious enterprise prototype than a sellable Fortune 10-grade CRM.

## 100-Point Release Rubric

| Area | Score | Notes |
|---|---:|---|
| Functional product | 15 / 25 | Wide CRM surface, but e2e fails 34 of 72, command palette and several core flows regress, and Salesforce/Odoo/Twenty parity is incomplete. |
| Code quality | 16 / 25 | Unit tests and most package typechecks pass, but root typecheck fails on Prisma generate file locking, MCP lint fails, and the worktree has hundreds of changes. |
| Design and UX | 15 / 25 | Strong shell primitives and Apple-style direction exist, but core tables, saved views, command palette, accessibility, and route consistency are not yet enterprise reliable. |
| Infrastructure and security | 11 / 25 | Docker/CI/health/Sentry/OTEL started, but no DB RLS, incomplete RBAC, high dependency advisory, broken production ingress/storage, and no DR story. |
| Total | 57 / 100 | BLOCK. Target for release is at least 95 / 100 per project rules. |

## Current Quality Gates

| Gate | Result | Evidence |
|---|---|---|
| `pnpm --filter @bidstack/web typecheck` | PASS | Individual web TypeScript check passed. |
| `pnpm --filter @bidstack/mcp-server typecheck` | PASS | Individual MCP TypeScript check passed. |
| `pnpm typecheck` | FAIL | Prisma generate failed with `EPERM` renaming `query_engine-windows.dll.node`, likely a locked generated client file. |
| `pnpm --filter @bidstack/web lint` | PASS | Web lint passed. |
| `pnpm --filter @bidstack/api lint` | PASS | API lint passed. |
| `pnpm --filter @bidstack/mcp-server lint` | FAIL | 4 `no-explicit-any` lint errors in `apps/mcp-server/src/server.ts` and `apps/mcp-server/src/tools/crm-tools.ts`. |
| `pnpm -r --stream test` | PASS | API 197 passed / 1 skipped, web 31 passed, MCP 21 passed, worker 15 passed, package tests passed. Worker emitted `ioredis` closed connection stderr. |
| `pnpm --filter @bidstack/web build` | PASS | Production web build passed. Largest non-react chunks: motion 177.71 kB, index 167.00 kB. |
| `pnpm audit --audit-level high` | FAIL | High advisory `GHSA-qjx8-664m-686j`, `js-cookie <=3.0.5`, through Clerk packages in API and web. |
| `pnpm e2e` | FAIL | 36 passed, 34 failed, 2 skipped. Early failures include API preflight not reachable; later failures include opportunities, pipeline, and command palette regressions. |

## Competitor Baseline

Sources checked on 2026-05-22:

- Salesforce Sales Cloud: https://www.salesforce.com/sales/cloud/
- Salesforce Sales Cloud guide: https://www.salesforce.com/sales/cloud/guide/
- Salesforce AI for Sales: https://www.salesforce.com/sales/ai
- Odoo CRM docs: https://www.odoo.com/documentation/18.0/applications/sales/crm.html
- Odoo Sales features: https://www.odoo.com/app/sales-features
- Odoo lead scoring: https://www.odoo.com/documentation/18.0/applications/sales/crm/track_leads/lead_scoring.html
- Odoo quotations from CRM: https://www.odoo.com/documentation/18.0/applications/sales/crm/acquire_leads/send_quotes.html
- Twenty key features: https://docs.twenty.com/getting-started/key-features
- Twenty workflows: https://docs.twenty.com/getting-started/core-concepts/workflows
- Twenty API docs: https://docs.twenty.com/developers/api-and-webhooks/api
- Twenty AI docs: https://docs.twenty.com/getting-started/core-concepts/ai

### Salesforce Gap

Salesforce leads on enterprise reliability, sales process automation, quoting, forecasting, workflow approvals, AI assistants, reporting, territory management, permission depth, mobile, ecosystem, compliance, and operational maturity. BidStack has early versions of many modules but lacks the hardened permission model, workflow depth, forecasting discipline, marketplace breadth, compliance posture, and production architecture.

### Odoo Gap

Odoo leads on quote-to-cash continuity, CRM-to-sales-to-invoice flow, ERP adjacency, lead mining, predictive scoring, pipeline analysis, inventory/product coupling, and broad business apps. BidStack has sales orders, invoices, products, CRM routes, and Odoo integration intent, but the production quote/order/invoice flow and integration isolation are not mature enough.

### Twenty Gap

Twenty is the closest architectural peer: modern CRM, custom objects, custom fields, views, workflows, webhooks, API, AI, permissions, and MCP. BidStack has a bid/presales niche and richer RFP ambition, but it trails Twenty on polished extensibility, custom data modeling consistency, native API/MCP posture, workflow UX, and row-level permission readiness.

## Production Layer Scorecard

| Layer from image | Score | Release status |
|---|---:|---|
| Frontend | 68 / 100 | BLOCK |
| APIs and backend logic | 68 / 100 | BLOCK |
| Database and storage | 66 / 100 | BLOCK |
| Auth and permissions | 66 / 100 | BLOCK |
| Hosting and deployment | 46 / 100 | BLOCK |
| Cloud and compute | 61 / 100 | BLOCK |
| CI/CD and version control | 62 / 100 | BLOCK |
| Security and RLS | 46 / 100 | BLOCK |
| Rate limiting | 62 / 100 | BLOCK |
| Caching and CDN | 58 / 100 | BLOCK |
| Load balancing and scaling | 58 / 100 | BLOCK |
| Error tracking and logs | 58 / 100 | BLOCK |
| Availability and recovery | 42 / 100 | BLOCK |

## 1. Frontend

Score: 68 / 100

Strengths:

- Broad CRM surface: dashboard, accounts, companies, opportunities, pipeline, contacts, tasks, reports, invoices, products, admin, workflows, territories, agents, intake.
- Mature shell primitives: error boundary, suspense, command palette, quick add, help drawer, toasts, confirm host, live announcer.
- Good design foundations: dark mode tokens, focus-visible patterns, skip/main focus, reduced-motion handling.
- Sensible state split: React Query for server state, Zustand for UI/local preferences.
- Production build passes and chunking is controlled.

Critical problems:

- E2E fails 34 / 72. This is the product truth from a user-flow perspective.
- Command palette search does not navigate reliably.
- Opportunities and pipeline specs drift from the current stage model.
- Several route surfaces fail when API preflight is not healthy.
- Saved views are mostly local-only and not durable/shareable across CRM objects.
- Global search and notification panels have accessibility gaps.
- Admin-only routes can still be exposed in navigation/search surfaces.

Fix plan:

1. Repair E2E orchestration first so a failed API preflight cannot create noisy partial results.
2. Fix command palette filtering/selection and add tests for exact typed route navigation.
3. Align opportunities/pipeline UI contracts with canonical bid stages.
4. Centralize route metadata: label, path, icon, role, command visibility, sidebar visibility.
5. Promote saved views to API-backed entities with shared/team/private scope.
6. Add axe coverage for dashboard, accounts, opportunities, pipeline, settings, and agents.

Definition of done:

- `pnpm e2e` passes 72 / 72 locally and in CI.
- No admin route is discoverable by a non-admin user.
- Command palette passes keyboard-only navigation, filtering, and route assertions.
- Core CRM lists support server pagination, stable sorting, saved views, empty/error/loading states, and 44px touch targets.

## 2. APIs and Backend Logic

Score: 68 / 100

Strengths:

- Fastify setup is centralized.
- Zod validation is common.
- Auth is registered before routes.
- Helmet, CORS, rate limiting, request IDs, error handling, and webhook HMAC exist.
- Many CRUD routes include `orgId` scoping.
- API unit/integration tests are substantial: 197 passed / 1 skipped.

Critical problems:

- Several mutations trust related IDs without proving same-org ownership: proposals, territories, opportunities, invoices, workflows, activities, leads, service desk.
- Idempotency is keyed by user/key only, not method/path/body hash.
- Audit logging is incomplete across mutating routes.
- Odoo integration is global rather than org-owned.
- API version parser previously had drift risk.
- Fat controllers remain in several domains.

Fix plan:

1. Add a shared tenant FK validator for all supplied IDs before create/update.
2. Add cross-tenant negative tests for every mutation that accepts a foreign key.
3. Rework idempotency to fingerprint method, path, and body hash; return 409 on mismatch.
4. Wrap all security/config/business mutations in transactions that write `audit_log`.
5. Move Odoo config into org-scoped `IntegrationConfig`.
6. Extract fat controllers into service modules with route-level orchestration only.

Definition of done:

- Every route with a related ID has an adjacent cross-tenant regression test.
- Mutation audit coverage is enforced by tests.
- Idempotency cannot replay a response from a different route/body.
- Odoo, Dust, Microsoft, MCP, and webhooks are all org-owned and revocable.

## 3. Database and Storage

Score: 66 / 100

Strengths:

- Prisma schema is broad and validates.
- Most tenant data has `orgId` and useful org-prefixed indexes.
- PostgreSQL extensions are declared: `citext`, `pg_trgm`, `pgcrypto`.
- Upload schemas enforce allow-list and 50 MB cap.
- Local storage has path traversal defense.
- API keys are hashed and secrets returned once.

Critical problems:

- No database-level RLS.
- No composite tenant FKs for many relationships.
- S3 key ownership validation is broken: generated keys use `orgs/<orgId>/...`, finalization expects raw org id first.
- Production storage defaults to local disk; prod compose uses two API replicas.
- Finalize trusts client `bytes`, `contentType`, and `storageKey` too much.
- OCR/document extraction can happen in API request path.
- `DocumentExtraction.documentId` is not FK-linked to the actual stored artifact.
- Integration credentials are JSON with comments about encryption but no enforced encryption at rest.
- A stray root `packages/db/migration.sql` contains destructive drops outside Prisma migrations.

Fix plan:

1. Fix storage key ownership with one shared helper and S3/local tests.
2. Fail production startup unless durable object storage or a shared persistent volume is configured.
3. On finalize, HEAD/stat object, compare size/type, calculate checksum/ETag, and require scan status.
4. Move conversion/OCR to workers and store extraction/version/source chunk records.
5. Add document/version/source-chunk/requirement/compliance entities for RFP workflows.
6. Implement credential envelope encryption with KMS or a local dev key provider.
7. Remove or quarantine destructive SQL drafts from repo root.

Definition of done:

- Production storage is S3/R2-compatible, durable, and tested.
- File finalize cannot create DB rows for missing, wrong-size, wrong-type, or unscanned objects.
- RFP document provenance has real FKs and version locking.
- Credentials are encrypted at rest and redacted from all API responses and logs.

## 4. Auth and Permissions

Score: 66 / 100

Strengths:

- Clerk production guard exists.
- Stub auth is limited to dev/test server-side.
- API keys are hashed.
- Audit-log reads are admin gated.
- Auth context carries org/user/role.

Critical problems:

- RBAC is role-string based, while Role/Permission/UserRole tables are not actually enforced.
- MCP API keys require `mcp` only; read/write scopes are not enforced per tool.
- MCP message POST is not re-authenticated.
- Local role edits can be overwritten by Clerk login sync.
- Privilege changes are not consistently audited.
- Frontend can fall back to admin stub if public Clerk config is absent in a production web build.

Fix plan:

1. Pick role source of truth: Clerk-managed roles or app-managed roles.
2. Add `requirePermission` and route policies from seeded permissions.
3. Enforce MCP scopes by tool: read tools need `read`, write tools need `write`.
4. Bind MCP sessions to key id and require Authorization on message POST.
5. Audit every role/user/permission mutation with old and new values.
6. Fail web production builds when Clerk publishable key is missing.

Definition of done:

- Permission matrix covers admin, sales, presales, finance, manager, executive, service desk, read-only, and external partner.
- UI route visibility, API route authorization, and MCP tool access use the same policy source.
- Privilege changes are auditable and test-covered.

## 5. Hosting and Deployment

Score: 46 / 100

Strengths:

- Multi-stage Dockerfile exists.
- Prod compose exists.
- `.dockerignore` excludes env files.
- CI has unit, integration, and e2e job structure.
- API has boot validation and graceful shutdown.

Critical problems:

- Docker dependency-layer copy list is stale and omits packages now used by API.
- Prod web image has no path for required `VITE_*` public config.
- Nginx serves `/api` as SPA HTML; no reverse proxy for API or webhooks.
- Prod API compose omits required env like `PUBLIC_BASE_URL`.
- MCP port is inconsistent across app default, Docker, compose, and docs.
- API health returns HTTP 200 even when dependencies are down.
- S3 storage is advertised but not production-deployable.
- Local compose ports disagree with `.env.example`.
- Worker logs raw Redis URL.

Fix plan:

1. Replace ad hoc Docker package copying with `pnpm deploy` or complete runtime package manifests.
2. Add runtime or build-time web public env injection and fail closed when absent.
3. Add reverse proxy rules for `/api`, `/webhooks`, and MCP, or document external ingress.
4. Complete prod env contract with `${VAR:?message}`.
5. Standardize MCP port and route contract.
6. Split `/livez` and `/readyz`; Docker/LB must use readiness.
7. Add production S3/R2 dependency and env requirements.

Definition of done:

- `docker compose -f docker-compose.prod.yml build` succeeds from clean clone.
- Web container can reach API through the documented path.
- API will not boot in production with missing required env/storage/auth config.
- Readiness fails non-2xx when DB or Redis is unavailable.

## 6. Cloud and Compute

Score: 61 / 100

Strengths:

- API, worker, MCP, and web are separate deployable units.
- BullMQ queues and shared queue config exist.
- Worker has graceful shutdown.
- Upload architecture is close to S3-ready direct upload.
- Webhook receiver persists events quickly.

Critical problems:

- CPU-heavy parsing/OCR can run in API request path.
- Queue enqueue failure is not surfaced safely.
- Queue health schema/UI exist, but no real producer updates actual queue metrics.
- Worker has no health/readiness endpoint.
- Agent runs are synchronous API work; `scheduleCron` is stored but not scheduled.
- Dust polling is full-scan and serial.

Fix plan:

1. Move all file read, parse, OCR, and agent-heavy work to workers.
2. Disable producer offline queue in request paths and use short timeouts.
3. Persist job status transitions: pending, queued, running, succeeded, failed, retrying.
4. Add BullMQ health collector using `getJobCounts()` for actual queues.
5. Add worker health endpoint or heartbeat record.
6. Implement agent scheduler/queue with timeout, retry, cancellation, and audit.
7. Replace Dust full scan with cursor/delta sync and checkpoints.

Definition of done:

- API request path never performs OCR or long-running LLM work.
- Queue failures produce visible user/API state, not silent pending rows.
- Dashboard queue health reflects real BullMQ state.

## 7. CI/CD and Version Control

Score: 62 / 100

Strengths:

- CI has unit, integration, e2e, audit, typecheck, lint, test, build, and bundle guard.
- PR integration job uses Postgres and Redis.
- Lockfile install is frozen.
- Playwright report uploads on failure.

Critical problems:

- Current `pnpm audit --audit-level high` fails.
- Current MCP lint fails.
- Root typecheck can fail on Prisma generated DLL lock.
- E2E orchestration uses Windows-only `cmd /c` while CI runs Linux.
- E2E config references `pnpm preview`, but root has no `preview` script.
- Worktree is not release-safe: hundreds of modified/untracked files, including migrations and generated artifacts.
- Husky pre-commit calls `lint-staged`, but no lint-staged config was found.
- Runtime policy is inconsistent: AGENTS says Node 24/pnpm 10, package engines allow Node >=20/pnpm >=9.

Fix plan:

1. Fix dependency advisory or add a temporary documented override only if no patched path exists.
2. Fix MCP lint errors without weakening lint rules.
3. Make Prisma generate safe on Windows dev machines: stop running while processes hold the DLL, generate to temp, or document kill/retry flow.
4. Make Playwright webServer cross-platform and add a real preview script.
5. Split worktree into reviewable branches; remove generated screenshots/worktrees from source changes.
6. Add lint-staged config or remove hook call.
7. Add CI secret scanning and CodeQL/OSV/Dependabot.
8. Tighten engines to Node 24 and pnpm 10 with `engine-strict`.

Definition of done:

- Clean clone CI passes unit, integration, e2e, audit, typecheck, lint, test, build.
- Branch protection requires every gate.
- No generated local artifacts, modified old migrations, or secrets are present.

## 8. Security and RLS

Score: 46 / 100

Strengths:

- Clerk guard and org requirement exist.
- Many reads are org-scoped.
- HMAC webhooks include timestamp and dedup.
- Logs redact common auth fields.
- `.env` is ignored.

Critical problems:

- No PostgreSQL RLS.
- A missed `orgId` filter can cross tenants.
- Multiple mutation routes accept cross-tenant foreign IDs.
- Odoo integration is global across orgs.
- MCP message POST trusts session id.
- Dust webhook org resolution can use deleted subscriptions and does not verify payload metadata org.
- Webhook PATCH skips create-time SSRF validation.
- S3 read can buffer unbounded object body.
- High `js-cookie` advisory via Clerk packages.

Fix plan:

1. Add RLS policies for every tenant table and set `app.current_org_id` per request/transaction.
2. Add Prisma helpers that fail closed if tenant context is missing.
3. Validate every incoming FK by `{ id, orgId }`.
4. Add composite tenant constraints where practical.
5. Harden MCP auth/rate/session model.
6. Harden webhooks: active subscription only, org metadata check, PATCH URL validation.
7. Fix dependency advisory by upgrading Clerk/js-cookie path or patched override.
8. Add security regression tests for cross-tenant writes and reads.

Definition of done:

- Attempted cross-tenant reads/writes fail at app and DB layers.
- Security test suite covers every mutation with foreign IDs.
- No high/critical dependency audit findings remain.

## 9. Rate Limiting

Score: 62 / 100

Strengths:

- API global rate limit exists at 600/min.
- Sensitive Dust routes and webhooks have tighter caps.
- Dust webhook has HMAC, timestamp, Redis dedup.
- Dust/Odoo clients retry 429/5xx with backoff.

Critical problems:

- API rate limit store is process-local.
- MCP hourly limiter checks `/mcp`, but actual routes are `/mcp/sse` and `/mcp/messages`.
- MCP message ingestion is not authenticated per request.
- API keys have scopes but no quotas or usage budgets.
- Idempotency can replay wrong mutation.
- Odoo endpoints rely mostly on broad global limit and share one global backend.

Fix plan:

1. Move API and MCP rate limits to Redis counters.
2. Key limits by org, user, IP, API key, route, and expensive-operation class.
3. Fix MCP limiter to cover real endpoints.
4. Add API key quotas: per-minute, per-day, per-month, and cost units.
5. Add per-route limits for Odoo, Dust, file, agent, and webhook paths.

Definition of done:

- A second API replica does not double effective limits.
- No single tenant can starve global Odoo/Dust/LLM resources.
- API key usage is visible, revocable, and quota-bound.

## 10. Caching and CDN

Score: 58 / 100

Strengths:

- React Query has global stale time, retries, and abort-aware fetch wrapper.
- Some domain hooks set report/provider-specific freshness.
- Vite chunks are split and Nginx marks `/assets/` immutable.
- Redis is used for idempotency and webhook dedup.

Critical problems:

- API does not set safe default cache headers for authenticated JSON.
- Report/dashboard endpoints recompute heavy snapshots on every request.
- Global `refetchOnWindowFocus` is disabled, so stale data can persist in open tabs.
- Pipeline/report invalidation keys drift.
- SPA shell has no explicit no-cache policy.
- Idempotency memory fallback is unbounded for 24h when Redis is down.

Fix plan:

1. Add a Fastify cache-policy plugin: authenticated JSON `private, no-store` by default.
2. Add explicit public cache headers only for safe public/static endpoints.
3. Add Redis materialized caches for dashboards and reports with org-scoped keys.
4. Consolidate React Query keys into constants.
5. Add invalidation on mutations, webhooks, and worker completion.
6. Configure CDN policy: `index.html` no-cache; hashed assets immutable.

Definition of done:

- No tenant data is accidentally cacheable by shared CDN.
- Dashboard/report p95 response time is stable under repeated loads.
- Mutations invalidate the exact query keys used by UI surfaces.

## 11. Load Balancing and Scaling

Score: 58 / 100

Strengths:

- API is mostly stateless.
- BullMQ/Redis provides baseline async processing.
- Prisma singleton avoids per-request client creation.
- DB has many org-scoped indexes.

Critical problems:

- MCP/SSE sessions are process-local and cannot horizontally scale without sticky sessions or shared session state.
- MCP route/docs/deploy contract is inconsistent.
- Production local file storage is incompatible with multi-replica API.
- No DB pooler or explicit connection budget.
- Health checks are liveness-shaped, not readiness-safe.
- Rate limits multiply per replica.
- Some report/account data paths read too much into Node.

Fix plan:

1. Decide MCP transport: standard streamable HTTP or SSE with sticky/shared sessions.
2. Use object storage for files.
3. Add PgBouncer/managed pooling and set per-service connection limits.
4. Rewrite high-volume reports with DB aggregation/materialized summaries.
5. Add load tests for 5,000 users and large tenant data.

Definition of done:

- API, worker, and MCP can scale horizontally without breaking files, rate limits, or sessions.
- 5,000-user load test meets p95 latency, error rate, and DB connection budgets.

## 12. Error Tracking and Logs

Score: 58 / 100

Strengths:

- API Pino has request IDs and redaction.
- API Sentry/OTEL boot hooks exist.
- Frontend Sentry and error boundary exist.
- Webhook ingestion persists forensic sync events.
- Audit/sync tables have useful indexes.

Critical problems:

- Handled API errors are not captured to Sentry in the central error handler.
- `/health` can report dependency failure while Docker marks healthy.
- Worker and MCP lack Sentry/OTEL and redaction parity.
- Worker logs raw Redis URL.
- Web Vitals are console logging, not production RUM.
- Frontend request IDs are not propagated into ApiError.
- Provider/queue health UI has no real writers.
- Audit-log coverage is incomplete.

Fix plan:

1. Capture exceptions in Fastify error handler with request/org/user/route tags.
2. Add shared Pino config/redaction for API, worker, MCP.
3. Add worker/MCP Sentry and OTEL.
4. Add frontend request ID generation and response request ID capture.
5. Ship Web Vitals to telemetry, not console.
6. Add queue/provider health writers and alerts.
7. Add audit-write tests for each mutation.

Definition of done:

- Any 500 has a Sentry event with request id and tenant context.
- Any user-visible API error can be traced to server logs.
- Queue failures alert with job id, org id, and error class.

## 13. Availability and Recovery

Score: 42 / 100

Strengths:

- API and worker have graceful shutdown paths.
- Docker healthchecks exist for API/web and Postgres/Redis in compose.
- Database migrations and seed scripts exist.
- Webhook events are persisted before worker processing.

Critical problems:

- No documented backup/restore strategy.
- No restore drill.
- No RPO/RTO target.
- No multi-region or failover plan.
- No durable storage requirement in production.
- No readiness endpoint that fails closed on dependency outage.
- No migration rollback strategy.
- No incident runbook.
- No data retention/legal hold policy for CRM and RFP documents.
- No explicit behavior for degraded external dependencies such as Dust, Odoo, Claude, Microsoft, Sentry, or object storage.

Fix plan:

1. Define RPO/RTO by data class: CRM records, documents, audit logs, exports, agent runs.
2. Add automated Postgres backups with PITR and monthly restore drills.
3. Add object storage versioning, lifecycle, retention, and restore checks.
4. Add `/livez` and `/readyz` and wire LB health to readiness.
5. Add migration release/rollback runbook.
6. Add external dependency degradation modes and user-facing banners.
7. Add incident runbooks for DB down, Redis down, object storage down, queue jam, webhook flood, bad migration, and auth outage.

Definition of done:

- A clean restore into a staging environment is proven from backups.
- RPO/RTO are documented and tested.
- Readiness removes unhealthy instances from service.
- Incident responders have runbooks and dashboards.

## Cross-Section Findings

### Naming and Navigation

The app has too many top-level CRM sections without a fully coherent information architecture. Salesforce/Odoo/Twenty-class products reduce cognitive load by grouping work around jobs:

- Sell: Leads, Accounts, Contacts, Opportunities, Pipeline, Quotes.
- Deliver bid: Bid Workspace, Documents, Compliance Matrix, Proposals, Tasks.
- Operate: Products, Orders, Invoices, Service Desk.
- Automate: Workflows, Agents, Integrations, MCP/API keys.
- Manage: Reports, Audit Log, Settings.

### Data Architecture

The ideal enterprise relationship chain should be enforced:

- Lead -> Opportunity -> Quote -> Order -> Invoice -> Payment.
- Company -> Account -> Contacts -> Activities.
- Opportunity -> Bid Workspace -> Documents -> Requirements -> Compliance Matrix -> Proposal Sections -> Approvals.
- Tasks -> Workflows -> Agents -> Audit Log.

Today, many of these relationships exist as partial tables or loose IDs, but the DB does not consistently enforce tenant-safe relationships.

### Permission Model

Required roles:

- Admin: configure org, integrations, users, permissions, audit, exports.
- Sales: leads, accounts, opportunities, activities, quotes.
- Presales: bid workspace, requirements, response sections, tasks.
- Finance: products, quotes, orders, invoices, payments, margin.
- Manager: team views, approvals, forecasts, reports.
- Executive: read-only dashboards, forecasts, strategic accounts.
- Service Desk: cases, SLAs, customer issues.
- Read-only: view assigned data only.
- External Partner: scoped documents/tasks/comments only.

Required controls:

- Object permission: view/create/edit/delete/export.
- Record-level sharing.
- Field-level security.
- Action permissions: approve, submit, assign, run agent, configure integration.
- MCP/API key scopes tied to same permission engine.

### RFP and Proposal Automation

The RFP direction is correct, but it must be hardened:

- Open-source OCR stack: native parsers first, OCRmyPDF/Tesseract for scans, Docling for layout/table extraction, optional Tika for long-tail formats.
- Document workspace: upload, versioning, extraction status, OCR confidence, source chunks, citations.
- Compliance matrix: atomic requirements, source page/section, owner, status, risk, due date, confidence.
- Agents: intake, deep read, compliance, legal, security, sales strategy, pricing, chief of staff, proposal draft, submission QA.
- Claude/Dust integration: agents are configurable records; API keys stay server-side; outputs are structured and auditable.
- Guardrails: agents recommend, humans approve; no silent canonical mutations; every claim must cite source evidence.

## Prioritized Remediation Roadmap

### P0 - 48 to 72 hours: Stop the bleeding

1. Fix `pnpm audit --audit-level high` by upgrading Clerk/js-cookie path or adding a documented patched override.
2. Fix MCP lint errors.
3. Fix root `pnpm typecheck` Prisma generate lock workflow.
4. Fix E2E orchestration so API/web servers start cross-platform and fail once, cleanly.
5. Fix command palette navigation regressions.
6. Fix opportunities/pipeline E2E stage contract.
7. Freeze production claims until e2e is green.
8. Clean worktree into reviewable branches and quarantine generated artifacts.

Exit criteria:

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm e2e`, `pnpm audit --audit-level high`, and `pnpm --filter @bidstack/web build` all pass from clean checkout.

### P1 - Week 1 to 2: Tenant security and deployability

1. Add shared tenant FK validation helpers.
2. Patch all cross-tenant mutation gaps.
3. Add cross-tenant regression tests for proposals, opportunities, invoices, workflows, activities, territories, leads, service desk.
4. Harden MCP auth/session/scopes/rate limiting.
5. Fix production Docker packaging, web env injection, API env contract, Nginx ingress, MCP port.
6. Fail production startup on local storage.
7. Add readiness endpoints and health semantics.

Exit criteria:

- No known cross-tenant write path remains.
- Production compose build/start works with documented env.
- Readiness fails when DB/Redis are down.

### P2 - Week 2 to 6: Enterprise CRM parity core

1. Implement real RBAC/permission matrix.
2. Add durable saved views and table personalization across core objects.
3. Add server pagination, totals, stable sort, and virtualization for high-volume lists.
4. Complete lead -> opportunity -> quote -> order -> invoice path.
5. Add forecasting, territory, and activity capture depth.
6. Add report/dashboard materialized caches.
7. Add audit coverage for all mutations.

Exit criteria:

- A sales manager can run the full sales cycle with permissions and reports.
- 100k-record tenant list views remain performant.
- Audit log is complete enough for incident review.

### P3 - Week 4 to 10: RFP/Bid Workspace differentiation

1. Move OCR/conversion fully to workers.
2. Add BidDocument, DocumentVersion, SourceChunk, Requirement, ComplianceMatrixRow, ReviewIssue, ApprovalGate, SubmissionPackage.
3. Build document workspace UI with viewer plus extracted requirements.
4. Build configurable agent templates and admin editing.
5. Add citation-required proposal drafting.
6. Add red-flag, legal, security, pricing, and chief-of-staff workflows.
7. Add export/preflight with audit.

Exit criteria:

- A real RFP can be uploaded, OCRed, shredded into cited requirements, assigned, reviewed, drafted, approved, and exported.

### P4 - Week 8 to 16: Fortune 10 operations

1. Add RLS and composite tenant constraints where possible.
2. Add SSO/SAML/SCIM and advanced sharing.
3. Add Redis-backed distributed rate limits and quotas.
4. Add PgBouncer/managed pooling and load tests for 5,000 active users.
5. Add Sentry/OTEL/RUM end to end.
6. Add backup/PITR/object storage versioning/restore drills.
7. Add DR and incident runbooks.
8. Add CodeQL/gitleaks/Dependabot and release image publishing.

Exit criteria:

- Platform scores at least 95 / 100.
- Load, security, backup restore, e2e, and operational drills are proven.

## Quick Wins

1. Add `preview` script and remove Windows-only `cmd /c` from Playwright config.
2. Add `Cache-Control: private, no-store` default for authenticated API JSON.
3. Add `X-Request-Id` propagation in web fetch wrapper.
4. Add `captureException` in API error handler.
5. Fix MCP route/port docs vs implementation.
6. Add lint-staged config or remove the hook call.
7. Add no-cache for SPA shell in Nginx.
8. Replace worker raw Redis URL log with redacted host/db metadata.
9. Add startup guard: production cannot use stub Clerk or local storage.
10. Add cross-tenant tests for the top five FK gaps.

## Critical Blockers

1. E2E failing 34 / 72.
2. Dependency audit high vulnerability via `js-cookie`.
3. No database RLS and multiple cross-tenant FK validation gaps.
4. MCP message POST/session/rate/scope model is unsafe.
5. Production Docker/ingress/env/storage path is broken.
6. Root typecheck can fail on Prisma generated client lock.
7. MCP lint fails.
8. No backup/restore/DR proof.
9. Local storage default conflicts with multi-replica API.
10. Worktree is not releasable in current state.

## Final Definition of Done for "Production Ready"

BidStack 360 is production-ready only when all are true:

- Overall score is at least 95 / 100.
- All quality gates pass from a clean clone.
- E2E covers critical CRM and RFP flows and passes in CI.
- No high or critical dependency advisories.
- DB RLS or equivalent tenant isolation is enforced and tested.
- Every mutation validates tenant ownership of related IDs.
- RBAC is enforced consistently across UI, API, MCP, and agents.
- Production deploy has documented ingress, secrets, storage, readiness, migrations, and rollback.
- Backups and restore drills are proven.
- Load test proves 5,000 active-user readiness.
- Every document/agent/proposal output is source-cited, auditable, and human-approved where required.
- Observability traces user-visible errors from browser to API to worker/job.
- Audit log covers security, admin, data, integration, export, and agent actions.

