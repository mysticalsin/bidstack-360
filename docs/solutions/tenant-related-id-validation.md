# Tenant Related ID Validation

## Problem

Mutation routes can accept related record IDs such as `productId`, `opportunityId`,
`accountId`, or `contactId`. If the route writes those IDs directly into a nested
Prisma mutation, the database may reject bad IDs, but the application has already
missed the tenant boundary and will return an inconsistent persistence error.

## Pattern

Validate every related ID by `{ id, orgId }` before building the write payload.
Use the shared guard in `apps/api/src/lib/tenant-ownership.ts`:

```ts
const ids = rows.map((row) => row.productId).filter((id): id is string => Boolean(id));
if (!(await tenantEntitiesBelongToOrg('product', ids, req.auth.orgId))) {
  throw server.httpErrors.notFound('Product not found');
}
```

Then build the Prisma mutation using only validated IDs.

## Rules

- Do the validation before any create/update/delete transaction starts.
- Return `404` for related IDs outside the tenant, same as missing IDs.
- Keep the check close to the route input so reviewers can see the tenant boundary.
- Nested writes are not tenant validation; they are persistence mechanics.

## Verification

Add a negative test that attempts to attach a related ID from another org and
expects the route-level error. The test should fail before the guard and pass
after it, without logging a Prisma foreign-key violation.
