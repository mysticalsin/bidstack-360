# BidStack 360 / TOTO360 Deep Audit Rerun

Date: 2026-05-23  
Scope: full `D:\BIDCRM` working tree, current BidStack 360 implementation, and the user's TOTO360/gstack/Dust/MemOS target prompt.  
Mode: read-heavy audit with specialist lanes for backend, security, UX, QA, infra, Dust/MCP, data/RFP/MemOS, and product/GTM.

## Executive Summary

Current BidStack 360 is a serious enterprise prototype, not a production-ready Salesforce/Odoo/Twenty competitor yet.

The previous 57/100 assessment is no longer the right single number. Some foundations improved: typecheck passes, unit/integration tests pass, web build passes, production auth/storage guards exist, MCP is more complete, and the RFP/OCR/MemOS data model is substantial.

However, the fresh rerun found release gates are not green in the current working tree:

- `pnpm lint` fails with 17 errors.
- `pnpm e2e` fails with 9 failures, 3 skipped, 60 passed.
- The working tree has 578 status entries, including generated artifacts, `.github/workflows/ci.yml` changes, a modified existing Prisma init migration, and a stray `packages/db/migration.sql` with destructive drops.
- Browser sweep of the running local app showed route shells loading, but tested core routes did not expose page headings/main content reliably and repeated reduced-motion warnings were emitted.

Production-readiness score: **55/100 - BLOCK**.

TOTO360 master-target readiness score: **42/100 - BLOCK**.

Why the drop from the most optimistic prior checkpoint: the audit rerun changed the evidence. E2E is currently red, lint is red, RFP/MemOS has critical tenant/source-grounding gaps, and security found cross-tenant/write-scope issues that are unacceptable for enterprise CRM data.

## Assumptions

- The current repo stack remains authoritative until an ADR says otherwise: React/Vite/Fastify/Clerk/Prisma/BullMQ/MCP SDK. The master prompt proposes Next.js/NestJS/Keycloak, but that is a migration decision, not an automatic implementation detail.
- Existing generated/untracked files were not deleted or reverted.
- `.env*` files were not read.
- `packages/twenty-bidstack/` and existing Prisma migrations were treated as protected.
- External Dust/gstack/MemOS references are used as reality checks, not as permission to clone or install new systems during this audit.

## Evidence Snapshot

| Gate / Check | Result | Notes |
|---|---:|---|
| `pnpm audit --audit-level high` | Pass | 1 moderate advisory remains. |
| `pnpm typecheck` | Pass | Prisma generation required locked DLL rename workflow. |
| `pnpm test` | Pass | API: 40 files, 223 passed, 1 skipped. Web: 18 files, 59 passed. Worker/MCP/packages pass, but some packages use `passWithNoTests`. |
| `pnpm --filter @bidstack/web build` | Pass | Stub-auth production build succeeds by design for local build command. |
| `pnpm lint` | Fail | `apps/web/public/sw.js` browser globals, unused `providers`, constant truthiness in `cn.test.ts`. |
| `pnpm e2e` | Fail | 9 failed, 3 skipped, 60 passed. Account cockpit, bid matrix, bulk actions, and navigation collapsed-name tests fail. |
| Browser route sweep | Concerning | `/dashboard`, `/accounts`, `/opportunities`, `/pipeline`, `/bid-matrix`, `/intake`, `/integrations`, `/settings` loaded shell/sidebar but no visible heading/main content in snapshot; repeated reduced-motion warnings. |
| Worktree hygiene | Fail | 578 status entries; release candidate cannot be audited as clean. |

## Scorecard

### Current BidStack Production Readiness: 55/100

| Dimension | Score | Rationale |
|---|---:|---|
| Functional CRM | 16/25 | Core modules exist, but E2E regressions block user journeys and flagship RFP workflow is incomplete. |
| Code quality | 15/25 | Typecheck/test pass, but lint fails and route-level business logic/RBAC/audit consistency is uneven. |
| UX/UI | 16/25 | Strong accessibility primitives and command/table work, but nav is overloaded, mobile is not first-class, visual language is split. |
| Infra/security | 8/25 | Production ingress, distributed limits, RLS, worker readiness, and tenant hardening are incomplete. |

### TOTO360 Master-Target Readiness: 42/100

| Target Layer | Score | Rationale |
|---|---:|---|
| gstack process | 35 | Process can be simulated, but no native gstack skill pipeline, PR ship flow, or WIP/squash discipline is wired. |
| Salesforce/Odoo/Twenty parity | 50 | CRM breadth is real; CPQ, workflow builder, saved views, custom objects/fields parity, campaigns, and portals lag. |
| Bid/RFP operating system | 45 | Strong model and docs; end-to-end RFP extraction/compliance/proposal citation workflow not wired. |
| Dust/MCP | 62 | Strategic direction is right; Dust REST endpoint drift, lossy outbound sync, and MCP/REST schema drift remain. |
| MemOS | 30 | Package/model exists; tenant isolation, migration consistency, L1/L2/L3 enforcement, and product-wide trace use are not production-safe. |
| Apple-grade UX | 55 | Good foundations; needs restraint, hierarchy, mobile ergonomics, and testable performance/a11y budgets. |

## Critical Blockers

### 1. Release gates are red in the current working tree

Fresh audit run:

- `pnpm lint` failed.
- `pnpm e2e` failed: 9 failed, 3 skipped, 60 passed.
- Worktree has 578 status entries.

Specific E2E failure classes:

- Account cockpit H1 mismatch / wrong-account render guard failed.
- Bid/no-bid score ring and notes textarea missing.
- Bulk action tests timed out waiting for `#main`.
- Collapsed navigation accessible-name test found strict-mode duplicate `Opportunities` links.

Remediation:

1. Freeze feature work.
2. Fix lint first.
3. Fix E2E failures without loosening assertions.
4. Split/quarantine generated artifacts and screenshots.
5. Resolve or isolate modified protected files before calling anything release-ready.

### 2. Tenant isolation is still app-layer and inconsistent

Evidence:

- `apps/api/src/lib/tenant-ownership.ts` provides helpers, but routes still write related IDs directly.
- `apps/api/src/routes/bid-scores.ts` creates scores from `opportunityId` without proving the opportunity belongs to the caller org.
- `packages/memos/src/index.ts` filters traces by org, but policy/world-model retrieval omits `orgId`, risking cross-tenant memory bleed.
- No PostgreSQL RLS policy layer was found for tenant tables.

Impact:

- Cross-tenant opportunity grafting/data leakage is possible in bid scoring and AI defense paths.
- MemOS context could mix tenant insights into proposal or bid-score generation.
- A future code miss can become a database-level breach because RLS is absent.

Remediation:

1. Apply `tenantEntityBelongsToOrg`/`tenantEntitiesBelongToOrg` to every related-ID mutation.
2. Add negative cross-tenant tests for every mutation accepting IDs.
3. Add PostgreSQL RLS via new migrations only.
4. Set `app.current_org_id` per request/transaction.
5. Ensure the app DB user cannot bypass RLS.

### 3. RBAC is opt-in, not default-deny

Evidence:

- RBAC helpers exist, but multiple high-value write routes lack explicit permission gates: service desk, territories, custom fields, references, bid scores, and other mutations.
- MCP auth currently resolves `orgId`, `keyId`, and scopes, but not app-level permission keys or tool allowlists.

Impact:

- Any authenticated org member can mutate some sensitive operational/admin records.
- An MCP key with broad `write` can perform too many CRM writes.

Remediation:

1. Add a route policy registry.
2. Require permission metadata for every `POST`, `PATCH`, and `DELETE`.
3. Add inventory tests that fail if a non-public mutation route has no permission policy.
4. Map MCP tools to `PermissionKey`s or per-key tool allowlists.

### 4. RFP/OCR document intelligence is modeled but not wired end to end

Evidence:

- `BidDocument`, `DocumentVersion`, `SourceChunk`, `Requirement`, `ComplianceMatrixRow`, `ReviewIssue`, `ApprovalGate`, and `SubmissionPackage` exist.
- Registering a bid document creates a queued `DocumentVersion`, but no extraction job is enqueued from the bid workspace route.
- The active document extraction worker writes account-intel extraction tables, not RFP `DocumentVersion`/`SourceChunk`/`Requirement` rows.
- Bid workspace snapshot omits versions, chunks, OCR progress, and source evidence.

Impact:

- The flagship RFP workspace cannot prove a scanned/document upload becomes requirements, source chunks, citations, and trusted proposal text.

Remediation:

1. Enqueue extraction from bid-document registration.
2. Worker processes `{ orgId, opportunityId, bidDocumentId, documentVersionId, storageKey }`.
3. Persist OCR/extraction status, text, layout JSON, chunks, requirements, and citations.
4. Add E2E: upload scanned PDF/image/docx/pptx/xlsx -> extraction -> compliance matrix -> cited draft.

### 5. Proposal generation is not source-grounded

Evidence:

- The RFP operating model says generated text is untrusted unless factual claims have source evidence.
- Current proposal drafting sends opportunity + MemOS context and stores prose/word count only.
- Returned sources can be `dust-agent` style placeholders, not typed citations to chunks/versions.
- `ComplianceMatrixRow.citations` is arbitrary JSON and approval checks only non-empty citation count.

Impact:

- AI-generated proposal claims cannot be trusted, audited, or defended to a customer/legal team.

Remediation:

1. Define typed citations: `bidDocumentId`, `documentVersionId`, `sourceChunkId`, locator/page/span, quote hash, confidence.
2. Store citations and coverage on proposal sections.
3. Block approval/export when factual claims lack evidence.
4. Add tests for citation integrity and version locking.

### 6. Dust integration strategy is right, but current contract is stale

Reality check:

- Dust supports remote MCP servers for custom tools: [Dust remote MCP docs](https://docs.dust.tt/docs/remote-mcp-server).
- Current Dust data-source document APIs include workspace, space, data source, and document identifiers: [Dust data source document API](https://docs.dust.tt/reference/get_api-v1-w-wid-spaces-spaceid-data-sources-dsid-documents).
- Dust conversations are available via API: [Dust conversations API](https://docs.dust.tt/reference/post_api-v1-w-wid-assistant-conversations).

Findings:

- `packages/dust-client/src/index.ts` uses document paths without `spaces/{spaceId}`.
- `runAgent()` posts to an agent-configuration run path that needs live validation.
- Dust outbound push is fire-and-forget and drops failures.
- Dust poll lists all documents repeatedly, with no high-water mark.

Remediation:

1. Add `DUST_SPACE_ID`.
2. Update document endpoints to current Dust paths.
3. Replace or prove `runAgent()` against live docs.
4. Move outbound sync into durable outbox/BullMQ jobs.
5. Add contract tests with mocked Dust API paths.

### 7. MemOS is not production-safe yet

Evidence:

- MemOS package exists and Prisma has L1/L2/L3-like tables.
- Prisma schema declares unique keys for `MemosPolicy` and `MemosWorldModel`, but the related migration creates non-unique indexes.
- L2/L3 retrieval omits `orgId`.
- Not every user-facing action creates a MemOS trace.

External reference:

- MemOS is a memory operating system project with multi-tier memory architecture claims: [MemTensor/MemOS](https://github.com/MemTensor/MemOS).

Remediation:

1. Add missing unique constraints through a new migration.
2. Add org filters everywhere.
3. Add cross-org isolation tests.
4. Introduce an explicit `MemOSService` boundary in API services.
5. Log traces only for meaningful business/user actions, not every click, unless product/legal approves volume/retention.

### 8. Production deploy topology is incomplete

Evidence:

- `docker-compose.prod.yml` has service replicas but no ingress service/ports.
- `apps/web/nginx.conf` serves SPA and assets but does not proxy `/api`, `/webhooks`, or `/mcp`.
- API has `/livez` and `/readyz`, but worker/MCP readiness is incomplete.
- API/MCP rate limits are process-local in places.
- Postgres/Redis in compose are single-container services without production backup/HA guidance.

Remediation:

1. Add explicit production ingress routing.
2. Add migration job/predeploy check.
3. Use managed Postgres/Redis or document HA/PITR/restore.
4. Add worker and MCP readiness.
5. Use Redis-backed distributed rate limits for API/MCP.
6. Add Prometheus/BullMQ metrics and Sentry/OTEL for worker/MCP.

### 9. UX is capable but not Apple-grade yet

Findings:

- Navigation has too many top-level items and desktop/mobile route drift.
- Visual language mixes enterprise tables with glass, shimmer, glow, ambient orbs, and sci-fi dashboard styling.
- Native `confirm`/`prompt` dialogs remain in shipped surfaces.
- Motion/reduced-motion warnings appear repeatedly.
- Mobile is functional, but dense tables and create actions are not designed as first-class mobile workflows.

Remediation:

1. Pick one product skin: quiet premium CRM.
2. Move visual effects behind a user preference and keep core work pages restrained by default.
3. Collapse nav into 5-7 durable groups.
4. Make desktop/mobile nav share the same registry.
5. Replace native dialogs with Radix confirmation flows.
6. Add mobile card/list variants for dense tables.
7. Add axe/Lighthouse budgets to CI.

### 10. Product story is strong, but flagship workflows are hidden or incomplete

Strong differentiators:

- Bid/no-bid scoring.
- Account 360 / cockpit intelligence.
- RFP/proposal/compliance model.
- Dust/MCP agent-readable, agent-writable CRM.
- Quote/order/invoice/product breadth.

Missing from GTM-ready product:

- First-class Bid Workspace UI.
- First-class Proposals and References routes/nav.
- Complete quote-to-cash workflow.
- Real workflow builder.
- Durable saved views.
- Campaigns/sequences/email/calendar sync.
- Customer/partner portal.
- Submission checklist and debrief/reference loop.

Remediation:

Build the golden journey:

`Lead or account signal -> Opportunity -> Bid/No-Bid -> RFP intake -> Document extraction -> Compliance matrix -> Proposal draft with citations -> Quote -> Order -> Invoice -> Debrief/reference update`

## Specialist Lane Scores

| Lane | Score | Key conclusion |
|---|---:|---|
| Backend/API | 61 | Strong foundations; consistency failures in permissions, tenant related IDs, Dust durability, audit coverage. |
| Security | 64 | Core auth improved; cross-tenant bid score graft, webhook replay envelope, RBAC gaps, and MCP scopes block enterprise readiness. |
| UX/UI | 74 | Good accessibility primitives; visual restraint, IA, mobile, and motion policy need serious work. |
| QA | 67 | Test structure exists; no coverage gates, hidden skips, brittle E2E, limited browser matrix. |
| Infra/SRE | 58 | Docker/build foundations exist; ingress, readiness, distributed limits, DR, observability, HA missing. |
| Dust/MCP/AI | 73 | Direction is correct; Dust REST path drift, lossy sync, MCP stage drift, agent run prototype gaps. |
| Data/RFP/MemOS | 56 | Strong schema; RFP extraction not wired, MemOS tenant/upsert drift, citations not enforceable. |
| Product/GTM | 63 | Strong bid-OS niche; flagship workflows hidden/incomplete versus Salesforce/Odoo/Twenty. |

## Module Ratings

| Module | Rating | Primary gap |
|---|---:|---|
| Workspace / nav / command center | 58 | Route registry/nav drift, overloaded IA, E2E nav failure. |
| Dashboard | 65 | Strong visuals but too decorative; realtime/widget customization not proven. |
| Tasks | 63 | Useful basics; dependency/Gantt/project-grade workflows incomplete. |
| Service Desk | 55 | Lifecycle exists; RBAC/audit/SLA depth weak. |
| Sales methodology | 45 | MEDDIC/BANT coaching not yet a real methodology engine. |
| Pipeline | 65 | Solid UI; stage/MCP enum drift and gate enforcement gaps. |
| Opportunities | 68 | Rich object; tenant/RBAC/audit/Dust durability gaps. |
| Bid/No-Bid Matrix | 58 | Differentiator, but E2E failing and scoring needs approval/collaboration/calibration. |
| RFP / Proposals | 42 | Schema/docs exist; end-to-end extraction/citations/proposal factory missing. |
| Leads | 60 | CRUD good; scoring/routing/enrichment/campaign loop incomplete. |
| Customers / accounts | 68 | Account cockpit promising; account E2E currently failing. |
| Companies | 62 | Enrichment exists; taxonomy/news/tech stack production integration incomplete. |
| Contacts | 65 | Solid tables; consent/influence/org chart depth incomplete. |
| Territories | 52 | Feature exists; RBAC/owner validation and GIS/quota depth weak. |
| Operate / delivery | 45 | Delivery/milestones/resource/margin not fully productized. |
| Sales / RevOps | 58 | Forecasting/reporting basics; quota/comp/manager rollups incomplete. |
| Quotations & orders | 60 | Order/invoice/product pieces exist; CPQ/approvals/PDF/signature not complete. |
| Products | 62 | Catalog exists; pricing/margin/variant intelligence incomplete. |
| Invoices | 62 | Invoicing exists; tax, dunning, payments, ERP-grade controls incomplete. |
| References | 45 | Conceptual differentiator, not first-class route/workflow. |
| Reports | 55 | Useful reports; no embedded analytics/ad hoc builder/materialized summaries at target level. |
| Admin/settings | 56 | Settings exist; RBAC/ABAC/field-level/security/sandbox incomplete. |
| Workflows | 45 | Cards/read views, not a robust builder/runtime UX. |
| Intake | 50 | Upload/intake direction; RFP handoff to workspace incomplete. |
| Integrations | 62 | Dust/MCP/connector direction strong; contract/durability gaps. |
| Audit Log | 54 | Audit pattern exists; not every mutation, no WORM/hash/retention proof. |

## Remediation Plan

### Phase 0 - Stop the bleeding: gates and hygiene

Target duration: 1-3 days.

Exit criteria:

- `git status --short` contains only intentional source/doc changes.
- Generated artifacts are quarantined or ignored.
- No existing Prisma migration is modified.
- `packages/db/migration.sql` is removed/quarantined after explicit confirmation or moved to a non-executable analysis location.
- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm e2e`, `pnpm audit --audit-level high`, and web build all pass.

Tasks:

1. Fix `apps/web/public/sw.js` ESLint globals.
2. Remove unused `providers` in `OrgDashboard`.
3. Fix constant truthiness in `cn.test.ts`.
4. Fix account cockpit E2E wrong-account/H1 failure.
5. Fix bid/no-bid E2E score ring/notes/main failures.
6. Fix bulk-action `#main` route failures.
7. Fix collapsed nav duplicate accessible names.
8. Split dirty worktree into source, docs, generated, local-agent, and test-artifact groups.

### Phase 1 - Security and tenant hardening

Target duration: 1-2 weeks.

Exit criteria:

- Cross-tenant negative tests fail before fixes and pass after fixes.
- Every mutation route declares permission metadata.
- Every related-ID write validates ownership.
- RLS blocks cross-tenant reads/writes even if app code misses `orgId`.
- MCP write keys are tool/permission scoped.

Tasks:

1. Add route policy registry and default-deny write hook.
2. Implement `requirePermission(permissionKey)` everywhere.
3. Validate related IDs for proposals, opportunities, invoices, workflows, activities, territories, leads, service desk, products, contacts, tasks, files, bid scores, MemOS, and agent runs.
4. Add RLS through new migrations.
5. Bind webhook timestamp/event ID into signed envelope if Dust allows, or enforce Dust native signing spec with replay tests.
6. Hash webhook subscription secrets.
7. Add DNS/IP SSRF validation for webhook URLs.

### Phase 2 - RFP/OCR/MemOS flagship workflow

Target duration: 2-4 weeks.

Exit criteria:

- PDF, scanned PDF, image, docx, pptx, and xlsx upload produce extraction status, source chunks, requirements, and typed citations.
- Compliance matrix can be generated and reviewed from extracted requirements.
- Proposal drafts cannot be marked trusted/exported without evidence.
- MemOS L2/L3 retrieval is tenant-isolated.

Tasks:

1. Fix MemOS unique constraints with a new migration.
2. Add org filters to all MemOS retrieval.
3. Queue bid-document extraction on document registration.
4. Adapt worker to write RFP `DocumentVersion`, `SourceChunk`, and `Requirement` rows.
5. Define typed citation schemas.
6. Build Bid Workspace UI: register, split viewer, requirement inbox, compliance matrix, review issues, approval gates, export.
7. Move agent runs to worker queues.
8. Enforce `allowedInputScopes` and `approvalRequired`.

### Phase 3 - Dust/MCP production integration

Target duration: 1-2 weeks.

Exit criteria:

- Dust data-source document sync uses current official endpoint shape.
- Outbound sync is durable and observable.
- MCP and REST share canonical schemas/stage mappings.
- Dust agent can complete 5 real module tasks in a test workspace with source references.

Tasks:

1. Add `DUST_SPACE_ID`.
2. Update Dust document paths.
3. Replace fire-and-forget pushes with outbox/BullMQ jobs.
4. Add high-water marks to Dust polling.
5. Add event coverage for documented Dust webhook events.
6. Normalize MCP stage contracts.
7. Add MCP handshake and tool contract tests.

### Phase 4 - Apple-grade UX and product IA

Target duration: 2-4 weeks.

Exit criteria:

- Navigation is lifecycle-based and consistent across sidebar, mobile nav, command palette, route titles, permissions.
- Core CRM pages pass axe/WCAG 2.2 AA.
- Reduced-motion mode emits no warnings and disables decorative continuous motion.
- Mobile views are usable without horizontal-scroll dependence for common workflows.

Recommended nav:

- Command Center
- Accounts
- Pursuits
- Bid Workspace
- Proposals
- Commercials
- Intelligence
- Automations
- Admin

Tasks:

1. Build a single route registry.
2. Promote proposals/references/agents/bid workspace to first-class routes.
3. Replace native prompts/confirms.
4. Add mobile table-to-card variants.
5. Move ambient/glass effects behind preferences.
6. Add Lighthouse/axe CI gates.
7. Add Storybook or component playground coverage for key primitives.

### Phase 5 - Production runtime and operations

Target duration: 2-4 weeks.

Exit criteria:

- `docker compose -f docker-compose.prod.yml build` succeeds from clean clone.
- Production ingress routes `/`, `/api`, `/webhooks`, and `/mcp` correctly.
- `/readyz` fails when DB/Redis/storage/config is unavailable.
- Worker/MCP readiness exists.
- Two API replicas share rate limits, idempotency, upload state, and webhook dedup.
- Backup restore drill is proven.

Tasks:

1. Add ingress or deployment-specific router config.
2. Add migration predeploy job.
3. Add worker/MCP health endpoints.
4. Move rate limits/idempotency to Redis/Postgres as appropriate.
5. Add PgBouncer/managed pool guidance.
6. Add Prometheus metrics and BullMQ dashboards.
7. Add Sentry/OTEL to worker/MCP.
8. Add DR runbooks: PITR, restore drill, object version restore, migration rollback.
9. Add 5,000-active-user load scenario.

### Phase 6 - Enterprise CRM parity and GTM readiness

Target duration: 4-8 weeks after hardening.

Exit criteria:

- A sales manager can complete full lifecycle with permissions, auditability, reports, and exports.
- A bid team can upload a real RFP and produce a cited, reviewed proposal package.
- 100k-record tenant list views remain usable.
- Core CRM workflow feels coherent enough to demo in under 5 minutes.

Tasks:

1. Durable saved views: private/team/org scopes, columns, filters, sort, density.
2. Enterprise tables: server pagination, keyboard nav, bulk actions, loading/empty/error/success states.
3. Quote-to-cash: quote -> approval -> order -> invoice -> payment -> audit.
4. Workflow builder: triggers, actions, approvals, retries, history, simulation.
5. Reporting: forecasting, win rate, pipeline aging, quote-to-cash, SLA, territory.
6. Customer/partner portal and final submission package workflow.

## 30 / 60 / 90 Day Plan

### First 30 days

- Restore green gates.
- Harden tenant/RBAC/MCP/webhooks.
- Fix MemOS tenant isolation and schema drift.
- Wire the first complete RFP extraction path.
- Align Dust REST contract.
- Build route registry and simplify navigation.

### 60 days

- Complete Bid Workspace UI.
- Add typed citations and proposal evidence gates.
- Durable Dust outbox and MCP contract tests.
- Production ingress/readiness/observability baseline.
- Saved views and enterprise tables for core modules.

### 90 days

- Full quote-to-cash.
- Workflow builder.
- Load test and DR proof.
- AI agent phase orchestration with approval gates.
- Sales-ready demo story against Salesforce/Odoo/Twenty.

## Definition of Done for 95+/100

The CRM is not done until:

1. All gates pass from a clean checkout.
2. No high/critical dependency advisories remain.
3. RLS and app RBAC both enforce tenant/permission boundaries.
4. Every mutation writes an audit row.
5. Every related-ID write validates tenant ownership.
6. MCP tools are permission-scoped and contract-tested.
7. Dust REST/MCP/webhook integration is durable and documented against current official APIs.
8. RFP upload produces source chunks, requirements, compliance rows, citations, and proposal draft.
9. AI-generated factual claims have source evidence before trust/export.
10. Worker/API/MCP/web health/readiness are observable.
11. Production ingress, migration, backup, rollback, and DR are documented and tested.
12. Core UX passes WCAG 2.2 AA, reduced-motion, mobile, and performance budgets.
13. 5,000-user load test meets agreed latency/error/queue budgets.
14. The golden journey is demoable without admin intervention.

## External Sources Checked

- Dust remote MCP server documentation: https://docs.dust.tt/docs/remote-mcp-server
- Dust data-source document API reference: https://docs.dust.tt/reference/get_api-v1-w-wid-spaces-spaceid-data-sources-dsid-documents
- Dust conversations API reference: https://docs.dust.tt/reference/post_api-v1-w-wid-assistant-conversations
- gstack repository: https://github.com/garrytan/gstack
- MemOS repository: https://github.com/MemTensor/MemOS
- Salesforce Sales Cloud guide: https://www.salesforce.com/sales/cloud/guide/
- Odoo CRM quoting documentation: https://www.odoo.com/documentation/18.0/applications/sales/crm/acquire_leads/send_quotes.html
- Twenty key features documentation: https://docs.twenty.com/getting-started/key-features

