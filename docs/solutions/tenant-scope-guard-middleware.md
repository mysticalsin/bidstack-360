# Tenant Scope Guard Middleware

## Problem

BidStack's tenant isolation is mostly enforced by route-level `orgId` filters.
That is strong when reviewers keep every query scoped, but one future broad
tenant-table query without `orgId` can leak or mutate cross-tenant data.

Full Postgres RLS is still the desired defense-in-depth end state, but it needs
connection/session context design for Prisma, webhooks, workers, and maintenance
jobs. The safe first backstop is an opt-in Prisma guard for broad operations.

## Pattern

`packages/db/src/middleware/tenant-scope-guard.ts` discovers tenant models from
Prisma DMMF by the presence of an `orgId` field. When
`BIDSTACK_TENANT_SCOPE_GUARD=warn|enforce`, it checks these broad actions:

- `findMany`
- `count`
- `aggregate`
- `groupBy`
- `updateMany`
- `deleteMany`

Those actions must include an `orgId` scope in `where`. `AND` predicates pass
when one branch scopes `orgId`; `OR` predicates pass only when every branch is
tenant-scoped.

Single-record ownership-resolution paths such as `findFirst({ where: { id } })`
remain untouched in this first slice. That keeps webhook secret lookup and other
id-first ownership checks from breaking before a full RLS design lands.

## Rollout

1. Run `BIDSTACK_TENANT_SCOPE_GUARD=warn` in staging and capture warnings.
2. Rewrite intentional broad maintenance scans to iterate orgs or include
   explicit `{ orgId: { in: [...] } }` scope.
3. Flip staging to `BIDSTACK_TENANT_SCOPE_GUARD=enforce`.
4. Promote to production after staging evidence is clean.

## Verification

- `pnpm --filter @bidstack/db exec vitest run src/middleware/tenant-scope-guard.test.ts src/middleware/soft-delete.test.ts`
- `pnpm --filter @bidstack/db typecheck`
- `pnpm --filter @bidstack/db build`
- focused ESLint + Prettier
