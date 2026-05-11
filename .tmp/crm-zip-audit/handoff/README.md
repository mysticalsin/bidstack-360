# BidStack 360° — Backend handoff package

This folder is the backend scaffold that turns the **BidStack 360°** prototype into a real product. It mirrors the prototype's data model, integrates with **Dust** (workspace API + MCP server + webhooks), and exposes a **REST API** the frontend already knows how to call.

Hand this folder to **Claude Code** with the prompt below — it will scaffold the project, install dependencies, write migrations, and wire the integrations.

---

## Prompt for Claude Code

> Build the BidStack 360° backend per `handoff/README.md`, `handoff/openapi.yaml`, `handoff/db.schema.sql`, and `handoff/dust.integration.md`. Target stack: **Node 20 + Fastify + Prisma + PostgreSQL + Redis (BullMQ) + Pino**. Auth: **Clerk** (or Auth.js). Deploy target: **Fly.io** with a managed Postgres.
>
> 1. Scaffold a monorepo with `apps/api`, `apps/worker`, `packages/db`, `packages/dust-client`, `packages/mcp-server`.
> 2. Generate Prisma schema from `db.schema.sql`, run initial migration, seed from `seed/*.json`.
> 3. Implement REST endpoints from `openapi.yaml`. Use Zod schemas generated from the OpenAPI doc.
> 4. Implement the Dust client per `dust.integration.md` (workspace agent + document API).
> 5. Implement the **MCP server** that exposes `opportunities.list`, `opportunities.get`, `opportunity.update`, `contacts.list`, `tasks.create`, `proposal.draft` as tools per `mcp.tools.md`.
> 6. Implement the **webhook receiver** (`POST /webhooks/dust`) with HMAC validation, replay protection, BullMQ enqueue.
> 7. Implement the **sync worker** (BullMQ): pull deltas from Dust every 5 min, upsert into `opportunities`/`contacts`/`documents`.
> 8. Wire **Clerk** auth + per-org row-level scoping (every table has `org_id`).
> 9. Add Pino structured logging + OpenTelemetry exporters (OTLP).
> 10. Ship a `Dockerfile` per app, a `fly.toml` per app, and a `.github/workflows/ci.yml` running typecheck + tests + migrations.

The prototype's frontend talks to this backend via the contract in `openapi.yaml` — no frontend changes needed if the backend matches the contract.

---

## What's in here

| File | Purpose |
|---|---|
| `README.md` | This file. |
| `openapi.yaml` | REST contract. The prototype already calls these paths. |
| `db.schema.sql` | Postgres DDL: orgs, users, opportunities, contacts, tasks, documents, sync_events, webhooks, api_keys. |
| `dust.integration.md` | How the backend talks to Dust (workspace API, agent runs, document upload, webhooks). |
| `mcp.tools.md` | Tool definitions exposed by the MCP server. |
| `seed/*.json` | Sample data matching the prototype's fixtures (15 opportunities, 24 contacts, …). |
| `.env.example` | Every secret the backend needs. |

---

## Environment

```
DATABASE_URL=postgres://…
REDIS_URL=redis://…
CLERK_SECRET_KEY=sk_…
DUST_API_KEY=dust_…
DUST_WORKSPACE_ID=mantu-presales
DUST_WEBHOOK_SECRET=…              # HMAC
DUST_MCP_PUBLIC_URL=https://api.bidstack.mantu.com/mcp
ANTHROPIC_API_KEY=sk-ant-…         # for proposal drafting fallback
SENTRY_DSN=…
OTEL_EXPORTER_OTLP_ENDPOINT=…
```

---

## Acceptance checklist

- [ ] `pnpm dev` brings up api + worker + mcp-server with hot reload.
- [ ] `curl /api/opportunities` returns 15 seeded records.
- [ ] Force-resync button in the prototype hits `POST /api/integrations/dust/resync` and a BullMQ job runs.
- [ ] A Dust webhook signed with `DUST_WEBHOOK_SECRET` produces a row in `sync_events` and updates the matching `opportunity`.
- [ ] MCP server registered at `${DUST_MCP_PUBLIC_URL}` shows 6 tools in the Dust agent builder.
- [ ] The Dust assistant in the prototype, when configured with a real workspace key, returns real exec briefs.
- [ ] All tables have `org_id` and queries are scoped via Clerk org middleware.
- [ ] CI runs migrations against an ephemeral Postgres on every PR.
