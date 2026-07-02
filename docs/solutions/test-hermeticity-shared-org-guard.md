# Test Hermeticity Shared Org Guard

## Problem

Route integration tests previously depended on one shared seed tenant,
`org_seed_mantu`. That made repeated or parallel-ish runs brittle: one file could
mutate RBAC, records, or cleanup state that another file silently reused.

## Contract

API tests must use throwaway tenant setup through
`apps/api/src/test-support/isolated-org.ts`:

- `createIsolatedOrg()`
- `useIsolatedOrgAuth()`
- `dropIsolatedOrg()`

The shared seed org is now banned from API test files by
`scripts/verify-test-hermeticity.mjs`.

## Enforcement

Root `pnpm test` starts with `pnpm test:hermeticity`. The check recursively scans
`apps/api/src` test files and fails if `org_seed_mantu` appears. This makes the
old non-determinism class a CI-visible regression instead of a relay warning.

Run directly:

```powershell
pnpm test:hermeticity
pnpm test:hermeticity:selftest
```

## Limit

This is a static guard for the known shared-org failure mode. It does not replace
the live 10-run CI evidence artifact required for release certification.
