# Database Schema Audit — BidStack 360° CRM

**Scope:** `packages/db/prisma/schema.prisma`, `packages/db/prisma/migrations/`  
**Auditor:** Agent-03 (read-only)  
**Date:** 2026-05-23  
**Rubric:** Infra (subset) + Functional

---

## 1. Score

**72 / 100**

The schema demonstrates mature multi-tenant patterns, consistent money-in-micros discipline, and thoughtful use of PostgreSQL extensions. However, migration hygiene is severely compromised by a 2,847-line drift-fix migration, an empty migration file, a timestamp collision, and widespread missing indexes on foreign keys. These issues elevate from "cleanup debt" to "operational risk" because they can cause production query degradation, non-deterministic migration ordering, and failed rollbacks.

---

## 2. Strengths

- **Tenancy-first indexing:** Every tenant-scoped table carries `orgId` with composite B-tree indexes (`orgId + status + date`, `orgId + entityType + entityId`, etc.), which correctly supports the dashboard and list-view query patterns.
- **Soft-delete convention:** `deletedAt DateTime?` with `@@index([deletedAt])` is applied to the majority of models, enabling uniform "exclude deleted" filtering at the Prisma client extension or middleware layer.
- **Money stored in micros:** `valueMicros`, `totalMicros`, `costMicros`, `arrAmountMicros` are consistently `BigInt`, following the Twenty/Stripe convention and avoiding floating-point rounding errors.
- **PostgreSQL-native features:** `citext` for case-insensitive emails, `pg_trgm` for GIN trigram search on opportunities, `pgcrypto` for UUID generation, and `JSONB` for flexible metadata. A raw migration adds the functional GIN index `opps_search_gin_idx` because Prisma cannot express expression-column GIN indexes natively.
- **Rich enum coverage:** State machines (OpportunityStage, TaskStatus, InvoiceState, etc.) are modelled as PostgreSQL `ENUM` types, giving data integrity at the DB level. The deprecation path from `OpportunityStage` enum → `PipelineStage` table is explicitly documented with a `@deprecated` doc block.

---

## 3. P0 Gaps — Critical

### 3.1 Missing indexes on foreign keys

Prisma does **not** auto-index foreign keys. Several FK columns lack indexes, causing sequential scans on join and filter queries:

| Model                  | FK Column                                              | Impact                                 |
| ---------------------- | ------------------------------------------------------ | -------------------------------------- |
| `Opportunity`          | `companyId` (line 336)                                 | Company→Opps lookup scans              |
| `Opportunity`          | `territoryId` (line 351)                               | Territory assignment reports scan      |
| `Lead`                 | `convertedToOpportunityId` (line 2350)                 | Conversion funnel queries scan         |
| `SalesOrder`           | `customerId` (line 1865)                               | Customer order history scans           |
| `Invoice`              | `customerId` (line 1950)                               | AR aging by customer scans             |
| `Subscription`         | `productId` (line 3905)                                | Product subscription rollup scans      |
| `RenewalOpportunity`   | `opportunityId` (line 3948)                            | Renewal→Deal linkage scans             |
| `HealthScore`          | `accountId` (line 3981)                                | Account health timeline scans          |
| `NpsSurvey`            | `contactId` (line 4008)                                | Contact survey history scans           |
| `ChurnSignal`          | `accountId` (line 4056)                                | Account risk signals scans             |
| `ExpansionOpportunity` | `accountId` (line 4102)                                | Account upsell list scans              |
| `Requirement`          | `documentVersionId`, `sourceChunkId` (lines 1335–1336) | Version/chunk requirement lookups scan |
| `ReviewIssue`          | `requirementId`, `sourceChunkId` (lines 1401–1402)     | Issue traceability scans               |
| `ApprovalGate`         | `lockedVersionId` (line 1433)                          | Version approval gate scans            |

### 3.2 Empty migration file

`packages/db/prisma/migrations/20260516010000_canonicalize_opportunity_stage/migration.sql` is **0 bytes**. The migration folder exists but contains no SQL. The `PipelineStage` table and `Pipeline` table were instead created inside the later `20260525010000_sync_drift` migration, meaning the canonicalization step was never independently applied or tested.

### 3.3 Migration timestamp collision

Two migrations share the identical timestamp prefix `20260524000000`:

- `20260524000000_add_company_parent_id`
- `20260524000000_add_tenant_export`

Prisma orders migrations lexicographically by folder name. When timestamps collide, execution order is non-deterministic (alphabetical tie-break). If `add_tenant_export` ever gains a FK to `companies(parent_id)`, the migration will fail depending on filesystem ordering.

### 3.4 Monolithic drift-fix migration (`20260525010000_sync_drift`)

This 2,847-line migration is a **schema drift resolution** rather than an incremental change. It:

- Drops and re-creates ~20 foreign keys.
- Drops the `proposal_documents` table entirely (destructive).
- Drops columns `permissions.created_at` and `permissions.module` (loss of audit data).
- Alters `workflow_actions.kind` and `workflows.trigger_kind` from `TEXT` to `ENUM` by dropping and re-adding the column, which is destructive if data exists.
- Removes `DEFAULT gen_random_uuid()` from dozens of `id` columns (`ALTER COLUMN "id" DROP DEFAULT`).

A migration this large indicates the production database state diverged from the Prisma schema, or developers edited migrations by hand without regenerating. This breaks the "migrations as incremental, reviewable deltas" contract.

### 3.5 Missing soft-delete on ~20 models

The following models lack `deletedAt`, violating the codebase’s stated soft-delete convention:

- `YjsDocument`, `YjsUpdate`
- `CallSummary`
- `AiAssistantFeedback`
- `EmailTrackingPixel`
- `SlackChannel`, `SlackUserMapping`
- `ZapierApp`, `ZapierTrigger`, `ZapierAction`, `ZapierSubscription`
- `GraphSubscription`
- `CustomObjectDef`, `CustomObjectRelation`
- `NativePushToken`
- `SmsConsent`
- `MigrationJob`, `MigrationMapping`
- `WebhookDelivery`
- `PredictiveModel`

**Risk:** Hard deletes on these tables permanently lose data (e.g., Zapier webhook configs, AI feedback ratings, push tokens) with no recovery path.

### 3.6 Missing unique constraints on email per org

`Contact.email` (line 405) and `Lead.email` (line 2334) are **not** unique within an org. There is no DB-level guard against duplicate contacts or leads with the same email address, which will corrupt deduplication logic and reporting.

### 3.7 Missing check constraints on bounded integer columns

Several score/range columns have documented bounds in comments but no `@@check` or raw `CHECK` constraints:

| Column                    | Documented Range | Model Line |
| ------------------------- | ---------------- | ---------- |
| `Opportunity.probability` | 0–100            | 342        |
| `Lead.score`              | 0–100            | 2341       |
| `BidScore.totalScore`     | 0–100            | 2780       |
| `NpsSurvey.score`         | −100..100        | 4012       |
| `NpsSurvey.score11`       | 0–10             | 4014       |
| `HealthScore.score`       | 0–100            | 3982       |
| `PredictiveScore.score`   | 0–10000          | 2043       |

---

## 4. P1 Gaps — Normalization & Hygiene

### 4.1 Legacy columns not removed after migration

- `Note.accountId` (line 975) and `FileAttachment.accountId` (line 1009) are marked `@deprecated` with a free-form `VARCHAR(255)` type, coexisting with the newer `companyId` UUID FK. The drift migration added `companyId` but did not backfill or drop `accountId`.
- `OpportunityStage` enum (line 299) is `@deprecated` in favor of `PipelineStage`, yet the enum and `Opportunity.stage` column remain. A follow-up migration should backfill `pipelineStageId` from `stage` and then drop the enum column.
- `OrgSettings.pipelineStages` (line 2485) stores a JSON blob that duplicates the `PipelineStage` table rows. The two sources of truth can diverge.

### 4.2 Polymorphic Activity index gap

`Activity` uses `entityType + entityId` polymorphic linkage (line 1557–1558). The index `activities_org_entity_occurred_idx` is `(orgId, entityType, entityId, occurredAt DESC)`. Queries that filter only by `entityId` (e.g., "find all activities for this UUID across types") cannot use the leftmost-prefix rule and will scan.

### 4.3 `Company` hierarchy index scoped only by `parentId`

`Company.parentId` has `@@index([parentId])` (added in migration `20260524000000_add_company_parent_id`), but no composite `@@index([orgId, parentId])`. Listing child accounts within an org requires filtering by both columns.

### 4.4 `Comment` threading missing reply index

`Comment.parentId` (line 2193) enables nested threads, but there is no `@@index([parentId])`. Fetching replies to a comment will scan the table.

---

## 5. P2 Gaps — Nice-to-Have

### 5.1 Prisma preview feature no longer needed

`generator client` block (line 7) lists `previewFeatures = ["postgresqlExtensions"]`. This feature was stabilized in Prisma 5.x and can be removed to reduce schema noise.

### 5.2 JSON nullability inconsistency

`Opportunity.intel` has `@default("{}")` (line 347), while `Lead.intel` is `Json?` with no default (line 2354). Standardising to `@default("{}")` everywhere avoids null-branching in application code.

### 5.3 `AgentRun.output` unbounded JSON

`AgentRun.output Json?` (line 1775) can grow large with LLM responses. Consider a size-warning monitor or periodic archival, though this is an application concern rather than a schema blocker.

### 5.4 Partial index opportunity for unread mentions

`Mention.readAt` (line 2213) is nullable. A partial index `WHERE read_at IS NULL` would make "unread mentions for user" queries instant, but Prisma does not express partial indexes natively; a raw migration would be required.

---

## 6. Evidence

### Schema definitions (model lines)

```prisma
// Line 336 — Opportunity.companyId (no index)
companyId        String?          @map("company_id") @db.Uuid

// Line 351 — Opportunity.territoryId (no index)
territoryId      String?          @map("territory_id") @db.Uuid

// Line 975 — Deprecated free-text accountId on Note
accountId    String   @map("account_id") @db.VarChar(255)

// Line 1009 — Deprecated free-text accountId on FileAttachment
accountId        String   @map("account_id") @db.VarChar(255)

// Line 1865 — SalesOrder.customerId (no index)
customerId    String?    @map("customer_id") @db.Uuid

// Line 1950 — Invoice.customerId (no index)
customerId          String?      @map("customer_id") @db.Uuid

// Line 2350 — Lead.convertedToOpportunityId (no index)
convertedToOpportunityId String?      @map("converted_to_opportunity_id") @db.Uuid

// Line 3981 — HealthScore.accountId (no index)
accountId   String      @map("account_id") @db.Uuid

// Line 4130 — YjsDocument (no deletedAt)
model YjsDocument { ... }

// Line 4154 — YjsUpdate (no deletedAt)
model YjsUpdate { ... }

// Line 3858 — CallSummary (no deletedAt)
model CallSummary { ... }

// Line 3223 — AiAssistantFeedback (no deletedAt, no orgId)
model AiAssistantFeedback { ... }
```

### Migration files reviewed

| File                                                          | Size            | Note                                                               |
| ------------------------------------------------------------- | --------------- | ------------------------------------------------------------------ |
| `20260510231247_init/migration.sql`                           | 251 lines       | Clean init; creates base tables, enums, FKs.                       |
| `20260510235000_add_gin_index/migration.sql`                  | 8 lines         | Raw GIN trigram index; well documented.                            |
| `20260511010000_bidstack_crm_extensions/migration.sql`        | 287 lines       | Creates enrichment, insights, health tables; clean.                |
| `20260514120646_add_performance_indexes/migration.sql`        | 6 lines         | Adds 3 B-tree indexes; correct but minimal.                        |
| `20260521010000_add_reference_soft_delete/migration.sql`      | 3 lines         | Adds `deleted_at` to `references`; correct.                        |
| `20260521020000_add_activities/migration.sql`                 | 46 lines        | Creates `activities` + `activity_attendees`; clean.                |
| `20260522000000_add_rfp_document_intelligence/migration.sql`  | 313 lines       | Extensive RFP domain; indexes and FKs present.                     |
| `20260523000500_add_extraction_heartbeat/migration.sql`       | 19 lines        | Adds `started_at`/`heartbeat_at` to `document_extractions`; clean. |
| `20260524000000_add_company_parent_id/migration.sql`          | 9 lines         | Self-relation FK + index on `companies.parent_id`.                 |
| `20260524000000_add_tenant_export/migration.sql`              | 44 lines        | Creates `tenant_exports` with status enum; clean.                  |
| `20260525000000_add_roles_and_deleted_at/migration.sql`       | 84 lines        | RBAC tables + soft-delete columns on core tables; clean.           |
| `20260516010000_canonicalize_opportunity_stage/migration.sql` | **0 lines**     | **EMPTY — critical failure.**                                      |
| `20260525010000_sync_drift/migration.sql`                     | **2,847 lines** | **Monolithic drift fix — drops FKs, drops table, alters columns.** |

---

## 7. Recommendations

1. **Immediate:** Add missing `@@index` declarations for every foreign key column identified in §3.1, then generate a targeted migration.
2. **Immediate:** Decide whether to delete the empty `20260516010000_canonicalize_opportunity_stage` migration (only safe if it has never been deployed) or backfill it with the correct SQL.
3. **Immediate:** Rename one of the `20260524000000_*` migrations to avoid timestamp collision (e.g., `20260524000100_add_tenant_export`).
4. **Short-term:** Audit all models for missing `deletedAt` and add the column + index to every tenant-scoped table. Global reference tables (`Permission`) can remain without soft-delete.
5. **Short-term:** Add `@@unique([orgId, email])` on `Contact` and `Lead` (or handle dedup at the application layer if business rules allow duplicates).
6. **Medium-term:** Split the `sync_drift` migration into discrete, reviewable migrations, or baseline the schema and start a fresh migration history if drift is unrecoverable.
7. **Medium-term:** Remove `OpportunityStage` enum and `Opportunity.stage` column after confirming all API routes use `pipelineStageId`.
8. **Ongoing:** Add `@@check` constraints (via raw SQL in migrations) for bounded integer columns to enforce data integrity at the DB level.
