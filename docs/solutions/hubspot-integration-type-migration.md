# HubSpot Integration Type Migration

## Problem

HubSpot OAuth migration credentials were stored in `IntegrationConfig` with
`type='salesforce'` and `name='hubspot-migration'` because the
`integration_type` enum did not include `hubspot`.

That made the integration inventory ambiguous: Salesforce and HubSpot credentials
shared the same provider type, operational review could not cleanly prove which
external system owned the secret material, and future sync/rotation workflows
could accidentally treat HubSpot migration credentials as Salesforce config.

## Solution

- Add `hubspot` to the Prisma `IntegrationType` enum.
- Add an idempotent enum migration:
  `packages/db/prisma/migrations/20260619140000_hubspot_integration_type/migration.sql`.
- Add a follow-up data migration:
  `packages/db/prisma/migrations/20260619140500_hubspot_integration_config_backfill/migration.sql`.
- Backfill legacy `salesforce` rows whose name is `hubspot-migration` and whose
  JSON config says `provider='hubspot'`.
- If a canonical HubSpot row already exists for the same org/name, deactivate
  the old Salesforce-typed duplicate instead of violating the unique constraint.
- Route HubSpot OAuth callback upserts and import startup lookups through
  dedicated helper coordinates that always use `type='hubspot'`.

## Verification

- `pnpm --filter @bidstack/db generate`: pass; generated client exposes
  `IntegrationType.hubspot`.
- `$env:DATABASE_URL='postgresql://user:pass@localhost:5432/bidcrm'; pnpm exec prisma validate`:
  pass.
- `pnpm --filter @bidstack/db build`: pass.
- `pnpm --filter @bidstack/api exec tsc --noEmit --pretty false`: pass.
- `pnpm --filter @bidstack/api exec vitest run src/routes/migrations-hubspot.routes.test.ts --reporter=dot`:
  1/1 pass.
- `pnpm --filter @bidstack/api exec eslint --no-ignore --no-warn-ignored src/routes/migrations-hubspot.routes.ts src/routes/migrations-hubspot.routes.test.ts --max-warnings=0`:
  pass.
- Scoped `git diff --check`: pass with only existing LF-to-CRLF normalization
  warnings on touched tracked files.

## Residual Risk

- This fixes the data-model bug and deploy migration path. It does not prove a
  live HubSpot OAuth round trip; that still needs staging HubSpot app
  credentials and callback-domain evidence.
