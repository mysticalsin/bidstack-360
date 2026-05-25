# Audit Report: Opportunity Management Depth
**Agent:** A4 (Sales Force Automation)  
**Date:** 2026-05-23  
**Scope:** BidStack 360° Opportunity Management vs Salesforce Enterprise  
**Files Audited:**
- `packages/db/prisma/schema.prisma` (2,697 lines)
- `apps/api/src/routes/opportunities.ts` (600 lines)
- `apps/api/src/routes/opportunity-contacts.ts` (194 lines)
- `apps/api/src/routes/opportunity-timeline.ts` (128 lines)
- `apps/api/src/routes/workflows.ts`
- `apps/web/src/pages/OpportunityDetailPage.tsx` (489 lines)
- `apps/web/src/components/opportunity/OpportunityTabs.tsx` (403 lines)
- `apps/web/src/components/settings/PipelineStagesSection.tsx` (108 lines)
- `packages/shared/src/schemas/opportunity.ts`
- `packages/shared/src/schemas/opportunity-contact.ts`
- `packages/shared/src/schemas/intel.ts`
- `packages/shared/src/schemas/crm.ts` (WinLossStats, PipelineStageSnapshot)
- `packages/shared/src/schemas/workflow.ts`

---

## 1. Current State — What BidStack Has

### ✅ Core Opportunity Entity
| Capability | Status | Evidence |
|-----------|--------|----------|
| Basic fields (name, value, stage, probability, due date) | **Implemented** | `Opportunity` model + full CRUD API |
| Single owner assignment | **Implemented** | `ownerId` FK → `User`, resolved by email in routes |
| Territory auto-assignment | **Implemented** | Country → Territory lookup on create/patch |
| Custom fields | **Implemented** | `CustomFieldDefinition` + `CustomFieldValue` generic system |
| Soft delete | **Implemented** | `deletedAt` tombstone pattern across all entities |
| Audit logging | **Implemented** | `AuditLog` table records create/update/delete/stage changes |
| Code generation | **Implemented** | `OP-NNNN` sequential minting with retry loop |
| Import (CSV/bulk) | **Implemented** | `POST /opportunities/import` up to 500 rows |
| Dust integration | **Implemented** | `pushOpportunityToDust()` fire-and-forget on mutations |

### ✅ Opportunity Contacts (Contact Roles — Partial)
| Capability | Status | Evidence |
|-----------|--------|----------|
| Link contacts to opportunities | **Implemented** | `OpportunityContact` junction table |
| Role assignment | **Implemented** | Free-text `role` field with UI dropdown (stakeholder, decision_maker, influencer, champion, blocker) |
| Primary contact flag | **Implemented** | `isPrimary` boolean with auto-demotion logic |
| Influence score | **Implemented** | `influence` Int 1-5 on junction table |
| Sentiment tracking | **Implemented** | `sentiment` enum (hot/warm/neutral/cold) on junction table |
| Notes per link | **Implemented** | `notes` field on `OpportunityContact` |
| Decision Unit panel | **Implemented** | UI merges CRM contacts + Dust intel `decisionUnit` |

### ✅ Stage Transitions (Basic)
| Capability | Status | Evidence |
|-----------|--------|----------|
| Hard-coded stage enum | **Implemented** | `OpportunityStage` enum: s1_lead → closed_won/lost |
| Transition validation | **Implemented** | `STAGE_TRANSITIONS` map in `opportunities.ts` |
| Stage change audit | **Implemented** | `AuditLog` action=`opportunity.stage`, diff={from,to} |
| Pipeline/Stage tables (DB only) | **Partial** | `Pipeline` + `PipelineStage` models exist (Phase 5) but routes still use enum |

### ✅ Timeline / Activity
| Capability | Status | Evidence |
|-----------|--------|----------|
| Unified timeline API | **Implemented** | `opportunity-timeline.ts` merges audit logs, tasks, comments |
| Activity tab | **Implemented** | `OpportunityTabs.tsx` ActivityPanel |

### ✅ Competitive Intelligence (External Only)
| Capability | Status | Evidence |
|-----------|--------|----------|
| Competitor radar card | **Implemented** | `CompetitorRadarCard` in `OpportunityDetailPage.tsx` |
| Data source | **Dust-only** | `IntelPayload.competitors[]` — no CRM-native competitor table |

### ✅ Workflow Automation (Foundation)
| Capability | Status | Evidence |
|-----------|--------|----------|
| Workflow engine | **Implemented** | `Workflow`, `WorkflowAction`, `WorkflowRun` models + routes |
| Triggers | **Implemented** | `record_created`, `record_updated`, `stage_changed`, `schedule`, `webhook_received`, `manual` |
| Actions | **Implemented** | `send_email`, `send_slack`, `create_task`, `update_field`, `call_webhook`, `assign_owner`, `run_dust_agent`, `create_notification` |

### ✅ Win/Loss Reporting (Aggregate Only)
| Capability | Status | Evidence |
|-----------|--------|----------|
| Win/loss dashboard stats | **Implemented** | `WinLossStats` schema + `sales-intelligence.service.ts` |
| Per-opportunity win/loss reason | **Missing** | No field on Opportunity; no `WinLossReason` table |

---

## 2. Gap List — Missing Capabilities vs Salesforce

### Gap 1: Opportunity Teams with Split Credit
**Salesforce Equivalent:** OpportunityTeamMember, OpportunitySplit  
**Current State:** Single `ownerId` on Opportunity. No team concept.  
**Severity:** 🔴 **High** — Enterprise deals always have multi-player teams (AE, SE, CSM, Manager). Single-owner breaks commission reporting and accountability.  
**What's Missing:**
- `OpportunityTeam` / `OpportunityTeamMember` model (user + role + split %)
- API routes for team CRUD
- UI to add/remove team members
- Split credit roll-up to forecasting

**T-Shirt Size:** L  
**Dependencies:** User/Role system (✅ exists), Forecast model (✅ exists)  
**Priority:** P1

---

### Gap 2: Contact Roles — Standardized Picklist & Influence Visualization
**Salesforce Equivalent:** OpportunityContactRole (Economic Buyer, Decision Maker, Technical Buyer, etc.)  
**Current State:** Free-text `role` field with 5 hard-coded options in UI dropdown. Influence is a 1-5 integer with no visualization.  
**Severity:** 🟡 **Medium-High** — Role standardization is critical for MEDDPIC/EB identification and playbook execution. Current free-text allows inconsistency.  
**What's Missing:**
- Org-configurable `ContactRole` reference table (like Salesforce)
- Standard MEDDPIC roles: Economic Buyer, Decision Maker, Technical Buyer, Champion, Blocker, Coach
- Contact influence **visualization** (radar chart, org chart, or power map)
- `OpportunityContact.power` enum exists in `IntelPayload.DecisionMember` but is NOT stored in the DB junction table

**T-Shirt Size:** M  
**Dependencies:** `OpportunityContact` model (✅ exists)  
**Priority:** P1

---

### Gap 3: Competitive Tracking (First-Class CRM Data)
**Salesforce Equivalent:** Competitor object, `Opportunity.Competitor__c`, Win/Loss Reason  
**Current State:** Competitors only exist as ephemeral `IntelPayload.competitors[]` from Dust. No CRM-native competitor table. No win/loss reason capture.  
**Severity:** 🔴 **High** — Win/loss analysis is impossible without structured competitor data tied to closed opportunities. Dust intel is read-only and external.  
**What's Missing:**
- `Competitor` master table (org-scoped)
- `OpportunityCompetitor` junction table (strengths/weaknesses, positioning, threat level)
- `Opportunity.winLossReason` field (enum or reference table)
- `Opportunity.lostToCompetitorId` FK
- UI to manage competitors per opportunity
- Win/Loss report by competitor

**T-Shirt Size:** M  
**Dependencies:** Opportunity CRUD (✅ exists)  
**Priority:** P1

---

### Gap 4: Stage History Audit (Dedicated Table)
**Salesforce Equivalent:** OpportunityFieldHistory (Stage), OpportunityHistory  
**Current State:** Stage changes logged in generic `AuditLog` as `{action: 'opportunity.stage', diff: {from, to}}`. No queryable stage history table. No duration-in-stage analytics.  
**Severity:** 🟡 **Medium** — AuditLog works for compliance but is too generic for pipeline velocity analytics, stage duration reports, or SLA monitoring.  
**What's Missing:**
- `OpportunityStageHistory` table: `opportunityId`, `fromStage`, `toStage`, `changedByUserId`, `enteredAt`, `exitedAt`, `durationSeconds`
- API to query stage history per opportunity
- Pipeline velocity report (avg time per stage)
- Stage SLA alerts ("deal stuck in negotiation > 14 days")

**T-Shirt Size:** M  
**Dependencies:** AuditLog (✅ exists — can backfill), PipelineStage tables (✅ exist)  
**Priority:** P1

---

### Gap 5: Path / Guided Selling
**Salesforce Equivalent:** Sales Path, Path Settings, Stage-specific coaching, Required fields per stage  
**Current State:** No guided selling whatsoever. Stage is a dropdown with no stage-specific validation, coaching, or required field enforcement.  
**Severity:** 🟡 **Medium** — Critical for sales methodology adherence (MEDDPIC, Challenger, SPIN). Prevents premature stage progression.  
**What's Missing:**
- `PipelineStage.coachingTips` text field
- `PipelineStage.requiredFields` JSON (fields that must be populated before stage advance)
- `PipelineStage.exitCriteria` JSON (checkboxes/tasks required)
- API validation on stage transition: check required fields
- UI "Path" component (visual stage progress bar with coaching tips)
- Stage-specific inline validation messages

**T-Shirt Size:** L  
**Dependencies:** PipelineStage table (✅ exists), Custom fields (✅ exists), Opportunity validation logic  
**Priority:** P2

---

### Gap 6: Opportunity Splits (Revenue Attribution)
**Salesforce Equivalent:** OpportunitySplit, OpportunitySplitType  
**Current State:** `valueMicros` is a single number. No split attribution.  
**Severity:** 🟡 **Medium** — Needed for accurate commission and forecasting when multiple reps work one deal.  
**What's Missing:**
- `OpportunitySplit` table: `opportunityId`, `userId`, `splitType` (revenue/overlay/partner), `percentage`, `amountMicros`
- Split validation (must sum to 100%)
- Forecast roll-up by split (not just owner)
- UI split editor on opportunity detail page

**T-Shirt Size:** M  
**Dependencies:** Opportunity team (Gap 1), Forecast model (✅ exists)  
**Priority:** P2

---

### Gap 7: Big Deal Alerts
**Salesforce Equivalent:** Big Deal Alert (workflow alert on opportunity amount threshold)  
**Current State:** No pre-built alert. Workflow engine exists but no UI to configure amount-based alerts. No notification infrastructure for real-time alerts.  
**Severity:** 🟡 **Medium** — Management visibility into large deals is standard enterprise practice.  
**What's Missing:**
- Pre-built "Big Deal Alert" workflow template (trigger: `record_updated` where `valueMicros > threshold`)
- Org-level threshold config in `OrgSettings`
- Real-time notification delivery (in-app + email/Slack)
- Notification inbox / bell integration (UI has `NotificationsBell` but it appears to be a stub)

**T-Shirt Size:** S  
**Dependencies:** Workflow engine (✅ exists), Notification delivery channel  
**Priority:** P2

---

### Gap 8: Pipeline Stage DB Integration
**Salesforce Equivalent:** OpportunityStage (metadata table)  
**Current State:** `Pipeline` + `PipelineStage` tables exist in Prisma schema (Phase 5 migration), BUT:
- All API routes still use hard-coded `OpportunityStage` enum
- `PipelineStagesSection.tsx` reads/writes `localStorage` only — NOT the database
- `Opportunity.pipelineStageId` is nullable and unused by routes
- `OrgSettings.pipelineStages` is a JSON blob, not relational

**Severity:** 🟡 **Medium** — Blocks custom pipeline creation, multi-pipeline support, and Phase 5 completion.  
**What's Missing:**
- Migrate routes from enum to `pipelineStageId`
- Backfill existing opportunities
- Settings UI to CRUD `Pipeline` and `PipelineStage` rows
- Kanban board to use dynamic stages from DB

**T-Shirt Size:** M  
**Dependencies:** Pipeline/PipelineStage tables (✅ exist), Migration plan  
**Priority:** P1

---

### Gap 9: Contact Influence Visualization
**Salesforce Equivalent:** Contact Hierarchy, Influence Map, Relationship Graph  
**Current State:** Influence is a raw 1-5 number in a list. No org-chart visualization, no relationship mapping between contacts, no power map.  
**Severity:** 🟢 **Low-Medium** — Nice-to-have for enterprise deals; current tabular view is functional but not insightful.  
**What's Missing:**
- Relationship graph (who reports to whom, who influences whom)
- Power map visualization (influence × sentiment matrix)
- Contact-to-contact relationship model

**T-Shirt Size:** L  
**Dependencies:** OpportunityContact (✅ exists), graph visualization library  
**Priority:** P3

---

## 3. Effort Estimate Summary

| Gap | T-Shirt | Files Touched | Complexity |
|-----|---------|--------------|------------|
| 1. Opportunity Teams | **L** | Schema + API + UI + Forecast rollup | High |
| 2. Standardized Contact Roles | **M** | Schema + API + UI + Migration | Medium |
| 3. Competitive Tracking | **M** | Schema + API + UI + Reports | Medium |
| 4. Stage History Table | **M** | Schema + API + UI + Analytics | Medium |
| 5. Path / Guided Selling | **L** | Schema + API + UI + Validation | High |
| 6. Opportunity Splits | **M** | Schema + API + UI + Forecast | Medium |
| 7. Big Deal Alerts | **S** | Workflow template + Settings + Notifications | Low |
| 8. Pipeline DB Integration | **M** | API migration + UI + Backfill | Medium |
| 9. Influence Visualization | **L** | New UI components + Graph lib | High |

**Total Effort:** ~3-4 engineer-months for P0/P1 gaps; ~6-8 months for full parity.

---

## 4. Dependency Map

```
┌─────────────────────────────────────────────────────────────┐
│  FOUNDATION (✅ Ready)                                      │
│  • User/Org tenancy, AuditLog, Workflow engine              │
│  • Opportunity CRUD, OpportunityContact junction            │
│  • Pipeline/PipelineStage tables (schema only)              │
│  • Custom fields, Forecast model                            │
└─────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│ Gap 8:        │    │ Gap 4:        │    │ Gap 2:        │
│ Pipeline DB   │───→│ Stage History │    │ Contact Roles │
│ Integration   │    │ (needs stage  │    │ (extends      │
│               │    │  table FK)    │    │  junction)    │
└───────────────┘    └───────────────┘    └───────────────┘
        │                     │                     │
        ▼                     ▼                     ▼
┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│ Gap 5:        │    │ Gap 1:        │    │ Gap 3:        │
│ Guided Selling│    │ Opportunity   │    │ Competitive   │
│ (needs stage  │    │ Teams         │    │ Tracking      │
│  metadata)    │    │               │    │               │
└───────────────┘    └───────┬───────┘    └───────────────┘
                             │
                             ▼
                      ┌───────────────┐
                      │ Gap 6:        │
                      │ Opportunity   │
                      │ Splits        │
                      │ (needs team)  │
                      └───────────────┘
                             │
                             ▼
                      ┌───────────────┐
                      │ Gap 7:        │
                      │ Big Deal      │
                      │ Alerts        │
                      │ (needs value  │
                      │  threshold)   │
                      └───────────────┘
```

---

## 5. Recommended Priority

### P0 — Blockers for Enterprise Sales Team Adoption
*None identified as P0. The product is functional for small teams. Gaps become critical at scale.*

### P1 — High Impact, Needed for Mid-Market/Enterprise
1. **Gap 8: Pipeline DB Integration** — Unlocks custom sales processes. Currently hard-coded stages are a deal-breaker for any org not using the default 7-stage flow.
2. **Gap 1: Opportunity Teams** — Single-owner model fails for complex deals with SEs, SAs, and managers.
3. **Gap 3: Competitive Tracking** — Cannot run win/loss reviews or competitive positioning without CRM-native competitor data.
4. **Gap 4: Stage History** — Required for pipeline velocity, SLA monitoring, and sales coaching.
5. **Gap 2: Standardized Contact Roles** — Needed for MEDDPIC qualification consistency.

### P2 — Important for Sales Excellence
6. **Gap 5: Path / Guided Selling** — Dramatically improves stage adherence and new-rep onboarding.
7. **Gap 6: Opportunity Splits** — Required for accurate commission in team-selling environments.
8. **Gap 7: Big Deal Alerts** — Low effort, high management visibility.

### P3 — Differentiating / Nice-to-Have
9. **Gap 9: Influence Visualization** — Graph visualization is expensive to build and maintain; tabular view suffices for now.

---

## 6. Implementation Notes

### Schema Additions Required

```prisma
// Gap 1: Opportunity Teams
model OpportunityTeamMember {
  id            String   @id @default(uuid()) @db.Uuid
  orgId         String   @map("org_id") @db.Uuid
  opportunityId String   @map("opportunity_id") @db.Uuid
  userId        String   @map("user_id") @db.Uuid
  role          String   // ae | se | manager | csm | partner
  splitPct      Int      @default(0) @map("split_pct") // 0-10000 (basis points for precision)
  createdAt     DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  org         Org         @relation(fields: [orgId], references: [id], onDelete: Cascade)
  opportunity Opportunity @relation(fields: [opportunityId], references: [id], onDelete: Cascade)
  user        User        @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@unique([orgId, opportunityId, userId])
  @@map("opportunity_team_members")
}

// Gap 3: Competitors
model Competitor {
  id          String   @id @default(uuid()) @db.Uuid
  orgId       String   @map("org_id") @db.Uuid
  name        String
  website     String?
  strengths   String[]
  weaknesses  String[]
  threatLevel Int      @default(3) @map("threat_level") // 1-5
  createdAt   DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  org Org @relation(fields: [orgId], references: [id], onDelete: Cascade)
  @@unique([orgId, name])
  @@map("competitors")
}

model OpportunityCompetitor {
  id            String @id @default(uuid()) @db.Uuid
  orgId         String @map("org_id") @db.Uuid
  opportunityId String @map("opportunity_id") @db.Uuid
  competitorId  String @map("competitor_id") @db.Uuid
  ourPosition   String @map("our_position") // leading | trailing | neck_and_neck | unknown
  notes         String?
  createdAt     DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  org         Org        @relation(fields: [orgId], references: [id], onDelete: Cascade)
  opportunity Opportunity @relation(fields: [opportunityId], references: [id], onDelete: Cascade)
  competitor  Competitor @relation(fields: [competitorId], references: [id], onDelete: Cascade)
  @@unique([orgId, opportunityId, competitorId])
  @@map("opportunity_competitors")
}

// Gap 4: Stage History
model OpportunityStageHistory {
  id            BigInt   @id @default(autoincrement())
  orgId         String   @map("org_id") @db.Uuid
  opportunityId String   @map("opportunity_id") @db.Uuid
  fromStageId   String?  @map("from_stage_id") @db.Uuid
  toStageId     String   @map("to_stage_id") @db.Uuid
  changedById   String?  @map("changed_by_id") @db.Uuid
  enteredAt     DateTime @default(now()) @map("entered_at") @db.Timestamptz(6)
  exitedAt      DateTime? @map("exited_at") @db.Timestamptz(6)
  durationSeconds Int?   @map("duration_seconds")
  @@index([orgId, opportunityId, enteredAt(sort: Desc)])
  @@map("opportunity_stage_history")
}

// Gap 5: Path / Guided Selling (extend PipelineStage)
// Add to existing PipelineStage model:
//   coachingTips    String?  @map("coaching_tips")
//   requiredFields  Json     @default("[]") @map("required_fields")
//   exitCriteria    Json     @default("[]") @map("exit_criteria")
```

### API Route Additions
- `GET/POST/PATCH/DELETE /opportunities/:id/team` — Gap 1
- `GET/POST /opportunities/:id/competitors` — Gap 3
- `GET /opportunities/:id/stage-history` — Gap 4 (dedicated, queryable)
- `GET /opportunities/:id/path` — Gap 5 (coaching tips + required fields for current stage)

### UI Component Additions
- `OpportunityTeamPanel` — team editor with role dropdown + split % input
- `CompetitorCard` — add/manage competitors per opp, mark win/loss reason
- `SalesPath` — visual path component (horizontal stage bar with coaching tooltip)
- `StageHistoryChart` — bar chart of duration per stage

### Migration Notes
- **PipelineStage backfill:** The existing enum values map 1:1 to `PipelineStage.key`. A SQL migration can create a default Pipeline, insert 7 stages, and update `opportunity.pipeline_stage_id`.
- **Stage History backfill:** Can be reconstructed from existing `AuditLog` rows where `action = 'opportunity.stage'` by ordering `at` asc and computing deltas.
- **Contact role standardization:** Current free-text values are low cardinality (only 5 options in UI). Safe to migrate to enum or reference table.

### Architectural Risks
1. **Pipeline enum deprecation:** The `OpportunityStage` enum is deeply embedded in routes, shared schemas, and frontend. A phased migration (dual-write → read from new table → drop enum) is safest.
2. **Forecast rollup complexity:** Adding team splits requires changing forecast aggregation from `ownerId` to `OpportunityTeamMember` joins. This affects the existing `Forecast` model and sales dashboard.
3. **Notification delivery:** The `NotificationsBell` in `Topbar.tsx` appears to be a UI stub. Big Deal Alerts (Gap 7) need a real notification delivery backend (WebSocket, email, Slack) which is not fully evident in the codebase.

---

## 7. Salesforce Parity Score

| Category | BidStack | Salesforce | Gap |
|----------|----------|------------|-----|
| Basic Opp CRUD | ✅ 90% | 100% | Minor |
| Contact Roles | 🟡 60% | 100% | No standardized picklist, no power map |
| Opportunity Teams | 🔴 10% | 100% | Single owner only |
| Competitive Tracking | 🟡 30% | 100% | Dust-only, no CRM-native competitor table |
| Stage History | 🟡 50% | 100% | AuditLog only, no duration analytics |
| Path/Guided Selling | 🔴 0% | 100% | Not implemented |
| Opportunity Splits | 🔴 0% | 100% | Not implemented |
| Big Deal Alerts | 🟡 30% | 100% | Workflow exists, no pre-built template |
| Pipeline Customization | 🟡 40% | 100% | Tables exist, not wired to UI/API |

**Weighted Parity: ~42%** — Functional for basic pipeline tracking; significant depth gaps remain for enterprise sales methodology enforcement.

---

*End of Audit Report*
