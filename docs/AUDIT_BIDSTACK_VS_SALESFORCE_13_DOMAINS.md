# BidStack 360° vs Salesforce — 13-Domain Capability Audit

> **Scope:** `d:/BIDCRM` codebase (apps/api, apps/web, apps/worker, apps/mcp-server, packages/db)  
> **Date:** 2026-05-23  
> **Auditor:** Comprehensive audit agent  

---

## Executive Summary

BidStack 360° is a modern, tenant-scoped React + Fastify CRM with strong foundations in custom fields, basic workflow automation, lead routing, and webhook integrations. Compared with Salesforce-level enterprise capability, the largest structural gaps are in **declarative automation execution** (record-triggered flows are modeled but not wired), **approval process orchestration**, **page layout / app builder**, **native mobile**, and **metadata-driven CI/CD**. The codebase has clean tenancy, Prisma schemas that anticipate many enterprise features, and a BullMQ worker layer that can serve as the execution backbone for missing automation.

| Domain | Current Maturity | Largest Gap | Priority |
|--------|------------------|-------------|----------|
| 1. Flow Builder & Automation | ⚠️ Schema + manual run only | Record-triggered / scheduled auto-execution | **P0** |
| 2. Approval Processes | ⚠️ Single gate (compliance only) | Multi-step, dynamic, parallel approvals | **P1** |
| 3. Validation & Assignment | ⚠️ Zod + lead rules only | Formula-based validation engine | **P1** |
| 4. Platform Events & Triggers | ⚠️ Webhooks only | Internal event bus / CDC | **P1** |
| 5. Page Layouts & App Builder | ❌ Not present | Drag-and-drop designer + record types | **P2** |
| 6. Component Framework | ❌ Not present | Packaged reusable component runtime | **P2** |
| 7. Marketplace / AppExchange | ⚠️ Plugin stub | Real marketplace + ISV program | **P3** |
| 8. Native Mobile App | ❌ Not present | iOS / Android native apps | **P2** |
| 9. Offline Sync | ⚠️ Basic SW cache | Selective sync + conflict resolution | **P1** |
| 10. Mobile Field Service | ❌ Not present | Technician app + work orders + GPS | **P3** |
| 11. API Completeness | ⚠️ REST + MCP only | Bulk API 2.0, Composite API, GraphQL | **P1** |
| 12. Streaming & Events | ⚠️ Webhooks only | Streaming API / SSE / Pub-Sub | **P1** |
| 13. Metadata API & CI/CD | ❌ Not present | Metadata API + sandbox management | **P2** |

---

## 1. Automation — Flow Builder & Declarative Automation

### Current State
- **Schema:** `Workflow` table defines `triggerKind` (`record_created`, `record_updated`, `stage_changed`, `schedule`, `webhook_received`, `manual`) and `WorkflowAction` table stores 8 action types (`send_email`, `send_slack`, `create_task`, `update_field`, `call_webhook`, `assign_owner`, `run_dust_agent`, `create_notification`).
- **API:** Full CRUD at `/api/workflows` and manual execution via `POST /workflows/:id/run`.
- **Execution:** Simple sequential loop in the API process; `WorkflowRun` records status/output. Only `create_task`, `call_webhook`, and `create_notification` have actual implementations; the rest are stubs.
- **UI:** `WorkflowsPage.tsx` exists (assumed list/detail; no visual canvas confirmed).

### Gap List
| Gap | Severity | Notes |
|-----|----------|-------|
| Record-triggered flows not auto-executed on DB mutations | **Critical** | `triggerKind` values exist in schema, but no worker or DB hook fires them. |
| Scheduled flows (cron) not implemented | **High** | `schedule` triggerKind is stored; no cron runner inspects workflow tables. |
| No visual Flow Builder / drag-and-drop canvas | **Critical** | Frontend is form-based; no node-graph editor. |
| No subflow / reusable flow composition | **High** | Workflows are flat action lists. |
| No screen flows (interactive user prompts) | **High** | Cannot pause flow for user input. |
| No transaction boundaries / rollback on failure | **Medium** | Partial failures leave side-effects. |
| No bulk flow execution | **Medium** | One run = one sequential loop. |

### Effort Estimate
**XL** — Requires event-bus wiring, worker executor, and a frontend canvas.

### Dependency Map
- **Prerequisites:** Domain 4 (Platform Events & Triggers) for record-triggered hooks; BullMQ worker expansion.
- **Blocked by:** None, but heavily overlaps with Domain 2 (Approval) if approvals are implemented as flow nodes.

### Recommended Priority
**P0** — The schema already promises this capability; delivering auto-execution is a credibility issue.

---

## 2. Automation — Approval Processes

### Current State
- **Schema:** `ApprovalGate` model with `status` (`pending`, `approved`, `rejected`, `waived`), `approverUserId`, `decidedAt`.
- **API:** Used only inside `bid-workspace.ts` for compliance-matrix rows (bid-document approvals).
- **Behavior:** Single-step approval; no chaining, delegation, or dynamic approver lookup.

### Gap List
| Gap | Severity | Notes |
|-----|----------|-------|
| No general-purpose approval process builder | **Critical** | Approval is hard-wired to bid workspace. |
| No multi-step approval chains | **Critical** | Cannot route through manager → VP → Finance. |
| No dynamic approver resolution (manager of owner, role-based) | **High** | Approver is a static userId. |
| No delegation / out-of-office rerouting | **High** | Vacation breaks the process. |
| No parallel approvals (e.g., Legal + Finance simultaneously) | **High** | Only single approver per gate. |
| No email-based approve/reject actions | **Medium** | No “Reply Approved” token flow. |
| No approval-specific audit history | **Medium** | Mixed into generic `AuditLog`. |

### Effort Estimate
**L** — Can extend `Workflow` engine with an `approval` action node; adds ~3–4 tables.

### Dependency Map
- **Prerequisites:** Domain 1 (Flow Builder) for orchestration; email outbound service.
- **Blocked by:** None.

### Recommended Priority
**P1** — Enterprise sales/CPQ cannot operate without structured approvals.

---

## 3. Automation — Validation Rules & Assignment

### Current State
- **Validation:** Input validation is only Zod schemas at the Fastify route boundary. No formula-based business rules.
- **Assignment:** `LeadRoutingRule` supports simple criteria (`industry`, `countryCode`, `minValue`) with round-robin team assignment. `Territory` model links opportunities to owners by geography.
- **API:** `/api/lead-routing-rules/evaluate` returns a matched rule; not auto-applied on lead creation.

### Gap List
| Gap | Severity | Notes |
|-----|----------|-------|
| No formula-based validation rules at UI + API layer | **Critical** | Cannot enforce “Amount > 0 when Stage = Negotiation”. |
| No cross-field validation engine | **High** | Rules are single-field Zod checks only. |
| No custom error messages per rule | **Medium** | Generic 400 responses. |
| Assignment rules limited to leads | **High** | No case/opportunity/account auto-assignment. |
| No territory-based case routing | **Medium** | Territories exist but only for opportunities. |

### Effort Estimate
**L** — Requires a formula parser (e.g., `mathjs` or custom DSL) and middleware injected into all CRUD routes.

### Dependency Map
- **Prerequisites:** None major; can be built as middleware.
- **Blocked by:** None.

### Recommended Priority
**P1** — Data quality degrades quickly without declarative validation in multi-user CRMs.

---

## 4. Automation — Platform Events & Triggers

### Current State
- **SyncEvent:** Captures Dust poll/webhook/MCP events; worker drains them.
- **SubscriptionEvent:** Captures real-time collaboration events (`record_changed`, `comment_added`, `stage_moved`) for `UserPresence`.
- **Webhooks:** Inbound (`/webhooks/dust`) and outbound (`WebhookSubscription`).
- **No CDC:** Postgres logical replication is not consumed; no internal event bus.

### Gap List
| Gap | Severity | Notes |
|-----|----------|-------|
| No internal platform events / event bus | **Critical** | Components are tightly coupled; no decoupled automation. |
| No Change Data Capture (CDC) streaming | **High** | External systems cannot subscribe to row-level changes. |
| No Apex-equivalent server-side trigger runtime | **High** | Agents (`Agent`/`AgentRun`) exist but are LLM-driven, not deterministic triggers. |
| No event replay or retention policy | **Medium** | `SubscriptionEvent` has no TTL or replay API. |
| No event filtering / topic routing | **Medium** | All events are org-scoped broadcasts. |

### Effort Estimate
**L** — Can implement Outbox pattern in Prisma middleware + Redis Pub/Sub; CDC via `pg_logical`.

### Dependency Map
- **Prerequisites:** Redis (already used for BullMQ).
- **Blocked by:** None.

### Recommended Priority
**P1** — Unblocks Domain 1 (auto-triggered flows) and Domain 12 (Streaming).

---

## 5. Customization — Page Layouts & App Builder

### Current State
- **Custom Fields:** Mature engine (`CustomFieldDefinition` + `CustomFieldValue`) with 10 types, bulk upsert, and per-entity scoping.
- **Dashboard:** `DashboardWidget` stores x/y/w/h grid config; no drag-and-drop palette.
- **No Record Types:** Schema has no `RecordType` model.
- **No Layout Designer:** Pages are hard-coded React components.

### Gap List
| Gap | Severity | Notes |
|-----|----------|-------|
| No drag-and-drop page layout designer | **Critical** | Admins cannot configure record pages without dev. |
| No record type → layout assignment | **Critical** | All records share the same page structure. |
| No conditional visibility per layout | **High** | Cannot show/hide sections based on field values. |
| No related list configuration | **High** | Related objects are hard-coded in each page. |
| No Lightning App Builder equivalent | **High** | No app-level tab/component configuration. |

### Effort Estimate
**XL** — Requires a new layout schema, a frontend canvas (e.g., `react-grid-layout` + dnd), and dynamic component rendering.

### Dependency Map
- **Prerequisites:** Custom fields (already done); record type model.
- **Blocked by:** None.

### Recommended Priority
**P2** — Important for admin self-service, but custom fields cover the immediate need.

---

## 6. Customization — Component Framework

### Current State
- **UI:** React 18 + Tailwind 4 + Radix primitives in `apps/web/src/components`. Components are app-specific, not packaged.
- **No LWC Equivalent:** No standard for third-party or reusable CRM components.
- **No Packaging:** `Plugin` model exists but no component-level runtime.

### Gap List
| Gap | Severity | Notes |
|-----|----------|-------|
| No reusable UI component framework | **Critical** | Every page is bespoke React. |
| No managed/unmanaged package model | **High** | Cannot version or distribute UI extensions. |
| No component metadata API | **High** | Layout designer cannot discover components dynamically. |
| No third-party component sandboxing | **Medium** | Plugins run in the same origin. |

### Effort Estimate
**XL** — Needs a component registry, runtime sandbox (iframe or Shadow DOM), and packaging format.

### Dependency Map
- **Prerequisites:** Domain 5 (Page Layouts) to host components; Domain 7 (Marketplace) for distribution.
- **Blocked by:** None.

### Recommended Priority
**P2** — Long-term differentiator; short-term can ship with bespoke components.

---

## 7. Customization — Marketplace / AppExchange

### Current State
- **Plugin Model:** `Plugin` table stores `manifestUrl`, `permissions`, `config`. CRUD at `/api/plugins`.
- **Install Flow:** Validates HTTPS + public hostname (SSRF guard), but **manifest is hardcoded** (`name: 'Custom Plugin'`) — no real manifest fetch.
- **No Frontend Marketplace:** No browsing, ratings, or install UI.

### Gap List
| Gap | Severity | Notes |
|-----|----------|-------|
| No functional third-party app marketplace | **Critical** | Plugin system is a stub. |
| No ISV program / partner portal | **Critical** | No onboarding for external developers. |
| No certified connector program | **High** | Integrations are hand-coded (Odoo, Microsoft, Salesforce config row exists but no code). |
| No app review / security scanning pipeline | **High** | Any manifest URL is accepted if public. |
| No revenue share / billing for apps | **Medium** | Stripe integration not exposed to plugins. |

### Effort Estimate
**XL** — Marketplace is a product unto itself.

### Dependency Map
- **Prerequisites:** Domain 6 (Component Framework) for UI plugins; robust sandboxing.
- **Blocked by:** None.

### Recommended Priority
**P3** — Strategic differentiator after core CRM depth is proven.

---

## 8. Mobile — Native Mobile App

### Current State
- **Web App:** Responsive React app with `MobileNav`, PWA manifest (`manifest.json`), and service worker (`sw.js`).
- **PWA:** Caches shell + stale-while-revalidate for API GETs; not a full offline solution.
- **No Native Apps:** No iOS, Android, or React Native codebase found.

### Gap List
| Gap | Severity | Notes |
|-----|----------|-------|
| No native iOS app | **Critical** | Enterprise reps expect native performance. |
| No native Android app | **Critical** | |
| No mobile SDK | **High** | Cannot embed CRM data in partner apps. |
| No push notifications | **Medium** | Service worker cannot push without backend gateway. |
| No biometric auth | **Medium** | Only Clerk web auth. |

### Effort Estimate
**XL** — React Native rewrite or native Swift/Kotlin apps.

### Dependency Map
- **Prerequisites:** Domain 11 (API Completeness) for mobile-optimized endpoints; Domain 9 (Offline Sync) for usable field experience.
- **Blocked by:** None.

### Recommended Priority
**P2** — PWA covers early adopters; native is needed for enterprise field sales.

---

## 9. Mobile — Offline Sync

### Current State
- **Service Worker:** `sw.js` caches static assets (cache-first) and API GETs (stale-while-revalidate). Falls back to cached response when network fails.
- **UI:** `OfflineIndicator` shows a pill when `navigator.onLine` is false.
- **No Mutation Queue:** POST/PATCH/DELETE are not intercepted or queued.
- **No Conflict Resolution:** No merge logic for concurrent edits.

### Gap List
| Gap | Severity | Notes |
|-----|----------|-------|
| No selective offline data priming | **Critical** | Cannot choose which accounts/opps to sync locally. |
| No mutation queue for offline writes | **High** | Saves fail immediately when offline. |
| No conflict resolution engine | **Critical** | Stale-while-revalidate reads may be outdated; no write-merge. |
| No background sync | **High** | `sync` event not used in SW. |
| No IndexedDB entity cache | **High** | Only `CacheStorage` for HTTP responses. |

### Effort Estimate
**L** — Can extend existing SW + add IndexedDB layer (e.g., Dexie) with conflict resolution logic.

### Dependency Map
- **Prerequisites:** None major.
- **Blocked by:** None.

### Recommended Priority
**P1** — Field sales cannot rely on constant connectivity; PWA offline is a must-have before native apps.

---

## 10. Mobile — Mobile Field Service

### Current State
- **Service Desk:** `ServiceCase` model with priority, status, SLA deadline — basic ticketing.
- **No Field Service:** No work orders, dispatch, assets, or technician scheduling.

### Gap List
| Gap | Severity | Notes |
|-----|----------|-------|
| No technician mobile app | **Critical** | |
| No work order management | **Critical** | |
| No geolocation / GPS tracking | **Critical** | `Permissions-Policy` explicitly disables geolocation. |
| No route optimization | **High** | |
| No parts/inventory for field visits | **High** | |
| No time-sheet / job completion flow | **Medium** | |

### Effort Estimate
**XL** — New data model + mobile app + GIS integration.

### Dependency Map
- **Prerequisites:** Domain 8 (Native Mobile), Domain 9 (Offline Sync), mapping provider.
- **Blocked by:** None.

### Recommended Priority
**P3** — Not in the current product charter; add only if field service is a target vertical.

---

## 11. Integration — API Completeness

### Current State
- **REST API:** Fastify 5 with Zod, org-scoped, RBAC-protected. ~40 route modules.
- **MCP Server:** 20+ tools exposing CRM read/write to Dust/LLM agents.
- **API Keys:** Scoped, hashed, with prefix + revocation.
- **Missing Protocols:** No SOAP, GraphQL, Bulk API 2.0, or Composite API.

### Gap List
| Gap | Severity | Notes |
|-----|----------|-------|
| No Bulk API 2.0 for large ingestion | **High** | Uploading 10k contacts requires N REST calls. |
| No Composite API (multi-object tx) | **High** | Cannot create Account + Contacts + Opportunity atomically. |
| No GraphQL endpoint | **Medium** | Frontend over-fetches; mobile clients need flexibility. |
| No SOAP API | **Medium** | Legacy ERP integrations often require SOAP. |
| No OAuth 2.0 token issuance for external clients | **High** | Only Clerk sessions and API keys; no client-credentials flow. |
| No API versioning strategy | **Medium** | Routes are `/api/*` without version header. |

### Effort Estimate
**L** — Bulk + Composite can be new route modules; GraphQL can be a Yoga/Apollo layer over Prisma.

### Dependency Map
- **Prerequisites:** None major.
- **Blocked by:** None.

### Recommended Priority
**P1** — Enterprise integrations are gated by bulk/composite APIs and standard OAuth.

---

## 12. Integration — Streaming & Events

### Current State
- **Outbound Webhooks:** `WebhookSubscription` lets admins register HTTPS URLs for event types.
- **Inbound Webhooks:** `/webhooks/dust` with HMAC verification, dedup, and async worker processing.
- **No Streaming API:** No SSE, WebSockets, or long-polling for real-time client updates.
- **No Pub/Sub:** Events are org-scoped table inserts, not topic-based.

### Gap List
| Gap | Severity | Notes |
|-----|----------|-------|
| No Streaming API / SSE for clients | **High** | UI polls for updates; no live push. |
| No Pub/Sub topic model | **High** | Cannot subscribe to `opportunity.stage_changed` globally. |
| No CDC streaming to external consumers | **High** | ETL tools cannot tail changes. |
| No event replay API | **Medium** | `SubscriptionEvent` table has no replay endpoint. |
| No WebSocket presence / typing indicators | **Medium** | `UserPresence` is polled, not pushed. |

### Effort Estimate
**M** — SSE over HTTP/2 or Redis Pub/Sub + WebSockets for presence.

### Dependency Map
- **Prerequisites:** Domain 4 (Platform Events & Triggers) for event generation.
- **Blocked by:** None.

### Recommended Priority
**P1** — Real-time collaboration and external ETL are standard enterprise expectations.

---

## 13. Integration — Metadata API & CI/CD

### Current State
- **No Metadata API:** Config (workflows, custom fields, roles, dashboards) is only accessible via REST CRUD, not as deployable metadata packages.
- **No Source-Driven Development:** No Salesforce DX-style pull/push of config to Git.
- **No Sandbox Management:** No scratch orgs, sandboxes, or environment promotion.
- **Product CI/CD:** GitHub Actions exist for repo-level build/test, not for org-level deployments.

### Gap List
| Gap | Severity | Notes |
|-----|----------|-------|
| No metadata API for config-as-code | **Critical** | Admins cannot version control workflows, layouts, or fields. |
| No source-driven development model | **Critical** | No `bidstack push` / `bidstack pull` CLI. |
| No sandbox / scratch org provisioning | **Critical** | No safe environment for testing config changes. |
| No change sets / deployment pipelines | **High** | No promotion from dev → staging → prod. |
| No dependency / impact analysis | **Medium** | Deleting a field referenced by a workflow is not blocked. |

### Effort Estimate
**XL** — Requires a metadata serialization format, packaging spec, sandbox orchestration, and CLI.

### Dependency Map
- **Prerequisites:** Domains 1, 2, 3, 5 must be stable so their metadata shapes are worth versioning.
- **Blocked by:** None.

### Recommended Priority
**P2** — Essential for enterprise DevOps maturity, but can be deferred until core automation is shipped.

---

## Cross-Domain Dependency Graph

```
Domain 4 (Platform Events)
    ├─ enables ──► Domain 1 (Flow Builder auto-triggers)
    ├─ enables ──► Domain 12 (Streaming API)
    └─ enables ──► Domain 2 (Approval orchestration)

Domain 1 (Flow Builder)
    └─ enables ──► Domain 2 (Approval as flow node)

Domain 5 (Page Layouts)
    ├─ depends on ──► Domain 6 (Component Framework)
    └─ depends on ──► Custom Fields (existing)

Domain 6 (Component Framework)
    ├─ enables ──► Domain 7 (Marketplace apps)
    └─ depends on ──► Domain 5 (Layout designer)

Domain 8 (Native Mobile)
    ├─ depends on ──► Domain 9 (Offline Sync)
    └─ depends on ──► Domain 11 (API Completeness)

Domain 13 (Metadata API)
    ├─ depends on ──► Domain 1, 2, 3, 5 (stable metadata shapes)
    └─ enables ──► Enterprise CI/CD maturity
```

---

## Recommended Roadmap (Quarterly View)

| Quarter | Focus | Domains |
|---------|-------|---------|
| **Q1** | Automation Backbone | 1 (auto-execution), 4 (event bus), 3 (validation engine), 9 (offline sync) |
| **Q2** | Enterprise Integration | 11 (Bulk/Composite/GraphQL), 12 (Streaming API), 2 (Approval processes) |
| **Q3** | Admin Self-Service | 5 (Layout designer), 13 (Metadata API v1), 8 (Native mobile MVP) |
| **Q4** | Ecosystem | 6 (Component framework), 7 (Marketplace v1), 10 (Field service if vertical fit) |

---

*End of Audit.*
