# Polo Cloudflare preview

Internal preview: `https://polo-preview.tony-walteur.workers.dev`

Cloudflare Access (Tony, `twalteur@amaris.com`, `marc.bisiou@amaris.com`) sits
in front. The Worker is only a front door. It relays HTTP over a Durable Object
WebSocket to a box that runs the Polo API on `:4020` and `vite preview` on
`:4180`. That box must serve **`main`**.

## Why this shape

- The Worker cannot run Postgres, Redis, or the Fastify API.
- A second Worker upload that recreates the Durable Object or drops `RELAY_KEY`
  disconnects the box. The URL then returns 502 "box relay not connected".
- CI must never `wrangler deploy` this Worker. Deploy the Worker only from the
  box, by a human, after reviewing `wrangler.toml`.
- `VITE_API_URL` must be empty in the SPA build. An inlined `localhost:4020`
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

After Access sign-in, `GET /__health` returns `{ "relay": true }` when the box
is connected.

## Files

| Path | Role |
| --- | --- |
| `src/worker.js` | Access-gated Worker + `Relay` Durable Object |
| `src/protocol.js` | Path routing and header contract (tested) |
| `src/box-relay.mjs` | Box WebSocket client |
| `src/start-box.mjs` | Start API + web preview + relay from `main` |
| `wrangler.toml` | Existing account, DO class, Access AUD |

`RELAY_KEY` is a Worker secret. Never commit it.
