# Tenant Scope Guard Middleware

## Problem

BidStack's tenant isolation is mostly enforced by route-level `orgId` filters.
That is strong when reviewers keep every query scoped, but one future broad
tenant-table query without `orgId` can leak or mutate cross-tenant data.

Full Postgres RLS is still the desired defense-in-depth end state (decision D2),
but it needs connection/session context design for Prisma, webhooks, workers,
and maintenance jobs. The backstop until then is a Prisma guard middleware.

## Pattern (updated 2026-07-02)

`packages/db/src/middleware/tenant-scope-guard.ts` discovers tenant models from
Prisma DMMF by the presence of an `orgId` field. When
`BIDSTACK_TENANT_SCOPE_GUARD=warn|enforce`, it applies two tiers:

**Enforced actions** — must include an `orgId` scope in `where`; `enforce`
throws, `warn` emits `TenantScopeGuardWarning`:

- `findMany`, `findFirst`
- `count`, `aggregate`, `groupBy`
- `updateMany`, `deleteMany`

**Report-only actions** — `findUnique`, `update`, `delete`, `upsert` NEVER
throw (even in enforce). An unscoped `where` emits a distinct
`[tenant-scope-guard][report-only]` warning (`TenantScopeGuardReport`). WHY:
Prisma requires a unique `where` for these ops and `orgId` is usually not part
of the unique key; the legitimate repo pattern is a prior org-scoped fetch or
`tenantEntitiesBelongToOrg`. The report stream exists to feed decision D2
(RLS vs AsyncLocalStorage backstop) with real production data.

Where-analysis rules:

- `orgId: undefined` does NOT count as scoped — Prisma silently drops
  undefined keys before building SQL, so `{ orgId: undefined }` is the exact
  all-tenants leak the guard exists to catch.
- Composite unique keys count as scoped when the key name contains `orgId`
  and its object value carries a defined `orgId`
  (e.g. `where: { orgId_userId_provider: { orgId, userId, provider } }`).
- `AND` passes when one branch scopes `orgId`; `OR` passes only when every
  branch is tenant-scoped.
- `createMany` is out of guard scope: it is a data-shape (row values), not a
  where-shape concern.
- Raw SQL (`$queryRaw`/`$executeRaw`) bypasses the guard entirely
  (`params.model` is undefined) — raw sites must self-scope and the analytics
  report builder has a dedicated tenancy test for this.

## Production requirement

`apps/api/src/env.ts` (Zod semantic check), `apps/worker/src/lib/production-env.ts`,
and `apps/mcp-server/src/production-env.ts` all refuse to boot in production
unless `BIDSTACK_TENANT_SCOPE_GUARD` is `warn` or `enforce` (`enforce`
recommended). Default remains `off` for local dev.

## Rollout

1. Run `BIDSTACK_TENANT_SCOPE_GUARD=warn` in staging and capture warnings —
   including the report-only stream from unique-key ops.
2. Rewrite intentional broad maintenance scans to iterate orgs or include
   explicit `{ orgId: { in: [...] } }` scope.
3. Flip staging to `BIDSTACK_TENANT_SCOPE_GUARD=enforce`.
4. Promote to production after staging evidence is clean.
5. Use accumulated report-only data to decide D2 (RLS vs ALS post-fetch check)
   for the unique-key ops the guard cannot enforce shape-wise.

## Verification

- `pnpm --filter @bidstack/db exec vitest run src/middleware/tenant-scope-guard.test.ts src/middleware/soft-delete.test.ts`
- `pnpm --filter @bidstack/db typecheck`
- `pnpm --filter @bidstack/db build`
- focused ESLint + Prettier
