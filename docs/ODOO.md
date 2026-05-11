# Odoo MCP integration

BidStack 360° can read and write Odoo records by acting as an MCP client of
[ivnvxd/mcp-server-odoo](https://github.com/ivnvxd/mcp-server-odoo) — a Python
MCP server that wraps Odoo's XML-RPC API.

This satisfies the "Twenty as MCP client consuming external MCP servers"
clause of `SPEC.md`. The Odoo MCP server runs as a sidecar; BidStack never
sees Odoo credentials directly.

## Topology

```
            ┌──────────────────────────────┐
            │ apps/api  (Node, Fastify)    │
            │  /api/integrations/odoo/*    │
            │     │                        │
            │     ▼                        │
            │ @bidstack/odoo-mcp-client    │
            │  (JSON-RPC 2.0 over          │
            │   streamable-http)           │
            └─────────────┬────────────────┘
                          │ HTTP POST
                          ▼
            ┌──────────────────────────────┐
            │ mcp-server-odoo (Python)     │
            │   docker-compose sidecar     │
            │   --transport streamable-http│
            │     │                        │
            │     ▼                        │
            │   Odoo XML-RPC               │
            └──────────────────────────────┘
```

## Packages and files

| Path                                                | Role                                                        |
| --------------------------------------------------- | ----------------------------------------------------------- |
| `packages/odoo-mcp-client/`                         | Typed MCP-client wrapper. Hand-rolled JSON-RPC, no SDK dep. |
| `apps/api/src/routes/odoo-integration.ts`           | Fastify routes mounted under `/api/integrations/odoo`.      |
| `apps/web/src/components/integrations/OdooCard.tsx` | Status card shown on the Integrations page.                 |
| `docker-compose.yml` → `mcp-server-odoo`            | Profile-gated sidecar (`docker compose --profile odoo up`). |

## Environment variables

Two layers — keep them straight.

### Sidecar config (`mcp-server-odoo` container)

| Var                            | Required | Notes                                                                |
| ------------------------------ | -------- | -------------------------------------------------------------------- |
| `ODOO_URL`                     | yes      | Base URL of the Odoo instance (e.g. `https://mantu.odoo.com`).       |
| `ODOO_DB`                      | yes      | Odoo database name.                                                  |
| `ODOO_API_KEY`                 | one of   | Recommended. Generate one under your Odoo user profile.              |
| `ODOO_USER` / `ODOO_PASSWORD`  | one of   | Fallback when API keys aren't available.                             |
| `ODOO_LOCALE`                  | no       | Defaults to `en_US`.                                                 |
| `ODOO_YOLO`                    | no       | Bypasses the Odoo `mcp-server` module — demos only, don't ship.      |
| `ODOO_MCP_ENABLE_METHOD_CALLS` | no       | Set `true` to expose `call_model_method`. Off by default for safety. |

### BidStack client config (`apps/api`)

| Var                     | Required | Notes                                                                                                                           |
| ----------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `ODOO_MCP_URL`          | yes      | URL the API uses to reach the sidecar. In compose: `http://mcp-server-odoo:8000/mcp`. On the host: `http://localhost:8001/mcp`. |
| `ODOO_MCP_BEARER_TOKEN` | no       | Only if a reverse proxy gates the sidecar.                                                                                      |
| `ODOO_MCP_TIMEOUT_MS`   | no       | Per-request timeout. Defaults to 15 s.                                                                                          |

## Local boot

```sh
# 1. Add the Odoo block in .env (see .env.example for the keys).
cp .env.example .env  # if you haven't already

# 2. Start the standard stack plus the Odoo sidecar.
docker compose --profile odoo up -d

# 3. Smoke-check the sidecar.
curl -sf http://localhost:8001/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json,text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}'

# 4. Run the API and check the BidStack-side probe.
pnpm dev:api
curl -sf http://localhost:4000/api/integrations/odoo/status | jq
```

Open the Integrations page in the web app to see the **Odoo MCP** card.
When everything works the badge reads `live` and the four-up grid shows the
endpoint host, the database name, the MCP tool count, and `reachable`.

## API surface

All routes mounted under `/api/integrations`. v0.1 ships read-only; write
methods exist on the client but aren't proxied through HTTP yet — mutations
go through MCP only, gated by the API key scopes already enforced by
`apps/mcp-server`.

| Method | Path               | What it does                                                              |
| ------ | ------------------ | ------------------------------------------------------------------------- |
| GET    | `/odoo/status`     | Configured? Reachable? Returns the live tool count or last error.         |
| GET    | `/odoo/models`     | Proxies `list_models` — the list of Odoo models the user can see.         |
| POST   | `/odoo/search`     | Body: `{model, domain?, fields?, limit?, offset?, order?}`. Returns rows. |
| GET    | `/odoo/:model/:id` | Single record fetch. 404 if Odoo says it doesn't exist.                   |

## Client API surface

Imported via `@bidstack/odoo-mcp-client`:

```ts
import { OdooMcpClient } from '@bidstack/odoo-mcp-client';

const odoo = new OdooMcpClient({ url: process.env.ODOO_MCP_URL! });

const partners = await odoo.searchRecords<Partner[]>({
  model: 'res.partner',
  domain: [['is_company', '=', true]],
  fields: ['name', 'email', 'vat'],
  limit: 25,
});
```

Tool helpers: `searchRecords`, `getRecord`, `createRecord`, `updateRecord`,
`deleteRecord`, `aggregateRecords`, `postMessage`, `callModelMethod`,
`listModels`. All call through to the MCP `tools/call` dispatcher and parse
the result envelope — preferring `structuredContent` when present, falling
back to JSON-parsing the first text block.

## Operational notes

- **Auth lives in the sidecar.** BidStack never carries Odoo credentials.
  Rotate Odoo API keys without redeploying BidStack.
- **Profile gate.** The sidecar is opt-in via `--profile odoo`. Devs who
  don't have an Odoo instance don't get a perpetually-failing container.
- **Multi-tenancy.** v0.1 = one global Odoo connection per BidStack
  deployment. Per-org Odoo wiring is a follow-up (will need a `OdooConnection`
  table keyed on `orgId` + secret encryption at rest).
- **Method calls off by default.** `call_model_method` is powerful enough to
  trigger arbitrary Odoo server actions. Keep `ODOO_MCP_ENABLE_METHOD_CALLS`
  off unless you have a specific workflow that needs it.

## Compound engineering

When extending: prefer adding helpers to `@bidstack/odoo-mcp-client` rather
than hand-writing `client.callTool('foo', …)` at the call site. The wrapper
is the right level of abstraction for "this is what Odoo can do for us."
