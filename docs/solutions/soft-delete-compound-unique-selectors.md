# Soft Delete Middleware and Compound Unique Selectors

## Problem

The shared Prisma soft-delete middleware rewrote `findUnique` and
`findUniqueOrThrow` calls on soft-deletable models into `findFirst` and
`findFirstOrThrow` so it could inject `deletedAt: null`. That broke compound
unique selectors such as:

```ts
prisma.dashboardWidget.findUnique({
  where: { orgId_kind: { orgId, kind } },
});
```

After the rewrite, Prisma received `findFirst({ where: { orgId_kind: ... } })`,
which is invalid because `findFirst` expects field filters, not Prisma's
compound unique selector alias.

## Solution

Before rewriting `findUnique` to `findFirst`, expand any compound unique
selector for the model into its member fields using Prisma DMMF metadata.

Example:

```ts
{ orgId_kind: { orgId, kind } }
```

becomes:

```ts
{ orgId, kind, deletedAt: null }
```

This keeps the global soft-delete behavior while preserving valid lookups for
models such as `DashboardWidget` and `CompanyEnrichment`.

## Verification

- `pnpm --filter @bidstack/db exec vitest run src/middleware/soft-delete.test.ts`
- Targeted API tests:
  - `crm/widgets.test.ts`
  - `crm/companies.test.ts`
  - `service-desk.integration.test.ts`
  - `notes.test.ts`
- Full root `pnpm test`

## Rule

When a middleware rewrites a Prisma action, verify that the argument shape is
still valid for the new action. Prisma action rewrites are not just operation
renames; they can require argument normalization.
