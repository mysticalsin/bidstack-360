# BidStack 360° — Enterprise CRM Capability Audit vs Salesforce

**Audit date:** 2026-05-23  
**Scope:** 12 capability domains across data model, API routes, services, and UI  
**Method:** Codebase inspection of `d:/BIDCRM` (Prisma schema, API routes, React pages, services)

---

## 1. Activity & Collaboration — Internal Collaboration

### Current State

- **Comment + Mention tables** exist (`Comment`, `Mention`) with CRUD routes in `collaboration.ts`
- **@mentions** are parsed from markdown body via regex (`@name`) and generate `Mention` rows with read/unread tracking
- **UserPresence** table tracks online/away/busy/offline status and current record context
- **Activity** table supports email, meeting, call, note, task types with polymorphic `entityType/entityId` links
- Comments are threaded via `parentId` (single-level replies)
- UI: Comments render on record pages; presence badges visible

### Gap List

| #   | Gap                                                                                          | Severity |
| --- | -------------------------------------------------------------------------------------------- | -------- |
| 1   | No **group spaces / Chatter groups** (public/private team rooms)                             | High     |
| 2   | No **file attachments in comments** (only `FileAttachment` on Company)                       | Medium   |
| 3   | No **rich text / Quill editor** in comment composer (plain markdown only)                    | Low      |
| 4   | No **real-time push** for comments (no WebSocket/SSE; polling only)                          | Medium   |
| 5   | No **follow/unfollow** record subscriptions beyond basic `SubscriptionEvent` table (unwired) | Medium   |
| 6   | No **feed aggregation** (global "What I Follow" stream)                                      | High     |

### Effort Estimate

**M** — Group spaces + feed aggregation require new schema + UI + routing

### Dependency Map

- Real-time layer (WebSocket/SSE infra) → feeds push
- File storage adapter expansion → comment attachments
- Notification service (currently mentions only) → follow subscriptions

### Recommended Priority

**P1** — Collaboration is table-stakes for team adoption; feed aggregation is the highest-value gap.

---

## 2. Marketing Automation — Campaign Management

### Current State

- **No Campaign entity exists.** Zero schema tables, routes, or UI for campaigns.
- Lead `source` field captures origin (website, referral, event, etc.) but no linkage to campaigns.
- `LeadRoutingRule` and `Workflow` engines exist but are not campaign-aware.

### Gap List

| #   | Gap                                                                     | Severity |
| --- | ----------------------------------------------------------------------- | -------- |
| 1   | No **Campaign** object (name, type, status, start/end dates, budget)    | Critical |
| 2   | No **Campaign Members** (lead/contact ↔ campaign junction with status)  | Critical |
| 3   | No **Campaign Influence** on Opportunities (revenue attribution)        | Critical |
| 4   | No **Cost Tracking** (actual cost, cost per lead, cost per opportunity) | High     |
| 5   | No **ROI / ROMI dashboards** for marketing                              | High     |
| 6   | No **Web-to-Lead** forms (public landing-page form builder)             | High     |
| 7   | No **Campaign Hierarchy** (parent/child campaigns)                      | Medium   |

### Effort Estimate

**XL** — New module: schema, API, UI, reporting, and web-to-lead hosting

### Dependency Map

- Lead/Contact schemas (stable) → CampaignMember junction
- Opportunity schema (stable) → Campaign Influence linkage
- Reporting layer (existing) → Campaign ROI widgets
- Auth/public pages → Web-to-Lead form renderer

### Recommended Priority

**P1** — Marketing automation is a primary Salesforce differentiator; without campaigns, BidStack is sales-only.

---

## 3. Marketing Automation — Lead Scoring & Routing

### Current State

- **Lead.score** field (0–100) exists; editable manually or via API
- **LeadRoutingRule** table + CRUD + evaluation endpoint (`/lead-routing-rules/evaluate`)
  - Criteria: industry, countryCode, minValue
  - Assignment: user, territory, or round-robin team
- **PredictiveScore** table has `lead_score` kind (heuristic stub returning static 68/100)
- BANT fields on Lead: budget, authority, need, timeline (manual entry)

### Gap List

| #   | Gap                                                                       | Severity |
| --- | ------------------------------------------------------------------------- | -------- |
| 1   | No **behavioral scoring** (email opens, web visits, content downloads)    | Critical |
| 2   | No **profile scoring rules engine** (demographic/firmographic auto-score) | High     |
| 3   | No **engagement scoring** (recency/frequency of interactions)             | High     |
| 4   | No **MQL threshold & auto-promotion** (score → status = "qualified")      | High     |
| 5   | Lead routing is **criteria-only**; no **predictive/AI routing**           | Medium   |
| 6   | No **scoring degradation / recency decay**                                | Medium   |

### Effort Estimate

**L** — Behavioral scoring requires event ingestion pipeline; profile scoring is rules-engine work

### Dependency Map

- Activity/engagement event stream (new) → behavioral scoring
- Marketing email/campaign module (new) → engagement data
- Workflow engine (existing) → MQL auto-promotion
- LeadRoutingRule (existing) → enhanced criteria

### Recommended Priority

**P1** — Lead scoring is essential for marketing automation; routing is already partially built.

---

## 4. Marketing Automation — Campaign Influence & Attribution

### Current State

- **No campaign influence model** exists
- `OpportunityContact` links contacts to opportunities with `role` and `influence` fields, but no attribution weight
- `source` on Lead and `sourceAttribution` JSON blobs exist on several entities, but no standardized touch-tracking

### Gap List

| #   | Gap                                                                                      | Severity |
| --- | ---------------------------------------------------------------------------------------- | -------- |
| 1   | No **Campaign Influence** model (Opportunity ↔ Campaign with revenue share %)            | Critical |
| 2   | No **multi-touch attribution** (first touch, last touch, even touch, U-shaped, W-shaped) | Critical |
| 3   | No **touchpoint timeline** per opportunity                                               | High     |
| 4   | No **attribution reporting** (marketing-sourced vs influenced pipeline)                  | High     |
| 5   | No **contact role weighting** in attribution calculations                                | Medium   |

### Effort Estimate

**L** — Schema + analytics; can reuse existing Opportunity/Contact linkages

### Dependency Map

- Campaign module (must build first) → influence junction
- Opportunity/Contact schemas (existing) → touchpoint linking
- Reporting layer (existing) → attribution dashboards

### Recommended Priority

**P2** — Depends on Campaign Management (P1). Start immediately after campaigns ship.

---

## 5. Service Cloud — Case Management Depth

### Current State

- **ServiceCase** table: id, number, subject, description, priority, status, accountId, contactId, ownerId, source, satisfaction, resolvedAt, closedAt, slaDeadline
- API: full CRUD in `service-desk.ts` with soft delete
- UI: `ServiceDeskPage` (list/filter/search/CSV export) + `ServiceCaseDetailPage`
- Status lifecycle: new → open → waiting_customer → waiting_internal → resolved → closed → escalated
- Source tracking: web | email | phone | chat | portal (enum only; no inbound integrations)
- Case numbering: auto-mint `CS-#####`

### Gap List

| #   | Gap                                                                                                | Severity |
| --- | -------------------------------------------------------------------------------------------------- | -------- |
| 1   | No **Email-to-Case** (inbound email parsing + thread attachment)                                   | Critical |
| 2   | No **Web-to-Case** (public case submission forms)                                                  | High     |
| 3   | No **Chat-to-Case** (live chat transcript → case)                                                  | High     |
| 4   | No **Case Feed** (chronological activity stream with email, tasks, events) — only generic Comments | High     |
| 5   | No **Case Assignment Rules** (auto-assign by criteria; only manual owner)                          | Critical |
| 6   | No **Escalation Rules** (time-based auto-escalate on SLA breach)                                   | Critical |
| 7   | No **Case Teams** (multiple collaborators per case)                                                | Medium   |
| 8   | No **Case Merge / Split**                                                                          | Medium   |
| 9   | No **Auto-response rules** (acknowledgment emails)                                                 | Medium   |

### Effort Estimate

**XL** — Email-to-case alone requires email ingestion service (IMAP/SES); assignment/escalation engines are new

### Dependency Map

- Email service integration (SES/Exchange) → Email-to-Case
- Workflow engine (existing) → Assignment/Escalation rule actions
- Comment/Activity schemas (existing) → Case Feed
- Public auth-less pages → Web-to-Case

### Recommended Priority

**P1** — Case management without assignment/escalation is not enterprise-ready.

---

## 6. Service Cloud — Omni-Channel Routing

### Current State

- **No omni-channel infrastructure** exists
- Cases are assigned to a single `ownerId` (user) manually or via basic `LeadRoutingRule` (lead-only)
- No queue abstraction for cases

### Gap List

| #   | Gap                                                                      | Severity |
| --- | ------------------------------------------------------------------------ | -------- |
| 1   | No **Omni-Channel Presence** (agent availability / workload)             | Critical |
| 2   | No **Skills-Based Routing** (route by language, product expertise, cert) | Critical |
| 3   | No **Capacity-Based Routing** (agent workload caps)                      | High     |
| 4   | No **Priority-Based Routing** (VIP / SLA tier插队)                       | High     |
| 5   | No **Case Queues** (group ownership + pull-based assignment)             | Critical |
| 6   | No **Push vs Pull routing modes**                                        | Medium   |

### Effort Estimate

**XL** — New presence system, queue schema, routing engine, and agent workspace UI

### Dependency Map

- ServiceCase schema (existing) → queue/capacity fields
- UserPresence (existing) → extend with workload/capacity
- Real-time layer (new) → push notifications to agents
- Case Assignment Rules (new, P1) → queue-based assignment logic

### Recommended Priority

**P2** — Required for enterprise service scale, but depends on Case Assignment Rules (P1).

---

## 7. Service Cloud — Knowledge Base & Self-Service

### Current State

- **No Knowledge Article model** or UI
- No customer portal or community functionality
- `Document` and `Note` tables exist but are internal-only (opportunity-scoped)
- `FileAttachment` exists but is internal CRM file storage

### Gap List

| #   | Gap                                                                           | Severity |
| --- | ----------------------------------------------------------------------------- | -------- |
| 1   | No **Knowledge Article** object (title, body, category, keywords, visibility) | Critical |
| 2   | No **Article Versioning** (draft/publish/archive lifecycle)                   | High     |
| 3   | No **Customer Portal** (authenticated customer access to cases + articles)    | Critical |
| 4   | No **Community / Forums** (customer-to-customer Q&A)                          | Medium   |
| 5   | No **Article Suggestions** in case creation (AI/similarity search)            | Medium   |
| 6   | No **Deflection metrics** (cases avoided via self-service)                    | Medium   |

### Effort Estimate

**XL** — Customer portal is a separate auth domain + CMS-like article system

### Dependency Map

- Auth/Clerk (existing) → portal SSO / customer identity
- Search infra (GIN trigram exists) → article search
- Document storage (existing) → article attachments
- ServiceCase (existing) → deflection tracking

### Recommended Priority

**P2** — Important for service scale, but lower than core case routing.

---

## 8. Service Cloud — Service Console & SLAs

### Current State

- **ServiceDeskPage** lists cases with filters; detail page exists
- `slaDeadline` field on `ServiceCase` (date only; no milestone breakdown)
- `satisfaction` field (1–5) for post-resolution CSAT
- No entitlement model, no SLA milestone tracking, no macros

### Gap List

| #   | Gap                                                                                 | Severity |
| --- | ----------------------------------------------------------------------------------- | -------- |
| 1   | No **Unified Agent Console** (split-pane: case list + detail + knowledge + related) | High     |
| 2   | No **Entitlements** (support contracts with terms: cases/year, hours, channels)     | Critical |
| 3   | No **SLA Milestones** (first response time, resolution time by priority)            | Critical |
| 4   | No **SLA Violation Tracking** (breach alerts + escalation)                          | Critical |
| 5   | No **Macros** (one-click case updates + email templates)                            | High     |
| 6   | No **Quick Text / Templates** for agents                                            | Medium   |
| 7   | No **Case Hierarchy** (parent/child cases)                                          | Medium   |

### Effort Estimate

**L** — SLA milestones + entitlements are schema + timer logic; console is UI layout work

### Dependency Map

- ServiceCase schema (existing) → add entitlementId, parentId
- Workflow engine (existing) → SLA breach actions
- Email service (new) → macro email sends
- Knowledge base (new, P2) → console knowledge pane

### Recommended Priority

**P1** — SLAs are non-negotiable for enterprise service contracts.

---

## 9. Analytics — Report Builder & Types

### Current State

- **ReportsPage** shows 4 pre-built report tabs: Pipeline, Leads, Service Desk, Tasks
- Pipeline report: groupBy stage with value sums, weighted pipeline, velocity (avg days open)
- Lead report: byStatus, bySource, conversion rate, avg score
- Service Desk report: byStatus, byPriority, resolved this month, avg satisfaction
- Task report: byStatus, overdue, completion rate
- **Sales Intelligence Report** (`sales-intelligence.service.ts`): monthly sales, top products/categories, team performance, territory breakdown, win/loss, pipeline by stage
- No user-defined reports; no builder UI

### Gap List

| #   | Gap                                                                       | Severity |
| --- | ------------------------------------------------------------------------- | -------- |
| 1   | No **Drag-and-Drop Report Builder**                                       | Critical |
| 2   | No **Custom Report Types** (base object + related objects)                | Critical |
| 3   | No **Matrix Reports** (cross-tab rows × columns)                          | High     |
| 4   | No **Joined Reports** (multiple report blocks)                            | High     |
| 5   | No **Cross-Filters** (e.g., accounts WITH opportunities)                  | High     |
| 6   | No **Bucketing** (group numeric ranges, picklist buckets)                 | Medium   |
| 7   | No **Report Formulas** (custom calculated columns)                        | Medium   |
| 8   | No **Report Scheduling / Export** (only manual CSV export on ServiceDesk) | High     |

### Effort Estimate

**XL** — Report builder is a major product surface; matrix/joined require query engine rework

### Dependency Map

- Query builder abstraction over Prisma (new) → custom reports
- UI drag-and-drop grid (new or library) → builder UX
- Export service (existing CSV) → scheduled PDF/Excel
- Permissions/RBAC (existing) → row-level report security

### Recommended Priority

**P1** — Enterprise buyers expect self-service reporting; pre-built-only is a deal-breaker at scale.

---

## 10. Analytics — Dashboards & Subscriptions

### Current State

- **DashboardWidget** table: kind, title, x, y, w, h, config JSON
- Default widgets: pipeline_funnel, revenue_forecast, company_grid, ai_insights_feed, activity_timeline
- `OrgDashboard` + `AccountCockpitPage` render widget grid
- Widget persistence via `/crm/widgets` PATCH
- Dashboard is account-scoped (cockpit) and org-scoped
- No real-time updates (React Query polling only)

### Gap List

| #   | Gap                                                                     | Severity |
| --- | ----------------------------------------------------------------------- | -------- |
| 1   | No **Scheduled Email Delivery** of dashboards/reports                   | High     |
| 2   | No **Subscriptions** (user subscribes to report/dashboard, gets digest) | High     |
| 3   | No **Real-Time Components** (live KPIs via WebSocket/SSE)               | Medium   |
| 4   | No **Dynamic Dashboard Filters** (date range, owner, territory)         | Medium   |
| 5   | No **Dashboard Sharing** (private vs public vs role-based)              | Medium   |
| 6   | No **Mobile-Optimized Dashboard Layout**                                | Low      |

### Effort Estimate

**M** — Subscriptions need email queue + scheduler; real-time needs push layer

### Dependency Map

- Email service (existing workflows can send_email) → scheduled digests
- BullMQ (existing) → subscription job queue
- WebSocket/SSE (new) → real-time components
- DashboardWidget schema (existing) → add filter configs

### Recommended Priority

**P2** — Valuable for engagement, but lower than report builder (P1).

---

## 11. Analytics — Advanced Analytics / BI

### Current State

- **PredictiveScore** table: targetType, targetId, kind, score (0–10000 bps), confidence, features, modelVersion
- Kinds: `win_probability`, `churn_risk`, `deal_velocity`, `optimal_price`, `lead_score`
- Heuristic engine in `predictive.ts`: stage-based win probability, static stubs for churn/lead
- AI Insights feed (`AiInsight` table) shows deal stagnation, upsell signals (rule-based + Dust)
- No embedded BI tool, no external data warehouse integration for analytics

### Gap List

| #   | Gap                                                                                | Severity |
| --- | ---------------------------------------------------------------------------------- | -------- |
| 1   | No **Tableau CRM / Einstein Analytics equivalent** (embedded BI with lens/explore) | Critical |
| 2   | No **Predictive Model Training Pipeline** (currently heuristic only)               | High     |
| 3   | No **External Data Ingestion** for analytics (Snowflake/BigQuery connector)        | High     |
| 4   | No **AI-Powered Insights** beyond basic stagnation rules (no anomaly detection)    | Medium   |
| 5   | No **Natural Language Query** ("show me pipeline by region")                       | Medium   |
| 6   | No **Data Discovery / Auto-Profiling**                                             | Low      |

### Effort Estimate

**XL** — Embedded BI is a multi-quarter build-or-buy decision

### Dependency Map

- PredictiveScore schema (existing) → train real models
- ML pipeline (new) → model training/deployment
- Data warehouse connector (new) → external BI
- Dust/AI agents (existing) → NLQ prototype

### Recommended Priority

**P3** — Differentiating but expensive; heuristic scoring suffices for MVP. Evaluate buy (embed Metabase/Looker) vs build.

---

## 12. Analytics — Historical Trending & Forecast Analytics

### Current State

- **Forecast** table: ownerId, period (2026-Q2 / 2026-05), category (pipeline/best_case/commit/closed), amountMicros
- `ForecastsPage`: editable grid with stacked bar chart; manual entry only
- No automated forecast rollup from opportunities
- No field-level history trending

### Gap List

| #   | Gap                                                                            | Severity |
| --- | ------------------------------------------------------------------------------ | -------- |
| 1   | No **Field Historical Trending** (snapshot opportunity amount/stage over time) | Critical |
| 2   | No **Forecast vs Actual** auto-comparison (actuals from closed-won opps)       | Critical |
| 3   | No **Pipeline Waterfall Chart** (slipped, pulled forward, new, closed)         | High     |
| 4   | No **Quota Management** (target amounts per rep/period)                        | High     |
| 5   | No **Forecast Adjustments Log** (who changed what, when)                       | Medium   |
| 6   | No **In-Forecast Coaching** (AI suggestions to improve commit accuracy)        | Medium   |

### Effort Estimate

**L** — Field trending requires snapshot table + scheduled job; waterfall is aggregation logic

### Dependency Map

- Opportunity schema (existing) → snapshot on change
- Forecast schema (existing) → add quota, adjustment log
- Scheduled job (BullMQ existing) → nightly snapshotting
- Reporting UI (existing) → waterfall chart component

### Recommended Priority

**P1** — Forecasting without actuals comparison is just a spreadsheet. Pipeline waterfall is essential for sales leadership.

---

## Executive Summary

| Domain                                 | Priority | Effort | Readiness |
| -------------------------------------- | -------- | ------ | --------- |
| 1. Activity & Collaboration            | P1       | M      | 40%       |
| 2. Marketing: Campaign Management      | P1       | XL     | 0%        |
| 3. Marketing: Lead Scoring & Routing   | P1       | L      | 35%       |
| 4. Marketing: Attribution              | P2       | L      | 0%        |
| 5. Service: Case Management            | P1       | XL     | 30%       |
| 6. Service: Omni-Channel               | P2       | XL     | 0%        |
| 7. Service: Knowledge Base             | P2       | XL     | 0%        |
| 8. Service: Console & SLAs             | P1       | L      | 20%       |
| 9. Analytics: Report Builder           | P1       | XL     | 15%       |
| 10. Analytics: Dashboard Subscriptions | P2       | M      | 40%       |
| 11. Analytics: Advanced BI             | P3       | XL     | 15%       |
| 12. Analytics: Trending & Forecast     | P1       | L      | 30%       |

### Highest-Impact, Lowest-Effort Wins

1. **SLA Milestones + Entitlements** (Domain 8, P1, L) — schema + timer logic; huge enterprise value
2. **Field Historical Trending + Forecast vs Actual** (Domain 12, P1, L) — nightly snapshot job + chart
3. **Lead Scoring Rules Engine** (Domain 3, P1, L) — extend heuristic `predictive.ts` with configurable rules
4. **Dashboard Subscriptions** (Domain 10, P2, M) — reuse email workflow + BullMQ

### Critical Path for Enterprise Parity

1. **Campaign Management** (Domain 2) unlocks Marketing Cloud parity
2. **Case Assignment + Escalation + SLA** (Domains 5 & 8) unlocks Service Cloud parity
3. **Report Builder** (Domain 9) unlocks self-service analytics parity
4. **Omni-Channel + Knowledge** (Domains 6 & 7) required for large service teams

---

_End of audit._
