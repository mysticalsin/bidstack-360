# Audit Report — Reports & Analytics Domain

**Agent:** 19  
**Scope:** `apps/api/src/services/reports/**/*.ts`, `apps/api/src/routes/reports.ts`, metric-registry, report-engine, dashboard KPIs, sales intelligence  
**Rubric:** Functional 25 + Code 25  
**Date:** 2026-05-23

---

## 1. Score

**58 / 100**

_Functional: 14 / 25_ — Multiple aggregation paths silently sum mixed-currency micros, several KPIs are computed from arbitrarily truncated datasets, and dashboard cockpit returns hardcoded fake data.  
_Code: 16 / 25_ — Raw SQL is safely parameterized, Zod schemas are rigorous, and integration tests exist for the sales dashboard, but there is no test coverage for the sales-intelligence report builder, no caching on the heaviest endpoint, and several truncation bugs are hidden by `take` / `LIMIT` without warning.

---

## 2. Strengths

- **Rigorous wire-format contracts.** All report payloads are validated through Zod schemas (`packages/shared/src/schemas/crm.ts:290–416`, `packages/shared/src/schemas/sales-dashboard.ts:1–114`). `SalesIntelligenceReport.parse(...)` is invoked in both report builders (`sales-intelligence.service.ts:255`, `sales-intelligence.service.ts:317`), preventing drift between the engine and the API.
- **Safe raw SQL.** Every `$queryRaw` call uses Prisma template-literal tagging with UUID casting and bound parameters (`sales-intelligence.service.ts:90–107`, `sales-dashboard.service.ts:138–153`). No string concatenation or dynamic table names.
- **Graceful ERP fallback.** `readSalesOrders` probes `to_regclass(...)` before querying and falls back to opportunity-derived reporting when the sales module migration is absent (`sales-intelligence.service.ts:75–112`). The route layer mirrors this fallback (`reports.ts:54–124`).
- **Parallel query fan-out.** `Promise.all` is used consistently to fan out independent aggregates (`funnel.service.ts:74`, `reports.ts:86`, `dashboard.service.ts:111–127`), keeping latency reasonable.
- **HTTP cache headers for pipeline report.** The cache-headers plugin (`cache-headers.ts:12`) assigns `max-age=120, stale-while-revalidate=600` to `/api/v1/reports/pipeline`, and generates ETags with 304 short-circuit logic.
- **In-memory request deduplication for CRM dashboard.** `cachedDashboardSnapshot` (`dashboard.ts:22–40`) coalesces concurrent requests for the same org/account key within a 10-second TTL window, preventing stampede on the 12-query snapshot builder.

---

## 3. P0 Gaps (Incorrect Aggregations, Data Accuracy, Broken Reports)

### 3.1 Mixed-currency summation in `getMonthlySales` (sales-dashboard)

The raw SQL groups by `month` **and** `currency`, but the JS reducer adds the raw `total_micros` bigint values together as if they were the same currency (`sales-dashboard.service.ts:157–162`). A month with €1M + $1M CAD will be emitted as ~$2M in the dominant currency, which is materially wrong.

```ts
// sales-dashboard.service.ts:157–162
const byMonth = new Map<string, { revenueMicros: bigint; orders: number }>();
for (const row of rows) {
  const key = row.month.toISOString().slice(0, 10);
  const existing = byMonth.get(key) ?? { revenueMicros: BigInt(0), orders: 0 };
  existing.revenueMicros += row.total_micros; // ← sums EUR + CAD micros
  existing.orders += Number(row.orders);
  byMonth.set(key, existing);
}
```

### 3.2 Mixed-currency summation in `getTopCountries` (sales-dashboard)

Prisma `groupBy` on `countryCode` sums `totalMicros` without currency grouping or conversion (`sales-dashboard.service.ts:210–231`). A country with orders in multiple currencies will have an incoherent revenue total.

### 3.3 Mixed-currency summation in `getSalesKpis` (sales-dashboard)

`revenueCurr._sum.totalMicros` aggregates every confirmed order’s micros regardless of currency (`sales-dashboard.service.ts:100`). The returned `currency` field comes from `dominantCurrency()`, but the revenue figure is **not** converted to that currency.

### 3.4 Silent dataset truncation corrupts pipeline KPIs (funnel)

`getPipelineKpis` uses `findMany({ take: 1000 })` to compute `weightedPipeline` and `avgDaysOpen` (`funnel.service.ts:28–32`, `funnel.service.ts:42–46`). For orgs with >1,000 open opportunities, these KPIs are silently understated.

### 3.5 Sales-intelligence report built from 500-row sample

`readSalesOrders` caps at `LIMIT 500` (`sales-intelligence.service.ts:106`). Every downstream metric—KPIs, monthly sales, country breakdowns, team performance, win/loss—is computed from this truncated sample, making the report unreliable for active orgs.

### 3.6 `closedThisQuarter` uses `updatedAt` instead of a closed timestamp

`funnel.service.ts:38–40` counts opportunities where `stage === 'closed_won' && updatedAt >= quarterStart`. An opportunity closed in Q1 but touched in Q2 will be miscounted as a Q2 close.

### 3.7 Naive product classification produces fake categories

`classifyProduct` (`sales-intelligence.service.ts:639–660`) uses simple keyword matching on opportunity names to invent product lines and categories. There is no product master lookup; "Cloud Migration Factory" is returned for any opportunity containing the word "cloud". This pollutes product/category leaderboards with fabricated data.

### 3.8 Currency conversion silently returns unconverted amount on missing rate

`convert()` (`sales-intelligence.service.ts:874–879`) returns `Math.round(amount)` when either rate is missing, making conversion failures invisible to users and consumers.

```ts
if (fromRate === undefined || toRate === undefined || fromRate === 0) return Math.round(amount);
```

### 3.9 Hardcoded fake data in CRM dashboard cockpit

`buildCockpit` embeds static strings and objects (`dashboard.service.ts:630`, `dashboard.service.ts:634–636`, `dashboard.service.ts:660–665`):

- `"Total devices": "1,842"` — fake data.
- Health score `72` with fabricated band counts.
- Roadmap is a static four-item array regardless of the actual account.

### 3.10 `getTopCustomers` splits customers by currency

The `groupBy` includes `currency` (`sales-dashboard.service.ts:265`), so a single customer with EUR and USD orders appears as two distinct rows. The schema provides no hint that the same customer is split, and the frontend cannot reconcile them without extra logic.

---

## 4. P1 Gaps (Performance, Missing Report Types, Caching)

### 4.1 No caching on `/reports/sales-intelligence`

The heaviest report endpoint performs 6–8 DB queries **plus** an outbound HTTP call to `open.er-api.com` on every request (`reports.ts:57–70`). There is no Redis, in-memory, or even HTTP cache header coverage for this route (`cache-headers.ts` has no pattern for `/reports/sales-intelligence`).

### 4.2 No caching on `/sales-dashboard/*`

None of the seven sales-dashboard endpoints have cache-header patterns. The `dominantCurrency()` helper is called repeatedly (`getTopCountries`, `getTopCategories`, `getMonthlySales`) and re-executes a `groupBy` each time.

### 4.3 `getTopProducts` / `getTopCategories` raw SQL sums mixed-currency line items

Both queries aggregate `subtotal_micros` from `sales_order_lines` without joining to currency or converting (`sales-dashboard.service.ts:234–242`, `sales-dashboard.service.ts:282–291`).

### 4.4 CRM dashboard snapshot truncated at `take: 100/200`

`buildDashboardSnapshot` fetches opportunities with `take: 100` and contacts with `take: 200` (`dashboard.service.ts:125–210`). Cockpit KPIs like "Projects" and "Open deals" are computed from this truncated set and may undercount.

### 4.5 Missing report types

- No trend/cohort analysis.
- No forecast accuracy or pipeline velocity reports.
- No drill-down from country tiles to customer lists in the sales dashboard.

### 4.6 `getServiceDeskReport` may undercount resolved-this-month

The filter requires both `status: 'closed'` and `resolvedAt: { gte: monthStart }` (`funnel.service.ts:130–132`). If a case is closed without `resolvedAt` being populated, it is excluded.

---

## 5. P2 Gaps (Nice-to-Have Improvements)

### 5.1 Hardcoded customer→country map

`CUSTOMER_COUNTRY` (`sales-intelligence.service.ts:40–50`) is a static record. New customers default to `null` country unless explicitly added.

### 5.2 Hardcoded base currency

`SALES_CURRENCY = 'CAD'` (`sales-intelligence.service.ts:26`) and fallback rates (`sales-intelligence.service.ts:203`) are baked into the service layer.

### 5.3 No metric registry abstraction

Metrics (revenue, count, average, percentage) are scattered across three services with duplicated math helpers (`pct`, `trendPercent`, `sumMicros`, `convert`). There is no central metric registry or reusable report-engine abstraction.

### 5.4 Missing dedicated tests for `/reports/*`

There are zero route-level or unit tests for `funnel.service.ts` or `sales-intelligence.service.ts`. The only related coverage is `sales-dashboard.integration.test.ts`, which does not exercise the opportunity-fallback path or the sales-intelligence Zod schema parsing.

### 5.5 `buildWinLossFromOrders` uses `cancelled` as lost state

`ORDER_STATES` includes `'confirmed', 'done', 'closed_won'` (`sales-intelligence.service.ts:28`), while lost is defined as `state === 'cancelled'` (`sales-intelligence.service.ts:822`). This is inconsistent with the opportunity builder where lost is `closed_lost`. The sales-order data model has no `closed_lost` state, so the win/loss metric is semantically mismatched across the two report paths.

---

## 6. Evidence

### Currency aggregation bugs

```ts
// sales-dashboard.service.ts:138–162
const rows = await prisma.$queryRaw<...>`
  SELECT date_trunc('month', "order_date") AS month,
    SUM("total_micros")::bigint AS total_micros,
    COUNT(*)::bigint AS orders,
    "currency" AS currency          -- grouped by currency
  ...`;
const byMonth = new Map<...>();
for (const row of rows) {
  existing.revenueMicros += row.total_micros;  // BUG: sums mixed currencies
}
```

```ts
// sales-dashboard.service.ts:210–231
const rows = await prisma.salesOrder.groupBy({
  by: ['countryCode'],
  _sum: { totalMicros: true }, // BUG: sums mixed currencies
});
```

### Silent truncation

```ts
// funnel.service.ts:28–32
const opens = await prisma.opportunity.findMany({
  where: { orgId, deletedAt: null, stage: { notIn: ['closed_won', 'closed_lost'] } },
  select: { valueMicros: true, probability: true },
  take: 1000, // silently truncates weighted pipeline
});
```

```ts
// sales-intelligence.service.ts:90–107
return await prisma.$queryRaw<SalesOrderRow[]>`
  ...
  LIMIT 500   -- silently truncates entire sales-intelligence report
`;
```

### Dashboard fake data

```ts
// dashboard.service.ts:630
{ label: 'Total devices', value: '1,842', detail: 'verified data estimate', tone: 'purple' },

// dashboard.service.ts:634–636
health: {
  score: 72,
  band: 'strong',
  counts: { strong: 12, good: 18, needs_attention: 7, critical: 3 },
},
```

### Safe SQL (positive evidence)

```ts
// sales-intelligence.service.ts:76–79
const rows = await prisma.$queryRaw<Array<{ tableName: string | null }>>`
  SELECT to_regclass(${`public.${tableName}`})::text AS "tableName"
`;
```

---

## 7. Recommendations (Ranked)

1. **Fix mixed-currency aggregation.** Before summing micros in `getMonthlySales`, `getTopCountries`, `getSalesKpis`, `getTopProducts`, and `getTopCategories`, convert each bucket to a canonical currency (the dominant currency or EUR) using the live/fallback rate table. Do not sum raw micros across currencies.
2. **Remove or warn on truncation.** Either remove `take` / `LIMIT` caps on aggregation inputs, or emit a `truncated: true` flag in the response when the cap is hit. For `getPipelineKpis`, compute weighted pipeline and avg days open via Prisma `aggregate` and `groupBy` instead of `findMany`.
3. **Add caching to `/reports/sales-intelligence`.** Cache the built report in Redis (or at minimum in-memory with a 60-second TTL) keyed by `orgId` and a rate-version hash. Cache the exchange-rate fetch independently.
4. **Add cache-header patterns** for `/api/v1/sales-dashboard/*` and `/api/v1/reports/sales-intelligence` in `cache-headers.ts`.
5. **Replace hardcoded cockpit data** with real queries or remove the fake KPIs until real data sources exist.
6. **Write integration tests** for `/api/v1/reports/sales-intelligence` and `/api/v1/reports/pipeline` that assert on truncation flags, currency consistency, and Zod schema round-trips.
