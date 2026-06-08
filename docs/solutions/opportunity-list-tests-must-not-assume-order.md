# Opportunity List Tests Must Not Assume Order

## Problem

Opportunity list tests can fail when they assume the first item in `/api/opportunities` is a canonical seed fixture. The API correctly sorts by `updatedAt desc`, and other integration test files can create valid opportunity records in the same seed org while Vitest runs files in parallel.

This is especially visible with RFP workflow tests that create persisted `RFP-*` opportunity codes. Those codes are valid for reads under the tolerant persisted-data contract, even though new user-supplied write codes remain canonical.

## Rule

Do not infer fixture identity from sorted list position in a shared test tenant.

List tests should verify:

- The page returns the expected shape for whatever valid record is at the head.
- The intended seed fixture is retrievable by stable identity, scoped search, or a dedicated fixture marker.

## Pattern

1. Assert `/api/opportunities?limit=N` returns items and the first item satisfies the persisted-read response contract.
2. Use Prisma or a dedicated fixture helper to locate the intended canonical seed record.
3. Use a scoped API query, such as `search=<seed.code>`, to prove the route can return that fixture.
4. Keep write-side canonical-code tests separate from read-side legacy/persisted-code tests.

## Verification

- `pnpm --filter @bidstack/api exec vitest run src/routes/opportunities.integration.test.ts --reporter=dot`
- `pnpm --filter @bidstack/api typecheck`
- `pnpm --filter @bidstack/api lint`
- `pnpm test`
- `pnpm build`
