# API connectivity domain smoke

## Problem

Health probes and `/api/me/capabilities` prove that the API process, dependencies, and auth context are alive, but they do not prove a real CRM domain route executes through the deployed REST surface.

## Solution

`deploy:evidence:api` now runs an authenticated, read-only, no-match `GET /api/companies?search=__bidstack_release_probe_no_match__&limit=1` smoke after the health/auth checks.

The artifact stores only:

- endpoint path
- HTTP status
- response shape
- item count
- no-match/privacy flags

It must not store raw rows, raw bodies, or customer data.

## Verification

- `node --check scripts/write-api-connectivity-evidence.mjs`
- `node --check scripts/verify-deploy-evidence.mjs`
- `pnpm deploy:evidence:api:selftest`
- `pnpm deploy:evidence:selftest`

## Next

Run `pnpm deploy:evidence:api` against staging/production with a non-local target and an API key or bearer token that can read `/api/companies`.
