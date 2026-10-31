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

These are MCP tool-class scopes. Production REST routes use exact permission
scopes instead, for example `opportunities:read` or `integrations:write`.

Missing, revoked, or malformed keys return `401`. A key that lacks the `mcp` scope is rejected when the session is authenticated, with HTTP `403`.

A key that already has `mcp` but lacks the tool scope (`read`, `write`, or `kam`) stays on that session. The tool result is an MCP error (`isError: true`) whose text is `API key lacks write scope` (or `read` / `kam`). It is not an HTTP 403. A JSON-RPC 200 with `isError: true` is a denied tool call, and the handler does not run.

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

Read-only keys should be tested by minting a key with `["mcp","read"]` and confirming a write tool such as `crm_create_deal` returns an MCP tool error (`API key lacks write scope`) and does not insert a row. Streamable HTTP needs an `initialize` request first; later calls send the `mcp-session-id` header.

`notes.list` `accountId` is a UUID (`Company.id` or the stored note account id). A company name is not resolved. `tasks.list` accepts `accountId` as `Task.accountId` (company UUID). `crm_search_companies` searches the Company table and returns that id; opportunity customer text that is not a company row is `matchKind: opportunity_text_only` with `confidence: null`. `opportunities.list` returns `currency: null`, `currencyBasis: unspecified`, `companyId`, and `health: not_account_health` because probability is not account health.

Dust cloud cannot call `localhost`. In Dust, open Spaces > Tools > Add Tool > Add MCP Server and paste the public HTTPS URL that ends in `/mcp`. Choose Bearer token and use a Polo key scoped `mcp` and `read`. Until that URL and `DUST_API_KEY` / `DUST_WORKSPACE_ID` exist, Polo stays in stub / unverified mode.

## Release Evidence

Before onboarding real data, run:

```bash
pnpm deploy:evidence:mcp
```

The command requires a non-local `BIDSTACK_MCP_CONNECTIVITY_TARGET`, a bearer token with `mcp` plus the needed tool-class scope, and deployed `BIDSTACK_RELEASE_COMMIT` / `BIDSTACK_RELEASE_BRANCH` values that match source-control evidence. It checks discovery, health, release identity, session initialize, `tools/list`, and one read-only `tools/call`. The default smoke is `crm_search_companies` with a no-match query and `limit:1`, so the release artifact proves execution without persisting customer records. The artifact must contain only release identity, tool names, status, result-shape counts, and privacy flags; raw arguments and raw tool output are release-gate failures.

## Registering with Dust

Dust docs: Spaces > Tools > Add Tool > Add MCP Server. Streamable HTTP is the transport Dust tries first. Do not register the legacy `/mcp/sse` URL.

- URL: the public HTTPS URL ending in `/mcp` (`DUST_MCP_PUBLIC_URL` plus `/mcp` when the origin has no path).
- Auth: Bearer token. Paste a Polo API key with scopes `mcp` and `read`. Dust sends `Authorization: Bearer`.
- Do not choose Automatic OAuth. Polo’s MCP server has no Dust OAuth callback.

Dust discovers tools through `tools/list`. Keep the Dust API key server-side. Agents call Polo with the Polo bearer, not with the Dust key.
