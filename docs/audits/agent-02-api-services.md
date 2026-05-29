# API Services / Business Logic Domain Audit

**Scope:** `apps/api/src/services/**/*.ts`, `apps/api/src/lib/**/*.ts`  
**Rubric:** Functional (subset) + Code quality  
**Auditor:** Agent-02  
**Date:** 2026-05-23

---

## 1. Score: 62 / 100

| Dimension                 | Rating | Notes                                                                                                                            |
| ------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------- |
| Business logic separation | Good   | Clean service-route split; most domain logic lives in services.                                                                  |
| Transaction safety        | Weak   | `$transaction` used in ~40 % of mutating services; read-modify-write races and external-call-then-db patterns are common.        |
| N+1 query detection       | Weak   | Prisma middleware exists but threshold is high (10), logging is passive, and no request-scoped telemetry is wired to Pino.       |
| Side effect handling      | Weak   | Audit logging is consistent, but webhooks / cache invalidation / score notifications fire outside transactions with no rollback. |
| Service layer testability | Poor   | Global `prisma` singleton imported in ~75 % of service files; DI is only used in a handful of dashboard helpers.                 |
| Query guard plugin        | Weak   | Tracks counts in AsyncLocalStorage but never surfaces warnings to the active logger or Sentry.                                   |
| Dashboard aggregation     | Poor   | Hardcoded demo/fallback data mixed with real queries; cockpits return fabricated KPIs.                                           |

---

## 2. Strengths

- **Business logic is cleanly extracted from route handlers.**  
  `apps/api/src/services/invoices/invoices.service.ts` exports typed `CreateInvoiceInput`, `UpdateInvoiceInput`, and state-transition helpers, making the Fastify routes thin orchestrators.

- **Prisma `$transaction` is used for critical financial mutations.**  
  `invoices.service.ts:287-322` (invoice create with optimistic number-minting retry), `invoices.service.ts:534-568` (payment record + invoice update + audit log), and `onboarding.service.ts:124-236` (template install) all wrap related writes in transactions.

- **Query-guard middleware exists and is request-scoped.**  
  `apps/api/src/lib/prisma-middleware.ts:37-49` uses `AsyncLocalStorage` so every request gets its own query accumulator. It detects unbounded `findMany` (missing `take`) and flags N+1 when a single `model.action` crosses 10 invocations.

- **Activity logging supports idempotency.**  
  `apps/api/src/services/activity.service.ts:44-54` checks `idempotencyKey` before insert, preventing duplicate timeline events on retries.

- **Tenant ownership guard covers 16 entity types.**  
  `apps/api/src/lib/tenant-ownership.ts:90-134` provides `tenantEntityBelongsToOrg` with a normalized alias map, and `invoice.service.ts:264-266` calls `tenantEntitiesBelongToOrg` before creating lines.

- **Dashboard snapshot uses `Promise.all` for parallel fan-out.**  
  `apps/api/src/services/crm/dashboard.service.ts:111-327` fetches 12 independent datasets concurrently, avoiding waterfall latency.

---

## 3. P0 Gaps (Missing features, broken patterns, security issues)

### 3.1 Race condition in activity logging — no transaction around idempotency check

**File:** `apps/api/src/services/activity.service.ts:39-77`  
The `idempotencyKey` check (`findFirst`) and the `create` are two separate Prisma calls outside a transaction. Under concurrent requests the same key can pass the check twice and insert duplicates.

```ts
// lines 44-54
const existing = await prisma.activity.findFirst({
  where: { orgId: input.orgId, entityType: input.entityType, entityId: input.entityId, idempotencyKey: input.idempotencyKey },
  select: { id: true },
});
if (existing) return existing;
// ... later line 57
return prisma.activity.create({ ... });
```

### 3.2 External HTTP calls inside (or before) DB writes with no compensating rollback

**Files:**

- `apps/api/src/services/crm/enrichment.service.ts:52-63` — `fetchOpenCompanyProfile` is awaited, then on line 106 an `upsert` is performed. If the DB write fails, the external call side effect is already committed (bandwidth + rate-limit budget consumed) with no retry or cleanup.
- `apps/api/src/services/email-integration.service.ts:287-353` — `sendViaGmail` / `sendViaMsGraph` are called before the `prisma.$transaction` that persists `emailMessage` and `emailTrackingPixel`. If the DB transaction fails after the email is sent, the message is lost from the CRM.
- `apps/api/src/services/predictive-scoring.service.ts:310-316` — `fireDegradationNotification` (webhook fan-out) is called after DB upsert but before Redis cache write. Any failure in between leaves cache and DB out of sync.

### 3.3 N+1 in bulk tenant-ownership checks

**File:** `apps/api/src/lib/tenant-ownership.ts:146-159`  
`tenantEntitiesBelongToOrg` maps each ID to a separate `tenantEntityBelongsToOrg` call, each firing an independent `count` query. For 100 product IDs this is 100 round-trips.

```ts
const results = await Promise.all(
  uniqueIds.map((id) => tenantEntityBelongsToOrg(entityType, id, orgId, db)),
);
```

### 3.4 Hardcoded demo data returned as production dashboard state

**File:** `apps/api/src/services/crm/dashboard.service.ts`  
The cockpit builder injects fabricated metrics:

- Line 630: `{ label: 'Total devices', value: '1,842', ... }` — literal string, not computed.
- Line 608: `value: company.employeeCount ? ... : '2,500+'` — fallback is fake.
- Lines 993-1013: `defaultRisks()` returns static risks for every org when the DB is empty.
- Lines 1016-1061: `defaultCompliance()` returns static ISO/SOC 2 labels.
- Lines 1140-1155: `defaultReleaseScore()` always returns `total: 95` with `passed: true`.
- Lines 1157-1213: `defaultTechnicalStack()` returns a canned stack for every company.

These defaults make the dashboard unusable for real operational decisions and violate data-integrity expectations.

### 3.5 SSRF guard misses IPv6 and DNS-rebinding vectors

**File:** `apps/api/src/lib/ssrf-guard.ts:20-50`  
`isPublicHostname` only inspects the hostname string. It:

- Does not resolve the hostname to an IP and re-check after DNS resolution (vulnerable to DNS rebinding).
- Misses IPv6 loopback (`::1`, `0:0:0:0:0:0:0:1`).
- Misses IPv6 unique-local addresses (`fc00::/7`).
- Misses `0` (shorthand for `0.0.0.0`).

### 3.6 Command-injection surface in OCR path

**File:** `apps/api/src/lib/extract-text.ts:42-58`  
`runOcrCommand` uses `execFile` with a binary path taken from `process.env.BIDSTACK_OCRMYPDF_BIN ?? 'ocrmypdf'`, which is safe, but the `args` array includes `input` and `output` paths generated from `withTempFile`. If an attacker can control `tmpdir()` or race the temp file, the filename could contain shell metacharacters. `execFile` with an array is safer than `exec`, but the `word-extractor` path (`extractDoc`) and `node-pptx-parser` path (`extractPptx`) accept `sourcePath` directly from caller input without validation.

### 3.7 Predictive score upsert uses a fake sentinel UUID

**File:** `apps/api/src/services/predictive-scoring.service.ts:187-214`  
When no existing score is found, the code falls back to `'00000000-0000-0000-0000-000000000000'` as the `upsert` `where.id`. This relies on Prisma’s `upsert` semantics (create if not found by the `where`), but it is fragile: if a real row ever has that UUID, it will be overwritten.

```ts
where: {
  id: (
    await prisma.predictiveScore.findFirst({ ... })
  )?.id ?? '00000000-0000-0000-0000-000000000000',
},
```

---

## 4. P1 Gaps (Performance, maintainability)

### 4.1 Global `prisma` singleton destroys testability

**Files:** Nearly all service files except `dashboard.service.ts`, `company.service.ts`, `widget.service.ts`, and `enrichment.service.ts`.

Examples:

- `apps/api/src/services/activity.service.ts:1` — `import { prisma } from '@bidstack/db'`
- `apps/api/src/services/invoices/invoices.service.ts:7` — same
- `apps/api/src/services/rbac.service.ts:16` — same
- `apps/api/src/services/custom-object.service.ts:15` — same
- `apps/api/src/services/email-integration.service.ts:18` — same
- `apps/api/src/services/predictive-scoring.service.ts:26` — same

Unit tests must mock the module or hit a real DB. The convention in `dashboard.service.ts` (inject `PrismaClient` as a parameter) is the correct pattern but is not enforced.

### 4.2 Dashboard service is a 1,617-line monolith

**File:** `apps/api/src/services/crm/dashboard.service.ts`  
It mixes responsibilities:

- Snapshot orchestration (`buildDashboardSnapshot`)
- Serialization (`serializeCompany`, `serializeDeal`, `serializeWidget`, …)
- Domain logic (`buildCompanies`, `buildCockpit`, `buildActivities`)
- Data-quality reporting (`buildDataQualityReport`)
- String/date utilities (`normalizeName`, `formatMicrosCompact`, `titleCase`)
- Hardcoded seed data (`DEFAULT_WIDGETS`, `defaultBidOpportunities`, `defaultRisks`, …)

### 4.3 Sales-intelligence hardcodes currency conversion rates

**File:** `apps/api/src/services/reports/sales-intelligence.service.ts:203`  
`buildSalesOrderReport` uses `{ EUR: 1.0, USD: 1.08, CAD: 1.47 }`. These are stale/fictional and silently distort revenue reports. The same map is duplicated in `priorPeriodStats`, `buildMonthlySales`, `buildCountryRows`, `buildTeamPerformanceFromOrders`, `buildWinLossFromOrders`, and `sumMicros`.

### 4.4 `dominantCurrency` is called redundantly

**File:** `apps/api/src/services/crm/sales-dashboard.service.ts`  
`getSalesKpis` calls `dominantCurrency` once, but `getTopCountries` and `getTopCategories` each call it again in the same request. No request-level memoization exists.

### 4.5 Unbounded `findMany` with large `take` values

**File:** `apps/api/src/services/crm/dashboard.service.ts:1575-1617` (`getCompaniesOnly`)  
`getCompaniesOnly` fetches `opportunities` with `take: 200` and `enrichments` with `take: 500`. While these have a `take`, they can still pull half a megabyte of JSON for large orgs and are uncached.

### 4.6 Query-guard middleware never actually logs warnings

**File:** `apps/api/src/lib/prisma-middleware.ts:85-94`  
When the N+1 threshold (10) is crossed, the code enters an empty block with a comment: "Only log once when we cross the threshold — We don't have direct access to the Fastify logger here". The `unboundedWarnings` array is accumulated but never read by any plugin or route. The middleware is therefore inert for operational alerting.

### 4.7 `tableExists` is called repeatedly in sales-intelligence

**File:** `apps/api/src/services/reports/sales-intelligence.service.ts:75-80`  
`readSalesOrders`, `readProductRollup`, and `readCategoryRollup` each call `tableExists` independently. On a cold start for a report page this can mean 6 sequential `to_regclass` queries before any real data is fetched.

---

## 5. P2 Gaps (Nice-to-have improvements)

### 5.1 In-memory cache fallback is unbounded

**File:** `apps/api/src/lib/redis-cache.ts:4`  
`IN_MEMORY` is a plain `Map<string, { value: string; expiresAt: number }>`. If Redis is down for an extended period, the map grows without LRU eviction.

### 5.2 `cacheDel` pattern matching is naive

**File:** `apps/api/src/lib/redis-cache.ts:42-57`  
The in-memory fallback replaces `*` with an empty string and does `key.includes(...)`. This is not glob semantics; `bidstack:cache:*:user` would match `bidstack:cache:foo:users` incorrectly.

### 5.3 Custom-object search is not indexed

**File:** `apps/api/src/services/custom-object.service.ts:551-568`  
`searchRecords` casts `values_json` to `text` and uses `ILIKE`. On large tables this is a full sequential scan. A `tsvector` expression index or `jsonb_path_exists` optimization should be added later.

### 5.4 Email pull does batch upserts one-by-one

**Files:** `apps/api/src/services/email-integration.service.ts:418-487` (Gmail), `538-579` (MS Graph)  
Messages are fetched and then upserted in a `for ... of` loop. Prisma does not support bulk upsert, but the loop could be chunked with `Promise.all` (at the cost of connection-pool pressure) or offloaded to a worker queue.

### 5.5 `health-score.service.ts` computes `contractValue` from ARR without currency normalization

**File:** `apps/api/src/services/cs/health-score.service.ts:198-203`  
`arrAmountMicros` is divided by `1_000_000_000` to get a 0-100 score, but if the subscription currency is JPY or VND the denominator is wrong by orders of magnitude.

### 5.6 Onboarding template stage creation uses `Promise.all` inside a transaction

**File:** `apps/api/src/services/onboarding.service.ts:135-152`  
Prisma supports parallel queries inside an interactive transaction, but using `Promise.all` with many creates can exhaust the connection pool if templates grow. Sequential creation or `createMany` (where applicable) would be safer.

---

## 6. Evidence (specific code snippets)

### 6.1 Missing transaction around idempotency check

```ts
// apps/api/src/services/activity.service.ts:44-57
if (input.idempotencyKey) {
  const existing = await prisma.activity.findFirst({
    where: {
      orgId: input.orgId,
      entityType: input.entityType,
      entityId: input.entityId,
      idempotencyKey: input.idempotencyKey,
    },
    select: { id: true },
  });
  if (existing) return existing;
}

return prisma.activity.create({
  data: { ... },
});
```

### 6.2 External call before DB in enrichment

```ts
// apps/api/src/services/crm/enrichment.service.ts:52-63
const openProfile =
  process.env.NODE_ENV === 'test' || process.env.BIDSTACK_OPEN_ENRICHMENT_DISABLED === '1'
    ? null
    : await fetchOpenCompanyProfile({ ... }).catch((err) => {
        log.warn({ err, company: name }, 'open company data verification failed');
        return null;
      });
// ... line 106
const enrichment = await prisma.companyEnrichment.upsert({ ... });
```

### 6.3 N+1 tenant-ownership check

```ts
// apps/api/src/lib/tenant-ownership.ts:155-157
const results = await Promise.all(
  uniqueIds.map((id) => tenantEntityBelongsToOrg(entityType, id, orgId, db)),
);
return results.every(Boolean);
```

### 6.4 Hardcoded KPI in cockpit

```ts
// apps/api/src/services/crm/dashboard.service.ts:630
{ label: 'Total devices', value: '1,842', detail: 'verified data estimate', tone: 'purple' },
```

### 6.5 Fake UUID sentinel in upsert

```ts
// apps/api/src/services/predictive-scoring.service.ts:191-196
where: {
  id: (
    await prisma.predictiveScore.findFirst({
      where: { orgId, targetType: 'lead', targetId: leadId },
      select: { id: true },
    })
  )?.id ?? '00000000-0000-0000-0000-000000000000',
},
```

### 6.6 Inert N+1 threshold block

```ts
// apps/api/src/lib/prisma-middleware.ts:85-90
if (count === N_PLUS_ONE_THRESHOLD + 1) {
  // Only log once when we cross the threshold
  // We don't have direct access to the Fastify logger here without
  // plumbing, so we rely on the query-guard plugin to surface this
  // by reading store.patterns in onSend.
}
```

### 6.7 Hardcoded currency rates

```ts
// apps/api/src/services/reports/sales-intelligence.service.ts:203
const rates = args.rates ?? { EUR: 1.0, USD: 1.08, CAD: 1.47 };
```

---

## 7. Summary & Recommendation

The API services domain has a solid architectural foundation—business logic is separated from routes, several critical paths use Prisma transactions, and tenant isolation is explicit. However, the domain scores poorly on **testability** (global Prisma singleton), **transaction safety** (external calls interleaved with DB writes, race conditions), and **dashboard correctness** (hardcoded demo data mixed with real queries).

**Recommended immediate actions:**

1. Migrate all services to injected `PrismaClient` (follow `dashboard.service.ts` pattern).
2. Wrap `logActivity` idempotency check + create in a `$transaction`.
3. Remove or gate all hardcoded fallback data in `dashboard.service.ts` behind an `isDemo` flag.
4. Replace `tenantEntitiesBelongToOrg` N+1 with a single `findMany` + `Set` comparison.
5. Wire `prisma-middleware.ts` into the Fastify `onSend` hook so N+1 and unbounded-findMany warnings are actually logged.
6. Add a real currency-rate table or API client; remove hardcoded rates from `sales-intelligence.service.ts`.
