# Polo Cloudflare preview (Access + box relay)

## Problem

The internal Polo preview is an Access-gated Worker
(`polo-preview.tony-walteur.workers.dev`). It cannot host the CRM. A box
process opens an outbound WebSocket; the Worker Durable Object forwards
browser HTTP to `vite preview :4180` and Fastify `:4020`. Serving `demo`
or inlining `VITE_API_URL=http://localhost:4020` makes the preview look
down after Access succeeds.

## Pattern

- Worker: verify Access JWT, never forward `CF_*` cookies or the Access
  assertion, rewrite localhost `Location` headers to the Worker origin.
- Box: checkout `main`, build the SPA with an empty `VITE_API_URL`, set
  `PUBLIC_BASE_URL` to the Worker origin, run `apps/polo-preview/src/start-box.mjs`.
- Route `/api`, `/readyz`, `/livez`, `/webhooks` to the API. Everything
  else stays on `vite preview`.
- Do not `wrangler deploy` from CI. The live Durable Object namespace and
  `RELAY_KEY` are the preview.

## Implementation

- `apps/polo-preview/`
- `apps/api/src/lib/cors-origins.ts` (port 4180 in non-prod)
- `apps/web/vite.config.ts` (`POLO_PREVIEW_WEB_PORT`)

## Verification

- `pnpm --filter @bidstack/polo-preview test`
- `pnpm --filter @bidstack/api test -- src/lib/cors-origins.test.ts`
