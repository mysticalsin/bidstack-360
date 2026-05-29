# Audit: Database Query Patterns

**Scope:** All `*.ts` files using `prisma.*.findMany`, `groupBy`, `aggregate`, raw SQL  
**Rubric dimension:** Code quality + Infra (performance)  
**Date:** 2026-05-23  
**Auditor:** Agent-04 (read-only)

---

## 1. Score: 72 / 100

**Rationale:**

- **Route layer (strong):** API route handlers overwhelmingly use cursor pagination with explicit `take: limit + 1`, `orderBy`, and tenant-scoped `where` clauses.
- **Raw SQL (safe):** All `$queryRaw` calls use Prisma template-literal parameters; no string-concatenation injection vectors were found.
- **Worker / service layer (weak):** Recurring unbounded `findMany` queries (no `take`) in BullMQ workers and service helpers. Several `findMany` calls that _do_ specify `take` omit `orderBy`, producing non-deterministic result sets.
- **Select discipline (mixed):** Many queries use minimal `select`, but a notable minority uses broad `include: { relation: true }` without column pruning.

---

## 2. Strengths

1. **Cursor pagination is the norm in route handlers.**  
   `apps/api/src/routes/opportunities.ts:37`, `apps/api/src/routes/companies.ts:26`, `apps/api/src/routes/leads.ts:37`, and `apps/api/src/routes/invoices.ts:192` all use `take: limit + 1` with `cursor` / `skip: 1` and an explicit `orderBy`.

2. **Raw SQL is safely parameterized.**  
   Every `$queryRaw` usage observed passes variables via template literal interpolation (`${orgId}::uuid`), which Prisma correctly parameterizes.  
   Examples: `apps/api/src/services/crm/sales-dashboard.service.ts:138`, `apps/api/src/routes/search.ts:57`, `apps/api/src/services/reports/sales-intelligence.service.ts:90`.

3. **Worker polling loops are bounded.**  
   `apps/worker/src/queues/webhook-processor.ts:52` uses `take: 100` when draining the `syncEvent` queue, preventing unbounded memory growth per tick.

4. **Minimal `select` clauses in high-frequency paths.**  
   `apps/worker/src/queues/dust-poll.ts:76` selects only `{ id: true }` for org enumeration.  
   `apps/api/src/routes/accounts.ts:71` selects only `{ companyId: true, valueMicros: true, stage: true }` for opportunity rollups.

5. **`groupBy` + `take` combinations include `orderBy`.**  
   `apps/api/src/services/crm/sales-dashboard.service.ts:212` and `:265` both pair `take: limit` with `orderBy: { _sum: { totalMicros: 'desc' } }`, satisfying Prisma’s deterministic-order requirement.

---

## 3. P0 Gaps

### 3.1 Unbounded `findMany` queries missing `take`

These queries can load an arbitrary number of rows into memory, risking OOM and connection-timeout failures as tenant data grows.

| File                                                       | Line | Query                                                                                                                         | Impact                                                                                   |
| ---------------------------------------------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `apps/worker/src/queues/cs.ts`                             | 80   | `prisma.org.findMany({ where: { deletedAt: null, subscriptions: { some: { status: 'ACTIVE' } } }, select: { id: true } })`    | Nightly health-score pass loads **every active org** without limit.                      |
| `apps/worker/src/queues/cs.ts`                             | 143  | `prisma.org.findMany({ where: { deletedAt: null }, select: { id: true } })`                                                   | NPS worker loads **every org** without limit.                                            |
| `apps/worker/src/queues/cs.ts`                             | 189  | `prisma.org.findMany({ where: { deletedAt: null }, select: { id: true } })`                                                   | Churn-detection worker loads **every org** without limit.                                |
| `apps/worker/src/queues/cs.ts`                             | 237  | `prisma.org.findMany({ where: { deletedAt: null }, select: { id: true } })`                                                   | Expansion worker loads **every org** without limit.                                      |
| `apps/worker/src/queues/cs.ts`                             | 282  | `prisma.org.findMany({ where: { deletedAt: null }, select: { id: true } })`                                                   | Renewal worker loads **every org** without limit.                                        |
| `apps/worker/src/queues/dust-poll.ts`                      | 76   | `prisma.org.findMany({ select: { id: true } })`                                                                               | Dust poller stub path loads **every org** without limit.                                 |
| `apps/worker/src/queues/dust-poll.ts`                      | 98   | `prisma.org.findMany({ select: { id: true } })`                                                                               | Dust poller main path loads **every org** without limit.                                 |
| `apps/api/src/services/territories/territories.service.ts` | 525  | `prisma.opportunity.findMany({ where: { orgId }, select: { ... }, include: { owner: { ... }, territory: { ... } } })`         | `getTerritoryAnalytics` fetches **ALL opportunities** for the org with nested relations. |
| `apps/api/src/routes/bookings.ts`                          | 207  | `prisma.bookingPage.findMany({ where: { orgId, userId, deletedAt: null }, orderBy: { createdAt: 'desc' }, select: { ... } })` | Unbounded per-user booking-page list.                                                    |
| `apps/api/src/routes/bookings.ts`                          | 384  | `prisma.calendarEvent.findMany({ where: { orgId, ownerId, ... }, select: { ... } })`                                          | Slot-validation loads **all overlapping events** without limit.                          |
| `apps/api/src/routes/bookings.ts`                          | 397  | `prisma.booking.findMany({ where: { bookingPageId: page.id, status: 'CONFIRMED', ... }, select: { ... } })`                   | Slot-validation loads **all overlapping bookings** without limit.                        |

### 3.2 `findMany` with `take` but missing `orderBy`

Prisma docs (and Postgres) do not guarantee deterministic ordering when `take` is used without `orderBy`. Pagination and deduplication can become unstable.

| File                                                   | Line | Query                                                                                                                                 |
| ------------------------------------------------------ | ---- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/routes/accounts.ts`                      | 71   | `prisma.opportunity.findMany({ where: { orgId, companyId: { in: ... } }, select: { ... }, take: 1000 })`                              |
| `apps/api/src/routes/accounts.ts`                      | 154  | Same pattern as above.                                                                                                                |
| `apps/api/src/services/reports/funnel.service.ts`      | 28   | `prisma.opportunity.findMany({ where: { ... stage: { notIn: ... } }, select: { valueMicros: true, probability: true }, take: 1000 })` |
| `apps/api/src/services/reports/funnel.service.ts`      | 42   | `prisma.opportunity.findMany({ where: { ... stage: { notIn: ... } }, select: { createdAt: true }, take: 1000 })`                      |
| `apps/api/src/services/ai-assistant.service.ts`        | 558  | `prisma.contact.findMany({ where: { orgId, email: { in: ... } }, select: { ... }, take: 20 })`                                        |
| `apps/api/src/routes/integrations/slack-commands.ts`   | 195  | `prisma.lead.findMany({ where: { ... }, take: 3, select: { ... } })`                                                                  |
| `apps/api/src/routes/integrations/slack-commands.ts`   | 207  | `prisma.contact.findMany({ where: { ... }, take: 2, select: { ... } })`                                                               |
| `apps/api/src/services/crm/sales-dashboard.service.ts` | 244  | `prisma.product.findMany({ where: { id: { in: ... } }, include: { category: { select: { name: true } } }, take: grouped.length })`    |

### 3.3 Raw SQL injection risks

**None found.** All `$queryRaw` calls use template-literal variables that Prisma parameterizes. No dynamic table/column names are interpolated from user input.

---

## 4. P1 Gaps

### 4.1 Inefficient / broad `include` without `select`

These queries pull every column on the related model, increasing payload size and memory pressure.

| File                                                       | Line | Issue                                                                                                                                                                                                                                     |
| ---------------------------------------------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/routes/audit-logs.ts`                        | 41   | `include: { user: true }` fetches all user columns for every audit row.                                                                                                                                                                   |
| `apps/api/src/routes/notes.ts`                             | 90   | `include: { author: true }` fetches all user columns for every note.                                                                                                                                                                      |
| `apps/api/src/routes/custom-fields.ts`                     | 217  | `include: { definition: true }` fetches all definition columns for every value.                                                                                                                                                           |
| `apps/api/src/services/invoices/invoices.service.ts`       | 180  | `include: { salesperson: { select: { name: true } }, salesOrder: { select: { number: true } }, _count: { select: { lines: true } } }` — mixed; the root `invoice` model still returns all columns because there is no top-level `select`. |
| `apps/api/src/services/territories/territories.service.ts` | 276  | `include: { owner: { select: { name: true } } }` with no `take` on `territory.findMany`.                                                                                                                                                  |
| `apps/api/src/services/territories/territories.service.ts` | 472  | `include: { owner: { select: { name: true } } }` with no `take` on `forecast.findMany`.                                                                                                                                                   |

### 4.2 Additional unbounded `findMany` (service / worker layer)

| File                                                       | Line | Query                                                                                                                                                                           |
| ---------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/worker/src/queues/cs.ts`                             | 90   | `prisma.subscription.findMany({ where: { orgId, status: 'ACTIVE' }, select: { accountId: true }, distinct: ['accountId'] })`                                                    |
| `apps/worker/src/services/cs/index.ts`                     | 90   | Same pattern as above.                                                                                                                                                          |
| `apps/worker/src/services/cs/index.ts`                     | 136  | `prisma.subscription.findMany({ where: { orgId, status: 'ACTIVE' }, select: { accountId: true }, distinct: ['accountId'] })`                                                    |
| `apps/worker/src/services/cs/index.ts`                     | 168  | `prisma.healthScore.findMany({ where: { orgId }, distinct: ['accountId'], orderBy: [{ accountId: 'asc' }, { capturedAt: 'desc' }], select: { accountId: true, score: true } })` |
| `apps/worker/src/services/cs/index.ts`                     | 208  | Same pattern as above.                                                                                                                                                          |
| `apps/api/src/services/territories/territories.service.ts` | 347  | `prisma.leadRoutingRule.findMany({ where: { orgId, active: true }, orderBy: { priority: 'desc' } })`                                                                            |
| `apps/api/src/services/territories/territories.service.ts` | 430  | Same pattern as above.                                                                                                                                                          |
| `apps/worker/src/queues/webhook-delivery.ts`               | 213  | `prisma.webhookSubscription.findMany({ where: { orgId, active: true, events: { has: event } }, select: { id: true } })`                                                         |

### 4.3 `groupBy` missing `orderBy` (non-deterministic ordering)

While these do not use `take`, omitting `orderBy` yields unstable ordering across repeated calls, which can confuse caching and UI rendering.

| File                                                   | Lines                     | Query                                                                        |
| ------------------------------------------------------ | ------------------------- | ---------------------------------------------------------------------------- |
| `apps/api/src/routes/accounts.ts`                      | 76, 159                   | `prisma.contact.groupBy({ by: ['companyId'], ... })`                         |
| `apps/api/src/services/reports/funnel.service.ts`      | 13, 75, 80, 118, 123, 162 | `opportunity.groupBy`, `lead.groupBy`, `serviceCase.groupBy`, `task.groupBy` |
| `apps/api/src/services/crm/sales-dashboard.service.ts` | 77                        | `prisma.salesOrder.groupBy({ by: ['currency'], ... })`                       |
| `apps/api/src/services/custom-object.service.ts`       | 179                       | `prisma.customObjectRecord.groupBy({ by: ['customObjectDefId'], ... })`      |
| `apps/api/src/routes/opportunities.ts`                 | 70                        | `prisma.comment.groupBy({ by: ['targetId'], ... })`                          |

---

## 5. P2 Gaps

1. **`getTerritoryAnalytics` fetches every opportunity row for aggregation.**  
   `apps/api/src/services/territories/territories.service.ts:525` performs in-memory grouping of `valueMicros`, `probability`, and `country`. This could be pushed to the database with `groupBy` + `_sum` / `_avg` to reduce wire cost.

2. **`crm/summary.ts` uses 10 correlated subqueries in raw SQL.**  
   `apps/api/src/routes/crm/summary.ts:58` runs a single `SELECT` with ten nested scalar subqueries. At high scale this becomes a CPU-heavy query; a single rollup CTE or a materialized summary table would be more efficient.

3. **Custom-object full-text search is a sequential JSON scan.**  
   `apps/api/src/services/custom-object.service.ts:557` uses `values_json::text ILIKE ${term}`. The inline comment acknowledges the limitation (“can be upgraded to a tsvector index later”), but the current implementation will scan the full table for every search.

4. **Yjs update fetch lacks a row limit.**  
   `apps/api/src/services/yjs-persistence.service.ts:152` loads all `yjsUpdate` rows newer than a timestamp. High-frequency collaborative edits could produce large result sets.

5. **`funnel.service.ts` issues two separate `findMany` calls for open opportunities.**  
   Lines 28 and 42 both query open opportunities with the same `where` clause but different `select` sets. A single query (or a pair of `aggregate` calls) would halve the round-trips.

6. **Connection-pool pressure in worker loops.**  
   Multiple workers (`cs.ts`, `dust-poll.ts`) iterate over all orgs in a `for` loop, issuing nested Prisma calls per org while holding the same connection. At high org counts this can exhaust the PgBouncer / Prisma connection pool. Consider batching or per-org job enqueueing.

---

## 6. Evidence

### 6.1 Unbounded `findMany` — worker org enumeration

```ts
// apps/worker/src/queues/cs.ts:80
const orgs = await prisma.org.findMany({
  where: {
    deletedAt: null,
    subscriptions: { some: { status: 'ACTIVE', deletedAt: null } },
  },
  select: { id: true },
});
```

```ts
// apps/worker/src/queues/dust-poll.ts:76
const orgs = await prisma.org.findMany({ select: { id: true } });
```

### 6.2 Unbounded `findMany` — territory analytics

```ts
// apps/api/src/services/territories/territories.service.ts:525
const rows = await prisma.opportunity.findMany({
  where: { orgId },
  select: {
    id: true,
    valueMicros: true,
    probability: true,
    country: true,
    territoryId: true,
    owner: { select: { name: true } },
    territory: { select: { name: true, countryCodes: true } },
  },
});
```

### 6.3 `take` without `orderBy`

```ts
// apps/api/src/routes/accounts.ts:71
prisma.opportunity.findMany({
  where: { orgId, companyId: { in: companyIds }, deletedAt: null },
  select: { companyId: true, valueMicros: true, stage: true },
  take: 1000,
}),
```

```ts
// apps/api/src/services/reports/funnel.service.ts:28
const opens = await prisma.opportunity.findMany({
  where: { orgId, deletedAt: null, stage: { notIn: ['closed_won', 'closed_lost'] } },
  select: { valueMicros: true, probability: true },
  take: 1000,
});
```

### 6.4 Broad `include` without column pruning

```ts
// apps/api/src/routes/audit-logs.ts:41
const rows = await prisma.auditLog.findMany({
  where,
  include: { user: true },
  orderBy: { id: 'desc' },
  take,
  ...(cursor ? { cursor: { id: BigInt(cursor) }, skip: 1 } : {}),
});
```

```ts
// apps/api/src/routes/notes.ts:90
const items = await prisma.note.findMany({
  where,
  include: { author: true },
  orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }],
  take: req.query.limit,
});
```

### 6.5 Safe raw SQL (positive evidence)

```ts
// apps/api/src/services/crm/sales-dashboard.service.ts:138
const rows = await prisma.$queryRaw<
  Array<{ month: Date; total_micros: bigint; orders: bigint; currency: string }>
>`
  SELECT
    date_trunc('month', "order_date") AS month,
    SUM("total_micros")::bigint AS total_micros,
    COUNT(*)::bigint AS orders,
    "currency" AS currency
  FROM "sales_orders"
  WHERE "org_id" = ${orgId}::uuid
    AND "state" IN ('confirmed', 'done')
    AND "order_date" >= ${from}
    AND "order_date" <= ${to}
  GROUP BY 1, 4
  ORDER BY 1 ASC
`;
```

```ts
// apps/api/src/routes/search.ts:57
const opps = await prisma.$queryRaw<
  Array<{ id: string; code: string; customer: string; name: string }>
>`
  SELECT id, code, customer, name
  FROM opportunities
  WHERE org_id = ${req.auth.orgId}::uuid
    AND (customer || ' ' || name || ' ' || code) ILIKE ${like}
  ORDER BY updated_at DESC
  LIMIT ${perTypeLimit}
`;
```

### 6.6 Well-paginated route handler (positive evidence)

```ts
// apps/api/src/routes/opportunities.ts:37
const items = await prisma.opportunity.findMany({
  where: {
    /* tenant-scoped filters */
  },
  include: {
    owner: { select: { id: true, name: true, email: true } },
    territory: { select: { name: true } },
    pipelineStage: {
      select: { id: true, name: true, probability: true, color: true, isWon: true, isLost: true },
    },
    _count: { select: { tasks: true } },
  },
  orderBy: { updatedAt: 'desc' },
  take: limit + 1,
  ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
});
```

---

## 7. Recommendations

1. **Add `take` to every worker-level `org.findMany`.** A ceiling such as `take: 1000` (or smaller) should be combined with a continuation mechanism (cursor / offset) if the total org count can exceed the cap.
2. **Add `orderBy` to every `findMany` that specifies `take`.** This is required for stable pagination and deterministic `LIMIT` behavior in Postgres.
3. **Cap `getTerritoryAnalytics`.** Either add a `take` (e.g., 5000) or rewrite the aggregation using Prisma `groupBy` with `_sum` / `_avg` so the database does the heavy lifting.
4. **Replace broad `include: { relation: true }` with `select` on the relation.** In `audit-logs.ts`, `notes.ts`, and `custom-fields.ts`, only the columns actually used by the serializer should be fetched.
5. **Add a GIN index on `custom_object_records(values_json)`** (or migrate to `tsvector`) before the custom-object search feature reaches production scale.
6. **Consider per-org job enqueueing in workers.** Instead of loading all orgs into memory and looping, enqueue one BullMQ job per org. This bounds memory, isolates failures, and respects connection-pool limits.
