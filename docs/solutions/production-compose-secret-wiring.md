# Production Compose Secret Wiring

## Problem

`apps/api/src/env.ts` fails production boot when `INTEGRATION_TOKEN_KEY` is
missing or malformed, because that key encrypts per-org Dust/provider secrets
and OAuth tokens at rest. The worker also decrypts stored OAuth tokens and org
LLM credentials for email/calendar/SMS/RFP jobs.

`docker-compose.prod.yml` already required durable storage, Redis, Clerk, and
S3 settings, but it did not pass `INTEGRATION_TOKEN_KEY` into the API or worker
services. That made the local production compose path render successfully while
the API would fail boot and workers would fail credential decryption. The same
policy now also guards MCP server `DATABASE_URL` and `REDIS_URL` wiring because
that public tool surface depends on Postgres auth and shared Redis rate limits.

## Pattern

- Every production service that encrypts or decrypts tenant/provider secrets
  must receive `INTEGRATION_TOKEN_KEY`.
- Every public runtime service with hard shared dependencies must receive those
  dependencies through required interpolation.
- Compose must use required interpolation:
  `${INTEGRATION_TOKEN_KEY:?INTEGRATION_TOKEN_KEY is required}`.
- Empty defaults such as `${INTEGRATION_TOKEN_KEY:-}` are forbidden for
  production deploy descriptors.
- Keep the policy as a local evidence script so future compose edits cannot
  silently drift from the runtime env contract.

## Implementation

- `docker-compose.prod.yml`
- `scripts/verify-compose-production-policy.mjs`
- `package.json`
- `docs/RUNBOOK.md`
- `apps/mcp-server/src/production-env.ts`

## Verification

- Red policy first: `node scripts/verify-compose-production-policy.mjs` failed
  on missing API and worker `INTEGRATION_TOKEN_KEY` wiring.
- `pnpm deploy:evidence:compose:policy:selftest`: pass.
- `pnpm deploy:evidence:compose:policy`: pass.
- `node --check scripts/verify-compose-production-policy.mjs`: pass.
- `pnpm exec eslint --no-ignore --no-warn-ignored scripts/verify-compose-production-policy.mjs --max-warnings=0`:
  pass.
- `docker compose -f docker-compose.prod.yml config --quiet` with dummy
  production-shaped env: pass.
- `pnpm deploy:evidence:compose:policy:selftest`: pass after adding poisoned
  coverage for missing MCP `REDIS_URL`.

## Remaining Risk

This proves local compose wiring. It does not prove live Azure/Container Apps,
Kubernetes, or platform secret-store values, and it does not execute a live
token rotation. Keep Azure policy, secret-history disposition, staging smoke,
and platform/security approval as separate release gates.

## 2026-06-19 Web Ingress Publish Guard

The production compose descriptor had a reachable marketing site
(`8081:8080`) but no published port for the main `web` service. Since the web
container uses unprivileged nginx on container port `8080`, a local
self-hosted production compose run could render successfully while the primary
CRM UI was unreachable from the host.

Pattern:

- Main web service publishes container port `8080`.
- Host port is configurable through `WEB_HTTP_PORT`, defaulting to `8080`.
- The compose policy fails if the `web` service loses its `target: web`,
  `depends_on: api`, or `ports` mapping to container `8080`.

Implementation:

- `docker-compose.prod.yml`
- `.env.example`
- `scripts/verify-compose-production-policy.mjs`
- `docs/RUNBOOK.md`

Verification:

- `pnpm deploy:evidence:compose:policy:selftest`: pass.
- `pnpm deploy:evidence:compose:policy`: pass.
- `node --check scripts/verify-compose-production-policy.mjs`: pass.
- `pnpm exec eslint --no-ignore --no-warn-ignored scripts/verify-compose-production-policy.mjs --max-warnings=0`:
  pass.
- `docker compose -f docker-compose.prod.yml config --quiet` with dummy
  production-shaped env and `WEB_HTTP_PORT=18080`: pass.

## 2026-06-19 Web API Health-Gated Startup

Publishing the web service is necessary, but not sufficient for a reliable
self-hosted production rollout. The CRM web container proxies `/api` to the API
service, so the production compose path now waits for the API service health
check instead of only waiting for the API container to be created.

Pattern:

- `web.depends_on.api.condition` must be `service_healthy`.
- The compose policy keeps the older existence check and adds a poisoned test
  that rejects short-form `depends_on: - api`.
- Docker Compose's own parser must accept the rendered config with
  production-shaped env values.

Implementation:

- `docker-compose.prod.yml`
- `scripts/verify-compose-production-policy.mjs`

Verification:

- `node --check scripts/verify-compose-production-policy.mjs`: pass.
- `pnpm deploy:evidence:compose:policy:selftest`: pass.
- `pnpm deploy:evidence:compose:policy`: pass.
- `pnpm exec eslint --no-ignore --no-warn-ignored scripts/verify-compose-production-policy.mjs --max-warnings=0`:
  pass.
- `docker compose -f docker-compose.prod.yml config --quiet` with dummy
  production-shaped env and `WEB_HTTP_PORT=18080`: pass.
