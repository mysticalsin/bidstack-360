# Numeric Opportunity Code Allocation

## Problem

Opportunity codes use the shape `OP-<number>`. Sorting those strings
lexicographically makes `OP-9999` compare after `OP-10000`, so a system with
both rows can repeatedly mint duplicate `OP-10000`.

## Fix Pattern

- Treat the suffix as a number when allocating codes.
- Ignore non-matching custom codes for sequence math.
- Keep soft-deleted rows in the allocation scan because the `(orgId, code)`
  uniqueness constraint still owns their codes.
- Allocate bulk-import codes from one numeric read inside the transaction.

## Implementation

- `apps/api/src/routes/opportunities.helpers.ts`
  - `mintNextCodes` reads `MAX((substring(code FROM 4))::integer)` for codes
    matching `^OP-[0-9]+$`.
  - `mintNextCode` delegates to `mintNextCodes`.
- `apps/api/src/routes/opportunities.mutations.ts`
  - Bulk import uses the shared numeric allocator.

## Verification

- Integration test seeds `OP-9999` and `OP-10000` in a temp org and expects the
  next code to be `OP-10001`.
- Full API suite passes.

