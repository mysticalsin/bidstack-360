# Account access scope and dev proxy verification

## Problem

Account-level CRM surfaces can drift from opportunity-level permissions when
the account route accepts company names, slugs, legacy account ids, or company
UUIDs. Browser QA can also produce false failures when Vite points at a stale
API or when `VITE_API_URL` forces direct cross-origin requests to a dev API that
does not emit CORS headers.

## Pattern

- Centralize account read checks in one helper that accepts company UUID,
  company name, normalized slug, and legacy opportunity account ids.
- Derive account access from the same scope rules as opportunities: unrestricted
  users pass; restricted users need company country, key account ownership, or a
  visible scoped opportunity.
- Apply scoped predicates at every list and mutation boundary before returning
  account cockpit, notes, files, account intel, and account tier data.
- Include the access-scope cache tag in dashboard cache keys so a stale
  unrestricted snapshot cannot be reused for a restricted user.
- For browser QA against a non-default API port, use a server-only Vite proxy
  env var such as `BIDSTACK_DEV_API_URL=http://127.0.0.1:4001` and leave
  `VITE_API_URL` empty. This keeps browser requests same-origin while the proxy
  targets the fresh API.

## Verification

- Add an integration test where a scoped user can read an in-scope account but
  gets `403` for out-of-scope account strategy, files, and notes.
- Add route tests for fail-soft control-plane status endpoints that read optional
  backend signals.
- In Playwright, verify the browser target's served `api.ts` has no
  `VITE_API_URL` for local proxy mode, then assert the proxied `/api/v1/...`
  endpoint reaches the fresh API.

## Files from 2026-06-16 slice

- `apps/api/src/lib/account-access.ts`
- `apps/api/src/lib/access-scope.ts`
- `apps/api/src/routes/accounts.ts`
- `apps/api/src/routes/crm/companies.ts`
- `apps/api/src/routes/files.ts`
- `apps/api/src/routes/notes.ts`
- `apps/api/src/routes/account-intel.ts`
- `apps/api/src/routes/serum.ts`
- `apps/web/vite.config.ts`

## 2026-06-18 Global Curation Guard

`PUT /api/v1/accounts/top-list` replaces a global top-account curation and
clears existing ranks before writing the new order. That operation is broader
than a single visible account mutation, so it now requires an unrestricted
account scope before any company validation or rank-clearing transaction runs.

Why: a user can legitimately hold `accounts:write` while also being scoped to a
country/group. Letting that caller replace the global list would mutate
out-of-scope company ranking and could erase ranks they are not allowed to see.

Verification:

- `pnpm --filter @bidstack/api test -- src/routes/user-groups.integration.test.ts --reporter=dot`:
  6/6 pass. Proves a group-scoped writer gets `403` for global curation and
  the fixture company ranks remain unchanged.
- `pnpm --filter @bidstack/api test -- src/routes/accounts.integration.test.ts --reporter=dot`:
  9/9 pass. Proves unrestricted/admin curation still works.
- `pnpm --filter @bidstack/api exec eslint src/routes/accounts.ts src/routes/user-groups.integration.test.ts`:
  pass.
- `pnpm --filter @bidstack/api typecheck`: pass.
