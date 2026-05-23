# MCP server implementation notes

> Companion to `handoff/mcp.tools.md`. This file documents how the server is built and how to test it locally.

## Transport

Production MCP traffic uses Streamable HTTP on one stable endpoint:

- `POST /mcp` - MCP Streamable HTTP requests.
- `GET /mcp` - MCP Streamable HTTP server-to-client stream.
- `DELETE /mcp` - terminate a Streamable HTTP session.
- `GET /.well-known/mcp` - server metadata and endpoint discovery.
- `GET /health` - process liveness.

Legacy SSE endpoints are still present only for compatibility:

- `GET /mcp/sse`
- `POST /mcp/messages`

Do not register new production clients against the SSE endpoints. They are process-local and do not scale cleanly across replicas.

## Auth

Every MCP request must include:

```http
Authorization: Bearer <bidstack API key>
```

Mint the key via `POST /api/integrations/api-keys`. The secret is returned once; store it securely. The MCP server hashes the bearer with SHA-256 and resolves the organization from `api_keys.hashed_key`.

Required scopes:

- `mcp` on every key.
- `read` for read-only tools.
- `write` for mutation tools.

Missing, revoked, or malformed keys return `401`. Keys without the required tool scope return `403`.

## Tool Scopes

Tool scopes are declared in `apps/mcp-server/src/tools/index.ts` via `toolScopes`.

- Read examples: `opportunities.list`, `opportunities.get`, `contacts.list`, `proposal.draft`.
- Write examples: `opportunity.update`, `tasks.create`, CRM create/update/enrich tools, activity creation.

Every `tools/call` request resolves the required scope before invoking the handler.

## Rate Limits

MCP requests are rate-limited per API key or IP:

- Fast minute window through `@fastify/rate-limit`.
- Secondary hourly guard for `/mcp`, `/mcp/sse`, and `/mcp/messages`.

Production deployments should back shared rate limits with Redis so multiple API/MCP replicas enforce one quota window per key and org.

## Local Testing

With Postgres and Redis running and the API + MCP servers running:

```bash
SECRET=$(curl -s -X POST http://localhost:4000/api/integrations/api-keys \
  -H 'Content-Type: application/json' \
  -d '{"name":"local-dev","scopes":["mcp","read","write"]}' | jq -r .secret)

curl -s http://localhost:4001/mcp \
  -H "Authorization: Bearer $SECRET" \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | jq
```

Read-only keys should be tested by minting a key with `["mcp","read"]` and confirming write tools return `403`.

## Registering with Dust

Dust -> Workspace -> Tools -> External MCP:

- URL: `${DUST_MCP_PUBLIC_URL}/mcp`
- Auth: bearer token from the API key creation response.
- Transport: Streamable HTTP.

Dust discovers tools through `tools/list`. Keep Claude/Dust provider keys server-side; agents should use BidStack MCP/API keys rather than embedding provider secrets in browser-visible configuration.
