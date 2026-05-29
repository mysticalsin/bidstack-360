# Audit Report: Opportunities & Pipeline Domain

**Auditor:** Agent-17 (read-only)  
**Scope:** `apps/api/src/routes/opportunities.ts`, `apps/api/src/services/crm/sales-dashboard.service.ts`, `apps/api/src/services/crm/pipeline.service.ts` (absent), `packages/db/prisma/schema.prisma` (PipelineStage & Opportunity models), plus adjacent pipeline/reporting code.  
**Rubric:** Functional 25 + Code 25 (scaled to 0–100)  
**Date:** 2026-05-23

---

## 1. Score

**62 / 100**

| Dimension  | Points  | Notes                                                                                                                                                                                   |
| ---------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Functional | 13 / 25 | Core CRUD works; stage transitions have zero guardrails; probability/forecast logic is disconnected from `PipelineStage`; win/loss tracking is hard-coded to the deprecated enum.       |
| Code       | 16 / 25 | Clean Prisma patterns, proper micros conversion, audit logging present; scattered hard-coded stage strings, missing abstraction for pipeline KPIs, duplicated open-opportunity queries. |

---

## 2. Strengths

- **Atomic audit logging on every mutating operation.** `POST /opportunities` (`opportunities.ts:186-224`), `PATCH` (`opportunities.ts:349-396`), `DELETE` (`opportunities.ts:448-465`), and stage moves (`opportunities.ts:527-547`) all wrap the change + `auditLog.create` in a `$transaction`. This satisfies Arch-4 "never delete-without-record."
- **Consistent micros storage at the edge.** Opportunity value is converted with `BigInt(Math.round(body.value * 1_000_000))` on create (`opportunities.ts:196`) and update (`opportunities.ts:360-361`), and serialized back with `Number(o.valueMicros) / 1_000_000` (`apps/api/src/serializers/opportunity.ts:76`). This matches the Twenty/Stripe convention documented in `AGENTS.md`.
- **Cursor-based pagination on list endpoint.** `GET /opportunities` uses `take: limit + 1` with an optional `{ cursor: { id: cursor }, skip: 1 }` (`opportunities.ts:62-64`), which is scalable and avoids offset-based degradation.
- **Soft-delete with cascading tombstones.** The `DELETE` route sets `deletedAt` rather than hard-deleting (`opportunities.ts:464`), and Prisma `onDelete: Cascade` on `Task` / `Document` ensures child rows are removed from queries without orphaning data.
- **Defence-in-depth org scoping.** Every Prisma query in `opportunities.ts` includes `orgId: req.auth.orgId`, preventing cross-tenant reads even when an `id` is guessed.

---

## 3. P0 Gaps (Broken / Incorrect)

### 3.1 Stage transition logic has zero guardrails

**File:** `apps/api/src/routes/opportunities.ts:526`  
**Evidence:**

```ts
// Any stage can move to any stage within the same pipeline for now.
const [updated] = await prisma.$transaction([ ... ]);
```

- A deal can move from `closed_won` back to `s1_lead`. A deal can skip every intermediate stage. There is no validation of `orderIndex`, no `isWon`/`isLost` gate, and no concept of irreversible stages.
- The API accepts _either_ `pipelineStageId` or the legacy `stage` enum (`opportunities.ts:477-494`), but does not validate that the supplied `stage` string actually maps to a row in `PipelineStage` when `pipelineStageId` is omitted.

### 3.2 Probability calculation is disconnected from `PipelineStage`

**Files:** `apps/api/src/routes/opportunities.ts:197`, `apps/api/src/services/reports/funnel.service.ts:28-35`  
**Evidence:**

```ts
// opportunities.ts create — probability comes from the request body, not the stage
probability: body.probability,

// funnel.service.ts weighted pipeline uses Opportunity.probability, not PipelineStage.probability
const weighted = opens.reduce(
  (acc, o) => acc + (Number(o.valueMicros) / 1_000_000) * (o.probability / 100),
  0,
);
```

- When a user moves a card via `POST /:id/stage`, the `probability` column on the opportunity is **not** updated to match the new stage’s probability. The weighted pipeline report therefore becomes silently incorrect.
- There is no service-level function that syncs `Opportunity.probability` ↔ `PipelineStage.probability` on stage change.

### 3.3 Forecast category logic is completely unimplemented

**File:** `packages/db/prisma/schema.prisma:2957`  
**Evidence:**

```prisma
forecastCategory String   @default("pipeline") @map("forecast_category")
```

- `forecastCategory` exists on `PipelineStage` but is **never read** in any API route, report, or serializer. The `Opportunity` model has no `forecastCategory` column at all. Reports such as `/reports/pipeline` and `/crm/summary` cannot produce a forecast rollup (pipeline / best_case / commit / closed).

### 3.4 Win/loss tracking is hard-coded to the deprecated enum

**Files:** `apps/api/src/routes/opportunities.ts:112`, `apps/api/src/services/reports/funnel.service.ts:26-29`, `apps/api/src/routes/crm/summary.ts:55`  
**Evidence:**

```ts
// opportunities.ts count endpoint
{ stage: { notIn: ['closed_won', 'closed_lost'] as PrismaStage[] } }

// funnel.service.ts
const open = byStage.filter((s) => s.stage !== 'closed_won' && s.stage !== 'closed_lost');

// crm/summary.ts raw SQL
stage <> ALL(${closedStages}::opportunity_stage[])
```

- Every win/loss gate uses the legacy `OpportunityStage` enum strings instead of `pipelineStage.isWon` / `pipelineStage.isLost`. If an org customises a pipeline so that a different stage (e.g. `archived`) is the terminal lost state, the KPIs will miscount it as open.
- There is no `closedAt`, `wonAt`, or `lostAt` timestamp on `Opportunity`, making it impossible to compute "time to close" accurately without scanning `auditLog`.

### 3.5 `PipelineStage` table migration lacks a backfill

**File:** `packages/db/prisma/migrations/20260516010000_canonicalize_opportunity_stage/migration.sql` (empty), `packages/db/prisma/migrations/20260525010000_sync_drift/migration.sql`  
**Evidence:**

- The `canonicalize_opportunity_stage` migration file is **0 bytes** — it does nothing.
- The `pipeline_stages` table is created for the first time in `sync_drift` (a catch-all schema-reconciliation migration) with `CREATE TABLE "pipeline_stages" ...`. There is no subsequent migration that:
  1. Creates default `PipelineStage` rows for existing orgs.
  2. Backfills `opportunity.pipeline_stage_id` from `opportunity.stage`.
- Existing orgs upgraded from pre-PipelineStage schemas will have `NULL` `pipeline_stage_id` on every opportunity, breaking kanban views that rely on the relation.

---

## 4. P1 Gaps (Performance / Missing Features)

### 4.1 Pipeline KPIs group by legacy `stage` enum, not `pipelineStageId`

**File:** `apps/api/src/services/reports/funnel.service.ts:13-18`  
**Evidence:**

```ts
const grouped = await prisma.opportunity.groupBy({
  by: ['stage'],
  where: { orgId, deletedAt: null },
  _count: { _all: true },
  _sum: { valueMicros: true },
});
```

- The `/reports/pipeline` endpoint groups by the deprecated `stage` column. It does not join `PipelineStage`, so custom pipeline names, colours, and order are invisible to the funnel report.

### 4.2 Duplicate queries for open-opportunity aggregates

**File:** `apps/api/src/services/reports/funnel.service.ts:28-46`  
**Evidence:**

```ts
const opens = await prisma.opportunity.findMany({
  where: { orgId, deletedAt: null, stage: { notIn: ['closed_won', 'closed_lost'] } },
  select: { valueMicros: true, probability: true },
  take: 1000,
});
// ... later ...
const allOpen = await prisma.opportunity.findMany({
  where: { orgId, deletedAt: null, stage: { notIn: ['closed_won', 'closed_lost'] } },
  select: { createdAt: true },
  take: 1000,
});
```

- Two almost-identical `findMany` calls hit the same row set. They should be collapsed into one query that selects `{ valueMicros, probability, createdAt }`.

### 4.3 No dedicated stage-history entity

**File:** `packages/db/prisma/schema.prisma`  
**Evidence:**

- Stage changes are logged only to the generic `AuditLog` table (`action: 'opportunity.stage'`). There is no `OpportunityStageHistory` model with indexed `opportunityId`, `fromStageId`, `toStageId`, `movedAt` columns. Querying "how long was this deal in Negotiation?" requires parsing JSON blobs in `auditLog.diff`.

### 4.4 `sales-dashboard.service.ts` does not touch opportunities

**File:** `apps/api/src/services/crm/sales-dashboard.service.ts`  
**Evidence:**

- The file name implies opportunity/pipeline dashboard logic, but every function inside aggregates `salesOrder` rows only (`sales_orders` table). There is no opportunity-weighted pipeline, no stage conversion rates, and no deal velocity computed from the `opportunities` table. This is a naming/organisation gap that confuses maintainers.

### 4.5 Onboarding sample deals hard-code legacy stage

**File:** `apps/api/src/services/onboarding.service.ts:189`  
**Evidence:**

```ts
stage: 'discovery' as never, // legacy field — use stage column
```

- Sample deals created by onboarding templates write `'discovery'` into the deprecated `stage` column regardless of which template is installed. The `pipelineStageId` is set correctly, but the legacy column is out of sync.

---

## 5. P2 Gaps (Nice-to-Have)

### 5.1 `PipelineStage.probability` is `Decimal(5,2)` but API schemas use `z.number()`

**File:** `packages/shared/src/schemas/opportunity.ts:20`  
**Evidence:**

```ts
probability: z.number(),
```

- The Zod schema does not constrain precision or range for the nested `PipelineStage` probability, whereas the DB enforces two decimal places. A stage with `probability: 33.333` would pass validation but be truncated silently by Prisma.

### 5.2 Missing `pipelineStage` filter in `OpportunityFilter`

**File:** `packages/shared/src/schemas/opportunity.ts:130-138`  
**Evidence:**

```ts
export const OpportunityFilter = z.object({
  pipelineStageId: z.string().uuid().optional(),
  stage: OpportunityStage.optional(),
  ...
});
```

- The filter accepts `pipelineStageId` but does not support filtering by `forecastCategory`, `isWon`, or stage order ranges. Advanced pipeline views (e.g. "show only commit-stage deals") require client-side filtering.

### 5.3 `OpportunityFull.timeline` is always empty

**File:** `apps/api/src/serializers/opportunity.ts:109`  
**Evidence:**

```ts
timeline: [],
```

- The full-detail serializer hard-codes an empty timeline array. There is no backend fetch for stage-history, task completions, or document uploads that would populate a chronological deal timeline.

### 5.4 `valueSum` in funnel report loses precision

**File:** `apps/api/src/services/reports/funnel.service.ts:23`  
**Evidence:**

```ts
valueSum: Number(g._sum.valueMicros ?? 0) / 1_000_000,
```

- Converting micros to a JS `number` before returning to the client can lose integer precision above `Number.MAX_SAFE_INTEGER` (~9 quadrillion micros = ~9 trillion currency units). For enterprise deals this is a latent bug.

---

## 6. Evidence Summary (Code Snippets)

### 6.1 Zero-guardrail stage move

```ts
// apps/api/src/routes/opportunities.ts:526-531
// Any stage can move to any stage within the same pipeline for now.
const [updated] = await prisma.$transaction([
  prisma.opportunity.update({
    where: { id: opp.id },
    data: { pipelineStageId: toStage?.id ?? null, stage: nextStage },
  }),
```

### 6.2 Probability not synced on stage change

```ts
// apps/api/src/routes/opportunities.ts:527-531
prisma.opportunity.update({
  where: { id: opp.id },
  data: { pipelineStageId: toStage?.id ?? null, stage: nextStage },
  // probability is NOT updated here
}),
```

### 6.3 Hard-coded win/loss strings

```ts
// apps/api/src/services/reports/funnel.service.ts:26-29
const open = byStage.filter((s) => s.stage !== 'closed_won' && s.stage !== 'closed_lost');
const opens = await prisma.opportunity.findMany({
  where: { orgId, deletedAt: null, stage: { notIn: ['closed_won', 'closed_lost'] } },
```

### 6.4 Empty canonicalize migration

```sql
-- packages/db/prisma/migrations/20260516010000_canonicalize_opportunity_stage/migration.sql
-- (file size: 0 bytes)
```

### 6.5 PipelineStage created in catch-all drift migration

```sql
-- packages/db/prisma/migrations/20260525010000_sync_drift/migration.sql
CREATE TABLE "pipeline_stages" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "pipeline_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order_index" INTEGER NOT NULL DEFAULT 0,
    "probability" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "forecast_category" TEXT NOT NULL DEFAULT 'pipeline',
    "is_won" BOOLEAN NOT NULL DEFAULT false,
    "is_lost" BOOLEAN NOT NULL DEFAULT false,
    "color" TEXT,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    ...
);
```

### 6.6 Onboarding hard-codes legacy stage

```ts
// apps/api/src/services/onboarding.service.ts:184-196
return {
  orgId,
  code: `SAMPLE-${templateName.slice(0, 3)}-${idx + 1}`,
  customer: d.customer,
  name: d.name,
  stage: 'discovery' as never, // legacy field — use stage column
  pipelineStageId: stage.id,
  valueMicros: d.valueMicros,
  probability: d.probability,
  ...
};
```

---

## 7. Recommended Fix Priority

| Priority | Fix                                                                                                                         | Impact                                        |
| -------- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| P0       | Add stage-transition guardrails (`orderIndex` checks, `isWon`/`isLost` gates)                                               | Prevents data corruption                      |
| P0       | Auto-sync `Opportunity.probability` from `PipelineStage.probability` on stage move                                          | Fixes weighted pipeline KPIs                  |
| P0       | Rewrite `/reports/pipeline` and `/crm/summary` to use `pipelineStage.isWon`/`isLost` instead of hard-coded enum strings     | Correct win/loss metrics for custom pipelines |
| P0       | Write a proper backfill migration: create default `PipelineStage` rows per org and populate `opportunity.pipeline_stage_id` | Fixes broken kanban for existing tenants      |
| P1       | Add `OpportunityStageHistory` model or indexed view for fast stage-duration queries                                         | Enables velocity / stagnation insights        |
| P1       | Collapse duplicate `findMany` queries in `funnel.service.ts`                                                                | Reduces DB load                               |
| P2       | Rename `sales-dashboard.service.ts` to `sales-order.service.ts` or add actual opportunity KPIs                              | Reduces maintainer confusion                  |
