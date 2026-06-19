# HubSpot Migration Queue Secret Hygiene

## Problem

HubSpot import chunks were enqueued with raw OAuth token material in
`MigrationJobPayload.meta`:

- `accessToken`
- `refreshToken`
- `expiresAt`

BullMQ persists job payloads in Redis. For enterprise migration traffic, that
turns Redis into a secondary secret store and makes queue inspection, backups,
and incident response materially riskier.

## Solution

- Keep OAuth tokens encrypted in `IntegrationConfig.credentials`.
- Enqueue only a non-secret `hubspotIntegrationConfigId` reference.
- Make the worker resolve and decrypt the HubSpot access token just in time.
- Keep paginated follow-up jobs copying only the same non-secret reference.
- Add a shared schema guard that rejects raw secret-looking keys in
  `MigrationJobPayload.meta`.
- Keep accepted metadata limited to stable references such as
  `hubspotIntegrationConfigId`.

## Verification

- `pnpm --filter @bidstack/shared exec vitest run src/schemas/migration.test.ts --reporter=dot`:
  2/2 pass.
- `pnpm --filter @bidstack/api exec vitest run src/routes/migrations-hubspot.routes.test.ts --reporter=dot`:
  2/2 pass.
- `pnpm --filter @bidstack/worker exec vitest run src/queues/migration.hubspot-credentials.test.ts --reporter=dot`:
  2/2 pass.
- `pnpm --filter @bidstack/worker exec vitest run src/queues/migration.helpers.test.ts src/queues/migration.hubspot-credentials.test.ts --reporter=dot`:
  11/11 pass.
- `pnpm --filter @bidstack/shared build`: pass.
- `pnpm --filter @bidstack/api exec tsc --noEmit --pretty false`: pass.
- `pnpm --filter @bidstack/worker exec tsc --noEmit --pretty false`: pass.
- Targeted ESLint for touched shared/API/worker files: pass.
- Scoped `git diff --check`: pass with only LF-to-CRLF normalization warnings
  on touched tracked files.

## Residual Risk

- Existing queued HubSpot jobs created before this change may contain raw token
  metadata until they complete or expire. Before a production cutover, drain or
  clear pre-change `migration` queue entries from non-production Redis.
- Live HubSpot OAuth and import still need staging credentials/callback evidence.
