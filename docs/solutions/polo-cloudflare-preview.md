# Polo Cloudflare preview (Access + box relay)

## Problem

The internal Polo preview is an Access-gated Worker
(`polo-preview.tony-walteur.workers.dev`). The Worker cannot host the CRM.
A Cloudflare Container runs Postgres, Redis, the API, and the built SPA, and
the Worker proxies browser HTTP to it. The container does not sleep when
idle, and a cron pings `/readyz` so a host restart is followed by a new
instance. A box WebSocket is only the fallback when that container binding
is absent. Inlining `VITE_API_URL=http://localhost:4020` makes the preview
look down after Access succeeds.

## Pattern

- Worker: verify Access JWT, never forward `CF_*` cookies or the Access
  assertion, rewrite localhost `Location` headers to the Worker origin.
- Container: one image (Postgres + Redis + API + SPA) on a Node listener
  at port 8080. Empty `VITE_API_URL`. `PUBLIC_BASE_URL` is the Worker origin.
  Entrypoint migrates and seeds. Postgres uses a 32MB shared buffer because
  the container's `/dev/shm` is 64MB.
- A cron request every minute renews the container so it does not sleep.
- Route `/api`, `/readyz`, `/livez`, `/health`, `/metrics`, `/webhooks` to
  the API. Everything else is the built SPA. `.js` and `.mjs` responses
  must be `text/javascript`; an empty type makes the browser drop the
  module and the shell falls through to the error boundary.
- Keep migration `v1` (`Relay`) unchanged. Add classes only in a later tag.
  Do not `wrangler deploy` from CI. `RELAY_KEY` stays a Worker secret.

## Implementation

- `apps/polo-preview/`
- `apps/api/src/lib/cors-origins.ts` (port 4180 in non-prod)
- `apps/web/vite.config.ts` (`POLO_PREVIEW_WEB_PORT`)

## Verification

- `pnpm --filter @bidstack/polo-preview test`
- `pnpm --filter @bidstack/api test -- src/lib/cors-origins.test.ts`
