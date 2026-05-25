# API Architecture Audit

**Date:** 2026-05-23  
**Scope:** `apps/api/src/routes/*`, `apps/api/src/plugins/error-handler.ts`, `services/crm/dashboard.service.ts`  
**Auditor:** API Architecture Audit Agent

---

## Summary

- **Route files analyzed:** 46 non-test `.ts` route files
- **Largest route file:** `apps/api/src/routes/invoices.ts` (845 lines)
- **Missing transaction boundaries:** 41 `prisma.$transaction` usages across routes; critical gaps in read-burst endpoints (`crm/dashboard`, `crm/summary`) and `territories.ts` (0 transactions)
- **Org-scoping coverage:** 97% file-level (37/38 files with Prisma queries scope by `orgId`; only `health.ts` is exempt by design)
- **Top risk:** Unbounded concurrent query bursts in CRM dashboard/summary services cause intermittent 500s under load (C-2)

> **Note:** `apps/api/src/routes/crm.ts` does not exist. The CRM dashboard endpoint is in `crm/dashboard.ts` (45 lines) and delegates to `services/crm/dashboard.service.ts` (1,594 lines) — the actual source of the reported 1,590-line bloat.

---

## Findings

| Severity | File | Line | Issue | Evidence | Fix |
|----------|------|------|-------|----------|-----|
| 🔴 Critical | `services/crm/dashboard.service.ts` | 111–315 | C-2: 12 heavy Prisma queries fired via `Promise.all` with no transaction boundary, query timeout, or circuit breaker | `buildDashboardSnapshot` runs 12 `findMany`/`findFirst` concurrently; any single failure cascades to 500 | Wrap in `prisma.$transaction` or `Promise.allSettled` with per-query timeouts; add connection-pool guard |
| 🔴 Critical | `apps/api/src/routes/crm/dashboard.ts` | 29 | Route catches then re-throws all errors, preventing granular diagnostics for C-2 | `catch (err) { req.log.error(...); throw err; }` | Remove redundant catch (Fastify handler already logs) or add structured error metadata per query |
| 🟠 High | `apps/api/src/routes/invoices.ts` | 1–845 | Route bloat: 845 lines mixing state machine, AR aging, serializers, and Prisma calls | Largest route file; inline `mintNextInvoiceNumber`, `resolveLineSubtotal`, `loadInvoiceDetail` | Extract invoice service layer; keep routes as thin HTTP adapters |
| 🟠 High | `apps/api/src/routes/territories.ts` | 1–735 | Route bloat: 735 lines with 200-line static country-code table and zero transaction boundaries | `A2_TO_A3` map (lines 17–100+), inline `byCountry` aggregation; `grep` shows 0 `$transaction` | Extract country mapping to shared constants; move aggregation to service; wrap multi-step writes in `$transaction` |
| 🟠 High | `apps/api/src/routes/agents.ts` | 1–732 | Route bloat: 732 lines mixing Dust client, Claude API schemas, serializers, and Prisma queries | `getDustClient()`, `ClaudeMessagesResponse` schema, `serializeAgentRun` all inline | Extract agent orchestration service; keep only HTTP wiring in route |
| 🟠 High | `apps/api/src/plugins/error-handler.ts` | 21–45 | Incomplete Prisma error mapping: only P2002/P2025/P2003 handled; timeouts and connection errors become opaque 500s | Missing P2024 (timeout), P2034 (tx conflict), `PrismaClientInitializationError` | Add explicit handlers for timeout, connection, and transaction-conflict errors |
| 🟡 Medium | `apps/api/src/routes/crm/summary.ts` | 5–97 | 14 concurrent Prisma queries in `Promise.all` with no transaction/timeout — same pattern as C-2 | `Promise.all` with 14 `count`/`findMany`/`aggregate` calls | Apply same fix as dashboard: bounded concurrency, timeout, or `$transaction` |
| 🟡 Medium | `apps/api/src/routes/*` | Various | 213 inline `z.object` declarations across routes create duplication and schema-drift risk | `grep -rn "z.object" apps/api/src/routes` → 213 matches | Centralize request/response schemas in `packages/shared` or per-domain schema files |
| 🟡 Medium | `services/crm/dashboard.service.ts` | 1–1594 | 1,594-line monolith mixing data access, serialization, business logic, and hardcoded defaults | `DEFAULT_WIDGETS`, `defaultBidOpportunities`, `fallbackCompany` all hardcoded in service | Split into `dashboard-query.service.ts`, `dashboard-serialize.service.ts`, and default-data module |
| 🟡 Medium | `apps/api/src/routes/invoices.ts` | 67–94 | `loadInvoiceDetail` runs 2 sequential Prisma reads (`findFirst` + `findMany`) without transaction consistency | `await prisma.invoice.findFirst(...)` then `await prisma.auditLog.findMany(...)` | Wrap reads in `prisma.$transaction` for snapshot consistency or collapse via `include` |
| 🟡 Medium | `apps/api/src/routes/crm/summary.ts` | 5 | Route ships without any Zod request/response schema validation | No `schema:` property in `app.get('/crm/summary', ...)` | Add `querystring` and `response` schemas using fastify-type-provider-zod |
| 🟡 Medium | `apps/api/src/routes/crm/summary.ts` | 6 | Unsafe auth access via `reply.request as unknown` bypasses typed Fastify auth plugin | `const orgId = (reply.request as unknown as { auth?: { orgId: string } }).auth?.orgId;` | Use `req.auth.orgId` via typed `onRequest` hook; remove cast |
| 🟢 Low | `apps/api/src/routes/health.ts` | 21 | Health probe uses raw `$queryRaw` without org scoping | `prisma.$queryRaw`SELECT 1`` | No action needed — health checks are global by definition |

---

## C-2 Root-Cause Analysis

The intermittent 500 on `/api/v1/crm/dashboard?account={id}` is not caused by the route file itself (`crm/dashboard.ts` is only 45 lines and correctly delegates to a service). The root cause lies in `services/crm/dashboard.service.ts`:

1. **Unbounded concurrency:** `buildDashboardSnapshot` fires 12 independent Prisma queries simultaneously via `Promise.all`. Under connection-pool pressure, any single query can fail with a timeout or connection error.
2. **No transaction wrapper:** The 12 queries are not wrapped in `prisma.$transaction`, so there is no atomicity or automatic retry on transient failures.
3. **Opaque error handling:** The route’s `catch` block logs and re-throws, and the centralized error handler does not map Prisma timeout/connection errors to meaningful status codes — everything becomes a generic 500.
4. **Sister endpoint at risk:** `crm/summary.ts` replicates the same anti-pattern with 14 concurrent queries.

**Recommended immediate fix:** Replace `Promise.all` with `Promise.allSettled` in both services, log individual query failures, return partial data with a degraded flag, or wrap in `prisma.$transaction` with a timeout.
