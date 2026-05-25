# BidStack 360° vs Salesforce — 10-Domain Capability Gap Audit

**Audited:** 2026-05-23  
**Scope:** Sales Force Automation (3), Account Management (3), Contact Management (2), Activity & Collaboration (2)  
**Sources:** `packages/db/prisma/schema.prisma`, `apps/api/src/routes/`, `apps/api/src/services/`, `apps/web/src/pages/`

---

## 1. Sales Force Automation — Forecasting & Quota

### Current State
- **`Forecast` model** exists with four categories: `pipeline`, `best_case`, `commit`, `closed`.
- Period granularity supports `"2026-Q2"` or `"2026-05"` strings; grouped by `ownerId`.
- **ForecastsPage** UI allows manual cell-level entry per owner / period / category.
- Chart visualisation (stacked bars) aggregates forecasts by period.
- No automated rollup from opportunity probability × stage values.

### Gap List
| # | Gap | Severity |
|---|-----|----------|
| 1.1 | **No Quota Management** — No `Quota` model or target-setting UI. Salesforce has quotas per rep, per period, with attainment % tracking. | **Critical** |
| 1.2 | **No Forecast Hierarchy / Rollups** — Forecasts are flat per-user. No manager rollup, no territory-level forecast, no override capability. | **Critical** |
| 1.3 | **Manual-only Entry** — Forecasts are typed in by hand. No auto-sync from pipeline value × probability or from `pipelineStage.forecastCategory`. | **High** |
| 1.4 | **No Forecast Adjustments & History** — No audit trail of who changed a forecast and why; no adjustment notes or versioning. | **High** |
| 1.5 | **No Split Forecasting** — Opportunities cannot have split credit across multiple reps (e.g. 60/40). | **High** |
| 1.6 | **No AI/ML Forecasting** — Predictive scores exist (`PredictiveScore` model) but are not wired into forecast recommendations or trend analysis. | **Medium** |
| 1.7 | **No Forecast Category Auto-mapping** — New `PipelineStage.forecastCategory` field exists but routes still use legacy `Opportunity.stage` enum; no automatic category assignment. | **Medium** |

### Effort Estimate
**L** — Requires new `Quota` table, hierarchy rollup engine, manager-override API, and significant UI work.

### Dependency Map
- Depends on **Domain 5 (Territory Management)** for territory-level rollups.
- Depends on **Domain 2 (Pipeline Inspection)** for accurate stage-to-forecast-category mapping.
- Depends on RBAC (`roles` / `userRoles`) for manager-rep hierarchy (currently basic).

### Recommended Priority
**P0** — Forecasting is a board-level requirement for any enterprise CRM. The current manual table is insufficient at scale.

---

## 2. Sales Force Automation — Pipeline Inspection

### Current State
- **Opportunity** has `stage` (legacy enum) + `pipelineStageId` (new FK to `PipelineStage`).
- `STAGE_TRANSITIONS` map enforces allowed moves in `opportunities.ts`.
- `Pipeline` and `PipelineStage` tables support custom stages, probability, forecast category, colour.
- `PipelinePage` and `OpportunitiesPage` provide list/kanban views.
- `funnel.service.ts` provides KPIs: by-stage counts, weighted pipeline, avg days open, closed-this-quarter.

### Gap List
| # | Gap | Severity |
|---|-----|----------|
| 2.1 | **Pipeline Inspection View Missing** — No dedicated inspection screen showing hover-cards per deal (last activity, stakeholder engagement, deal age vs avg). | **Critical** |
| 2.2 | **Stage History / Audit Trail** — No `OpportunityStageHistory` table. Cannot see when a deal moved stages, who moved it, or how long it spent in each stage. | **Critical** |
| 2.3 | **Path / Guided Selling** — No stage-entry/exit criteria, no required fields per stage, no next-best-action prompts. | **High** |
| 2.4 | **Pipeline Flow / Velocity Analytics** — `funnel.service.ts` gives aggregate avg days open only. No cohort-based velocity, no stage-duration breakdown, no conversion rate by stage. | **High** |
| 2.5 | **Deal Warnings / Health Scores** — No automated alerts for stagnant deals, no engagement-gap detection, no deal-risk scoring in UI. | **High** |
| 2.6 | **Legacy Enum Still Primary** — Routes and logic use `OpportunityStage` enum; `pipelineStageId` is nullable and not enforced. Migration incomplete. | **Medium** |
| 2.7 | **No Pipeline Sharing Rules** — All opportunities visible within org; no private/team-scoped pipelines. | **Medium** |

### Effort Estimate
**L** — Stage history table + pipeline inspection UI + guided selling engine.

### Dependency Map
- Depends on **Domain 10 (Calendar & Meeting Intelligence)** for activity-gap detection.
- Depends on **Domain 6 (Account Teams)** for deal-team visibility.

### Recommended Priority
**P0** — Pipeline inspection is core SFA; without stage history, sales leadership cannot diagnose slippage.

---

## 3. Sales Force Automation — Products, Price Books & CPQ

### Current State
- **`Product`** (SKU, name, list price, currency, active flag) + **`ProductCategory`** (hierarchical via `parentId`).
- **`SalesOrder`** / **`SalesOrderLine`** mirror Odoo (draft → sent → confirmed → done → cancelled).
- **`Quote`** / **`QuoteLine`** / **`QuoteVersion`** exist (draft → sent → accepted → rejected → expired) with immutable version snapshots.
- `ProductsPage` provides CRUD UI.
- `SalesOrdersPage`, `SalesDashboardPage` show order KPIs.

### Gap List
| # | Gap | Severity |
|---|-----|----------|
| 3.1 | **No Price Books** — `Product.listPriceMicros` is a single global price. No customer-specific, volume-tiered, or seasonal price books. | **Critical** |
| 3.2 | **No Product Bundles / Configurator** — Cannot define bundles with component options, constraints, or dependent selections. | **Critical** |
| 3.3 | **No Discount Approval Workflow** — Quote lines allow `discountPct` but no approval gates for thresholds (e.g. >10% needs manager). | **High** |
| 3.4 | **No Contract Lifecycle (CPQ→Contract)** — Quotes convert to SalesOrders but no contract generation, signature integration, or renewal management. | **High** |
| 3.5 | **No Product Recommendations** — No upsell/cross-sell suggestions based on account history or ML. | **Medium** |
| 3.6 | **Quote ↔ Opportunity Link Weak** — `Quote.opportunityId` exists but no automatic value rollup to opportunity; no quote-stage gating. | **Medium** |
| 3.7 | **No Multi-Currency Price Conversion** — `ExchangeRates` route exists but not wired into quote/order line pricing. | **Medium** |

### Effort Estimate
**XL** — Price books, bundles, and discount approvals are a full CPQ module.

### Dependency Map
- Depends on **Domain 1 (Forecasting)** for opportunity value rollup from quotes.
- Depends on **Workflow** engine (already present) for discount approvals.

### Recommended Priority
**P1** — Core for product-selling orgs; defer if services-only initially.

---

## 4. Account Management — Account Hierarchy & Planning

### Current State
- **`Company`** is the first-class account entity (name, domain, industry, employee count, address, tier, logo).
- `tier` enum: `key` | `top` | `standard`.
- `keyAccountOwnerId` links a single user; `keyAccountSince` / `keyAccountNotes` exist.
- `AccountCockpitSnapshot` aggregates opportunities, contacts, notes, files, orders per company.
- `KeyAccountsPage` and `TopAccountsPage` list flagged / revenue-ranked accounts.

### Gap List
| # | Gap | Severity |
|---|-----|----------|
| 4.1 | **No Parent/Child Hierarchy** — `Company` has no `parentId`. Cannot model subsidiaries, divisions, or global accounts. | **Critical** |
| 4.2 | **No Account Plans** — No structured account-planning document (objectives, strategies, SWOT, growth targets). | **High** |
| 4.3 | **No Whitespace Analysis** — No visual matrix of products sold vs products available per account. | **High** |
| 4.4 | **No Account Scorecards** — No composite health/growth/churn score per account in UI. | **High** |
| 4.5 | **No Relationship Map** — No graphical org-chart of contacts and their influence relationships. | **Medium** |
| 4.6 | **No Account Segmentation Engine** — Tier is manual only; no automated scoring into segments. | **Medium** |

### Effort Estimate
**L** — Hierarchy is a schema + UI change; account plans are a new document model.

### Dependency Map
- Depends on **Domain 3 (Products)** for whitespace analysis.
- Depends on **Domain 7 (Contact Hierarchies)** for relationship maps.

### Recommended Priority
**P0** — Account hierarchy is table-stakes for B2B enterprise; without it, rollup reporting is impossible.

---

## 5. Account Management — Territory Management

### Current State
- **`Territory`** model: name, `countryCodes[]`, `region`, `postalCodes[]`, `ownerId`, `active`.
- `TerritoriesPage` provides CRUD + map visualisation (react-simple-maps with A2→A3 mapping).
- Auto-assignment: opportunities auto-link to territory via `country` → `Territory.countryCodes`.
- **`LeadRoutingRule`** model: criteria JSON, assign to user/territory, round-robin team array.

### Gap List
| # | Gap | Severity |
|---|-----|----------|
| 5.1 | **No Territory Hierarchy** — Territories are flat. No region → area → territory tree; no rollup of quotas or forecasts. | **Critical** |
| 5.2 | **No Territory Balancing** — No metrics on account/opportunity load per territory; no redistribution UI. | **High** |
| 5.3 | **No Overlay / Specialist Territories** — A territory has one `ownerId`; no support for overlay roles (SE, CSM, partner rep). | **High** |
| 5.4 | **No Territory Forecasting** — Forecasts roll up by user only, not by territory. | **High** |
| 5.5 | **Lead Routing Rules Basic** — Criteria are opaque JSON; no visual rule builder, no A/B testing, no fallback chains. | **Medium** |
| 5.6 | **No Account→Territory Many-to-Many** — `Company` has no territory link; assignment is only via opportunity `country`. | **Medium** |

### Effort Estimate
**L** — Hierarchy needs recursive territory table; balancing needs analytics UI.

### Dependency Map
- Depends on **Domain 1 (Forecasting)** for territory-level forecast rollups.
- Depends on **Domain 4 (Account Hierarchy)** for account-to-territory alignment.

### Recommended Priority
**P1** — Critical for multi-region sales orgs; acceptable for single-region initially.

---

## 6. Account Management — Account Teams & Enrichment

### Current State
- **Enrichment** is strong: `CompanyEnrichment` stores registry IDs, revenue, employee count, logos, source attribution. Apollo enrichment queue exists.
- `keyAccountOwnerId` on `Company` for single owner.
- `AccountSolution` and `AccountProduct` extracted per account via LLM.
- AI insights (`AiInsight` model) generated per account/opportunity.

### Gap List
| # | Gap | Severity |
|---|-----|----------|
| 6.1 | **No Account Team Model** — Only one `keyAccountOwnerId`. No `AccountTeamMember` table with roles (Account Manager, SE, CSM, Legal). | **Critical** |
| 6.2 | **No Team-based Permissions** — Because there are no teams, opportunity/account visibility cannot be scoped to team members. | **Critical** |
| 6.3 | **No Explicit Account Planning Collaboration** — No shared account plan with @mentions, assignments, and deadlines tied to the account. | **High** |
| 6.4 | **Enrichment Not Auto-refreshed** — `cacheExpiresAt` exists but no scheduled refresh job observed. | **Medium** |
| 6.5 | **No Buyer Intent Integration** — Enrichment is firmographic only; no intent data (e.g. Bombora, 6sense) ingestion. | **Medium** |

### Effort Estimate
**M** — New `AccountTeamMember` junction table + permission filtering in routes.

### Dependency Map
- Depends on RBAC (`roles` / `userRoles`) for permission scaffolding.
- Depends on **Domain 10 (Activity)** for team collaboration timeline.

### Recommended Priority
**P0** — Enterprise deals require cross-functional account teams; single-owner model breaks at scale.

---

## 7. Contact Management — Hierarchies & Roles

### Current State
- **`Contact`** has name, role, email, phone, influence (1-100), sentiment, `companyId`.
- **`OpportunityContact`** junction supports per-opportunity roles: `decision_maker | influencer | blocker | champion | stakeholder`, plus `isPrimary`, influence, sentiment, notes.
- `ContactsPage` and `ContactDetailPage` provide CRUD.

### Gap List
| # | Gap | Severity |
|---|-----|----------|
| 7.1 | **No Contact Hierarchy (Reports-To)** — No `reportsToId` or org-chart navigation. Cannot model chains of command. | **Critical** |
| 7.2 | **No Buying Center Visualization** — Opportunity contacts are a list, not a visual decision-unit map with influence lines. | **High** |
| 7.3 | **No Contact Scoring** — `influence` is manual entry only. No automated engagement-score or lead-to-contact scoring history. | **High** |
| 7.4 | **No Contact Duplicate Management** — No fuzzy matching or merge UI for duplicate contacts. | **High** |
| 7.5 | **No Contact Lifecycle Tracking** — No tracking of contact movement between companies (previous employers). | **Medium** |
| 7.6 | **No Mass Contact Operations** — No import, update, or reassignment in bulk. | **Medium** |

### Effort Estimate
**M** — Reports-to is a self-referencing FK; buying-center UI is medium complexity.

### Dependency Map
- Depends on **Domain 8 (Social Data)** for external org-chart enrichment.
- Depends on **Domain 10 (Activity)** for engagement-based contact scoring.

### Recommended Priority
**P1** — Important for complex sales; reports-to is the highest-value gap.

---

## 8. Contact Management — Social Data & Multi-Account

### Current State
- Contacts are scoped to one `companyId` (nullable).
- No social profile fields (LinkedIn, Twitter/X) in schema.
- No social listening or engagement data ingestion.
- `IntegrationConfig` supports `salesforce`, `odoo`, `microsoft` only.

### Gap List
| # | Gap | Severity |
|---|-----|----------|
| 8.1 | **No Social Profile Enrichment** — No LinkedIn URL, Twitter handle, or social bio stored on Contact. | **High** |
| 8.2 | **No Multi-Account Contact Support** — A contact can only belong to one `companyId`. In reality, advisors, partners, and movers sit across multiple accounts. | **High** |
| 8.3 | **No Social Listening / Intent** — No integration with social platforms for mention tracking or intent signals. | **Medium** |
| 8.4 | **No Email Engagement Analytics** — Even if email sync existed, no open/click/reply tracking schema fields. | **Medium** |

### Effort Estimate
**M** — Social fields are schema additions; multi-account needs a junction table.

### Dependency Map
- Depends on **Domain 9 (Email Integration)** for engagement analytics data.
- Depends on enrichment provider (Apollo) for social profile data.

### Recommended Priority
**P2** — Nice-to-have for initial enterprise launch; multi-account is edge-case for many B2B models.

---

## 9. Activity & Collaboration — Email Integration

### Current State
- **`Activity`** model supports `email` type (polymorphic `entityType`/`entityId`).
- **`Microsoft 365 integration routes`** exist (`microsoft.ts`) but are **placeholders**:
  - `POST /settings/microsoft/connect` returns a hardcoded auth URL with `client_id=PLACEHOLDER`.
  - `disconnect` only flips a JSON flag.
  - No actual Graph API sync, no email ingestion, no send capability.
- `User.microsoftAccountJson` stores connection status.

### Gap List
| # | Gap | Severity |
|---|-----|----------|
| 9.1 | **No Email Sync (Ingestion)** — No Microsoft Graph or Gmail API integration to sync sent/received emails into Activity timeline. | **Critical** |
| 9.2 | **No Email Templates** — No template library, no merge fields, no shared team templates. | **High** |
| 9.3 | **No Send-from-CRM** — Cannot compose or send email from within BidStack. | **High** |
| 9.4 | **No Email Tracking** — No read receipts, link tracking, or reply detection. | **High** |
| 9.5 | **No Engagement Scoring from Email** — Cannot compute contact engagement from email velocity. | **Medium** |
| 9.6 | **No BCC-to-CRM** — No dropbox address for logging external emails. | **Medium** |
| 9.7 | **No Email Threading** — Activities are single records; no thread grouping or conversation view. | **Medium** |

### Effort Estimate
**XL** — Full email sync (OAuth, delta sync, threading, send pipeline) is major infrastructure.

### Dependency Map
- Depends on Microsoft Entra ID / OAuth infrastructure (partially present).
- Depends on **Domain 10 (Calendar)** for shared Graph API token lifecycle.

### Recommended Priority
**P0** — Email is the primary sales communication channel; placeholder status is a major enterprise gap.

---

## 10. Activity & Collaboration — Calendar & Meeting Intelligence

### Current State
- **`Activity`** model supports `meeting` type with `startTime`, `endTime`, `status`, attendees via `ActivityAttendee`.
- **`UserPresence`** model tracks who is online and which record they are viewing.
- **`Comment`** and **`Mention`** models provide threaded discussions on any record.
- Microsoft calendar routes are **placeholders** (same as email).

### Gap List
| # | Gap | Severity |
|---|-----|----------|
| 10.1 | **No Calendar Sync** — No bidirectional sync with Outlook/Google Calendar. Meetings must be created manually in BidStack. | **Critical** |
| 10.2 | **No Meeting Prep Cards** — No auto-generated brief before a meeting (account summary, last touch, open deals). | **High** |
| 10.3 | **No Transcription / Recording** — No integration with Zoom/Teams to import transcripts or recordings. | **High** |
| 10.4 | **No Action Item Extraction** — No AI extraction of follow-ups from meeting descriptions or transcripts. | **High** |
| 10.5 | **No Attendee Response Tracking** — `ActivityAttendee.responseStatus` exists but is static; no sync with calendar invites. | **Medium** |
| 10.6 | **No Availability Scheduling** — No "book a meeting" link or shared availability view. | **Medium** |
| 10.7 | **No Recurring Meeting Support** — Activity model has no recurrence rules. | **Low** |

### Effort Estimate
**XL** — Calendar sync is comparable to email sync in complexity; meeting intelligence adds AI layers.

### Dependency Map
- Depends on **Domain 9 (Email Integration)** for shared OAuth token management.
- Depends on Dust/AI services for transcription summarisation and action extraction.

### Recommended Priority
**P1** — Critical for productivity but slightly less urgent than email; can be partially mitigated by manual activity logging.

---

## Cross-Cutting Observations

| Theme | Observation | Impact |
|-------|-------------|--------|
| **Schema Maturity vs Route Maturity** | New tables (`Pipeline`, `PipelineStage`, `Quote`, `QuoteVersion`, `Forecast`) exist in schema but routes/UI still lean on legacy patterns (enum stages, manual forecasts). | Medium — data model is ahead of controllers. |
| **Microsoft Integration** | Routes are scaffolded but all Graph API calls are placeholders (`client_id=PLACEHOLDER`). | High — blocks Domains 9 and 10. |
| **RBAC** | `Role` / `Permission` / `UserRole` / `RolePermission` tables exist but are lightly used; most routes rely on `requirePermission` middleware without fine-grained record-level access. | High — blocks enterprise security requirements. |
| **Enrichment** | Strong — Apollo queue, Dust-powered document extraction, CompanyEnrichment cache. This is a differentiator, not a gap. | Positive |
| **Custom Fields** | Mature engine (`CustomFieldDefinition` + `CustomFieldValue`) supports 11 field types across 6 entity types. | Positive |
| **Workflow Engine** | `Workflow` / `WorkflowAction` / `WorkflowRun` support 8 action kinds including `run_dust_agent`. Can be leveraged for discount approvals, follow-ups, etc. | Positive |

---

## Summary Matrix

| Domain | P0 Gaps | P1 Gaps | Effort | Priority |
|--------|---------|---------|--------|----------|
| 1. Forecasting & Quota | Quota, hierarchy, auto-rollup | AI forecasting, adjustments | L | **P0** |
| 2. Pipeline Inspection | Inspection view, stage history | Path, velocity analytics | L | **P0** |
| 3. Products & CPQ | Price books, bundles | Discount approvals, contract lifecycle | XL | **P1** |
| 4. Account Hierarchy | Parent/child hierarchy | Account plans, whitespace | L | **P0** |
| 5. Territory Mgmt | — | Hierarchy, balancing, overlay | L | **P1** |
| 6. Account Teams | Account team model, permissions | Planning collaboration | M | **P0** |
| 7. Contact Hierarchies | — | Reports-to, buying center, dedup | M | **P1** |
| 8. Social & Multi-Acct | — | Social profiles, multi-account | M | **P2** |
| 9. Email Integration | Full sync, send, templates, tracking | Engagement scoring, BCC | XL | **P0** |
| 10. Calendar & Meetings | Calendar sync | Meeting prep, transcription, actions | XL | **P1** |

**Immediate Recommendations (next 90 days):**
1. Complete the `PipelineStage` migration (replace enum usage in routes).
2. Implement `AccountTeamMember` junction table + record-level permission filtering.
3. Add `Company.parentId` self-relation and recursive query APIs.
4. Replace Microsoft placeholder routes with real Graph OAuth + delta sync for email and calendar.
5. Build `OpportunityStageHistory` audit table and pipeline inspection UI.
6. Introduce `Quota` model and wire forecast auto-rollup from opportunity probability.
