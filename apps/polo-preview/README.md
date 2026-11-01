# Polo Cloudflare preview

Internal preview: `https://polo-preview.tony-walteur.workers.dev`

Cloudflare Access (Tony, `twalteur@amaris.com`, `marc.bisiou@amaris.com`) sits
in front. The Worker proxies HTTP to one Cloudflare Container (`PreviewOrigin`)
that runs Postgres, Redis, the Fastify API, and the built SPA. A cron hits
`/readyz` every minute, and the container does not sleep when idle, so the
preview stays up without a laptop connected.

The box WebSocket remains a fallback for a Worker that has no `PREVIEW`
binding. It is not required once the container is deployed.

## Why this shape

- The Worker still cannot run Postgres, Redis, or Fastify. The container can.
- Container disk is ephemeral and `/dev/shm` is 64MB. Postgres starts with
  `shared_buffers=32MB`. A new instance migrates and seeds on boot. Data
  written in the preview does not survive a host restart.
- Migration tag `v1` (`Relay`) must stay as it was applied. Tag `v2` only adds
  `PreviewOrigin`. Deleting `Relay` or dropping `RELAY_KEY` disconnects the
  box path. Wrangler keeps secrets that are not in `wrangler.toml`.
- CI must not upload this Worker. A binding or migration mismatch is what
  takes the Access URL down.
- `VITE_API_URL` is empty in the image build. An inlined `localhost:4020`
  sends the visitor's browser to their own machine.

## Switch the box to `main`

```bash
git fetch origin main
git checkout --detach origin/main
pnpm install --frozen-lockfile
pnpm db:generate
pnpm --filter @bidstack/shared --filter @bidstack/db --filter @bidstack/dust-client --filter @bidstack/odoo-mcp-client build
pnpm --filter @bidstack/web build
PUBLIC_BASE_URL=https://polo-preview.tony-walteur.workers.dev \
  RELAY_KEY=... \
  node apps/polo-preview/src/start-box.mjs
```

`start-box.mjs` reuses API `:4020` and web `:4180` if they are already up, then
opens the relay. Only one box should connect; a second client replaces the first.

## Health

After Access sign-in, `GET /__health` returns `origin: "container"` and
`container.ready: true` when the Cloudflare stack is answering `/readyz`.
`relay: true` still means a box socket is connected. It is not required.

## Files

| Path | Role |
| --- | --- |
| `src/worker.js` | Access-gated Worker, `Relay`, and `PreviewOrigin` |
| `src/protocol.js` | Path routing, origin choice, header contract (tested) |
| `Dockerfile` | Postgres + Redis + API + SPA image |
| `src/preview-entrypoint.sh` | Migrate, seed, and serve on port 8080 |
| `src/box-relay.mjs` | Optional box WebSocket client |
| `src/start-box.mjs` | Optional laptop API + web preview + relay |
| `wrangler.toml` | Account, both Durable Object classes, container, cron |

`RELAY_KEY` is a Worker secret. Never commit it.
