# Architecture — BidStack 360°

> Last reviewed: 2026-05-10. Authoritative complement to `SPEC.md`.

## Topology

```
                         ┌──────────────────────────────────────┐
                         │              Browser                 │
                         │   apps/web (React 18 + Vite)         │
                         └──────────────────────────────────────┘
                                       │   /api/*  (proxied)
                                       ▼
┌──────────────────────────────────────────────────────────────────┐
│                         apps/api (Fastify 5)                     │
│  - Zod validation                                                │
│  - Clerk stub auth (dev) / Clerk JWT (prod)                      │
│  - Org-scoped Prisma queries                                     │
│  - /webhooks/dust receiver (HMAC + dedup)                        │
└──────────────────────────────────────────────────────────────────┘
            │                                       │
            ▼                                       ▼
   ┌──────────────────┐                  ┌──────────────────────┐
   │  Postgres 16     │                  │   Redis 7 (BullMQ)   │
   │  (via Prisma 5)  │                  │   - dust-poll queue  │
   └──────────────────┘                  │   - dust-webhook q.  │
            ▲                            └──────────────────────┘
            │                                       ▲
            │                                       │
   ┌──────────────────┐                  ┌──────────────────────┐
   │  apps/mcp-server │                  │  apps/worker         │
   │  6 tools per     │                  │  Pulls Dust deltas,  │
   │  mcp.tools.md    │                  │  drains sync_events  │
   └──────────────────┘                  └──────────────────────┘
            ▲                                       │
            │ /mcp (JSON-RPC 2.0 + Bearer)         │
            │                                       │
   ┌──────────────────────────────────────────────────────────────┐
   │              Dust workspace (mantu-presales)                 │
   │  - calls our MCP tools to read/write CRM data                │
   │  - posts webhooks to /webhooks/dust                          │
   └──────────────────────────────────────────────────────────────┘
```

## Tenancy model

- Every business table has `org_id` (per `handoff/db.schema.sql`).
- The auth plugin (`apps/api/src/plugins/auth.ts`) injects `req.auth.orgId` on every request.
- Every Prisma query MUST include `where: { orgId }`. The `code-quality` rule in `.claude/rules/` is the enforcement floor; reviewer agent flags any missing scope.
- The MCP server resolves `orgId` from the API key (`apps/mcp-server/src/auth.ts`), so an MCP client can only see/mutate the org that minted the key.

## Module boundaries

| Module                 | Talks to                                                                       | Doesn't talk to                                     |
| ---------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------- |
| `apps/web`             | `/api/*` only                                                                  | DB, Redis, MCP, Dust API                            |
| `apps/api`             | DB, Redis (via worker queue), Dust client (rare — most reads happen in worker) | Browser DOM                                         |
| `apps/worker`          | DB, Redis, Dust API                                                            | API HTTP                                            |
| `apps/mcp-server`      | DB, Redis (rate limit)                                                         | Dust API directly (it serves Dust, not the reverse) |
| `packages/db`          | Postgres                                                                       | nothing else                                        |
| `packages/dust-client` | Dust HTTP API                                                                  | DB                                                  |
| `packages/shared`      | nothing — pure types/schemas                                                   | nothing                                             |

## Data flow — the Dust loop

Three patterns, all documented in `handoff/dust.integration.md`:

1. **Outbound pull (every 5 min):** `apps/worker` → `dust-client.listDocuments()` → upsert into `opportunities`/`documents`. Records a `sync_event` row with `source='dust.poll'`.
2. **Outbound push (on opportunity write):** API mutation → enqueue BullMQ job → `dust-client.upsertDocument()`. Records `sync_event` with `source='dust.push'`.
3. **Inbound webhook:** Dust → `POST /webhooks/dust` → HMAC verify → Redis dedup → write `sync_event` with `source='dust.webhook'` and `status='received'` → ack <50ms. Worker drains and processes.

## MCP exchange

Per `handoff/mcp.tools.md`. The 6 tools are registered in `apps/mcp-server/src/tools/index.ts`. Each tool:

- Validates input with Zod
- Scopes every Prisma call by `ctx.orgId` (extracted from the per-key auth context)
- Writes `audit_log` for every mutation
- Returns structured JSON

Rate limit: 60/min per API key (default `@fastify/rate-limit`); 600/hour enforced via spec but not yet implemented as a separate sliding window — will be added when production load demands it.

## Theming + dark mode

- All colors live as CSS variables in `apps/web/src/index.css`.
- `data-theme="light"` (default) and `data-theme="dark"` switch the variables.
- The Tailwind 4 `@theme` block bridges the variables into utility classes (`text-fg-primary`, `bg-surface-card`, etc.) so authors can use either form.
- Theme toggle persists to `localStorage('bidstack-theme')` and is applied **before paint** by the inline script in `index.html` to prevent FOUC.
- Initial theme defaults to `prefers-color-scheme` if no preference is saved.

## Performance budgets

Per `SPEC.md` §2.3:

- LCP < 2.5s (mobile + desktop)
- INP < 200ms
- CLS < 0.1
- Tested in `pnpm e2e` with Playwright Lighthouse audits before each release.

## Security boundaries

- Inbound: every endpoint goes through `authPlugin`; only `/health` and `/webhooks/dust` opt out (the latter has its own HMAC verification).
- Outbound: every external HTTP call (Dust, Anthropic) lives in a typed wrapper package (`@bidstack/dust-client`) so retry/backoff/timeout policies are uniform.
- Secrets: `.env.example` documents every needed key; real `.env` is gitignored; `scan-secrets.sh` hook blocks any accidental commit of common token patterns (Anthropic, Stripe, AWS, GitHub, JWT, private keys).
- CSP: `@fastify/helmet` is enabled; CSP is currently disabled in dev to allow Vite HMR; production config tightens it.
