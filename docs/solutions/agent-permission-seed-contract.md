# Agent Permission Seed Contract

When a route requires a permission from the shared RBAC contract, the seed
catalog must create that permission for every real org. A permission that exists
in code but not in the seed silently breaks production authorization because
roles cannot be granted something the DB catalog never created.

Pattern:

- keep route guards, shared permission keys, RBAC matrix fixtures, and the seed
  permission catalog in lockstep;
- use a permission-sync test that fails when shared permission keys are missing
  from the seed catalog;
- keep the known-unseeded allowlist small, explicit, and temporary;
- after changing `packages/db/src/seed.rbac.ts`, rebuild `@bidstack/db` before
  running API tests that consume the package from `packages/db/dist`;
- for tests that mutate RBAC mocks or role state, clear any authorization cache
  before the next assertion with the same org/user/permission tuple.

Regression shape:

- a focused DB test proves every seeded permission expected by routes exists;
- an API route test exercises the protected operation through the same
  permission key used in production;
- the full root `pnpm test` must pass after rebuilding `@bidstack/db`, not just
  the package-local test.
