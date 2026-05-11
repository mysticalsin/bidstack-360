# MCP server — implementation notes

> Companion to `handoff/mcp.tools.md`. This file documents _how_ the server is built and how to test it locally.

## Transport

JSON-RPC 2.0 over plain HTTP. The MCP spec also allows SSE; we omit the SSE leg from v0.1 because Dust's MCP client supports HTTP-only registration.

- **POST /mcp** — JSON-RPC 2.0 envelope (`{ jsonrpc, id, method, params }`)
- **GET /.well-known/mcp** — server metadata (name, version, transport, endpoints)
- **GET /health** — liveness probe (public, no auth)

## Tools

| Tool                 | Source file                                                                                             |
| -------------------- | ------------------------------------------------------------------------------------------------------- |
| `opportunities.list` | [`apps/mcp-server/src/tools/opportunities-list.ts`](../apps/mcp-server/src/tools/opportunities-list.ts) |
| `opportunities.get`  | [`apps/mcp-server/src/tools/opportunities-get.ts`](../apps/mcp-server/src/tools/opportunities-get.ts)   |
| `opportunity.update` | [`apps/mcp-server/src/tools/opportunity-update.ts`](../apps/mcp-server/src/tools/opportunity-update.ts) |
| `contacts.list`      | [`apps/mcp-server/src/tools/contacts-list.ts`](../apps/mcp-server/src/tools/contacts-list.ts)           |
| `tasks.create`       | [`apps/mcp-server/src/tools/tasks-create.ts`](../apps/mcp-server/src/tools/tasks-create.ts)             |
| `proposal.draft`     | [`apps/mcp-server/src/tools/proposal-draft.ts`](../apps/mcp-server/src/tools/proposal-draft.ts)         |

Each tool exports a `Tool` object with:

- `description` — surfaced in `tools/list`
- `input` — Zod schema for runtime validation
- `inputJsonSchema` — JSON Schema mirror for Dust's tool-discovery UI
- `handler(args, ctx)` — the work; receives the validated args and the per-key auth context

## Auth

```
Authorization: Bearer <bidstack API key with `mcp` scope>
```

Mint a key via `POST /api/integrations/api-keys` (returns the secret **once** in the response — store it securely). The MCP server hashes the bearer with SHA-256 and looks it up in `api_keys.hashed_key`. Org-scoping flows from the key's `org_id` column into every tool's Prisma queries.

Lacking the `mcp` scope returns `403 Forbidden`. A revoked key returns `401 Unauthorized`.

## Rate limit

`@fastify/rate-limit`: **60 requests / minute per API key** (keyed on a SHA-256 of the bearer to avoid logging tokens). Returns `429 Too Many Requests` with `Retry-After` header. The mcp.tools.md spec also describes a 600/hour secondary window — to be added when production load demands it.

## Local testing

With Postgres and Redis running (`docker compose up -d`) and the API + MCP servers running (`pnpm dev`):

```bash
# 1. Mint an API key (stub auth gives you a dev session against the seed org)
SECRET=$(curl -s -X POST http://localhost:4000/api/integrations/api-keys \
  -H 'Content-Type: application/json' \
  -d '{"name":"local-dev","scopes":["mcp"]}' | jq -r .secret)

# 2. Call tools/list via JSON-RPC
curl -s http://localhost:4001/mcp \
  -H "Authorization: Bearer $SECRET" \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | jq

# 3. Call opportunities.list
curl -s http://localhost:4001/mcp \
  -H "Authorization: Bearer $SECRET" \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"opportunities.list","arguments":{"limit":5}}}' | jq

# 4. Call opportunities.get by code
curl -s http://localhost:4001/mcp \
  -H "Authorization: Bearer $SECRET" \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"opportunities.get","arguments":{"code":"OP-2041"}}}' | jq
```

## Registering with Dust

Dust → Workspace → Tools → External MCP:

- **URL:** `${DUST_MCP_PUBLIC_URL}/mcp` (must terminate TLS)
- **Auth:** Bearer token (paste the secret from step 1 above)
- **Discovery:** Dust will hit `tools/list` automatically and show 6 tools

Then any agent can call our tools via Dust's normal tool-routing.
