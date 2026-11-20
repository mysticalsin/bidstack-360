# Dust integration

The backend integrates with **Dust** in three ways. All three must work for the prototype's UX to feel "live".

## 1. Workspace API (outbound)

The backend pulls + pushes data via Dust's REST API.

- **Auth:** `Authorization: Bearer ${DUST_API_KEY}`
- **Workspace:** `${DUST_WORKSPACE_ID}` (e.g. `mantu-presales`)
- **Pull cycle:** every 5 min (BullMQ repeating job). Pulls deltas via `?updated_since=`.
- **Push cycle:** opportunity create/update fires a job that mirrors the row to a Dust **document** in the `bidstack-opportunities` data source, so Dust agents have current context.

Endpoints we use:

| Verb | Path | Purpose |
|---|---|---|
| `GET`  | `/v1/w/{ws}/data_sources/{ds}/documents`        | List indexed docs |
| `POST` | `/v1/w/{ws}/data_sources/{ds}/documents`        | Upsert opportunity-as-document |
| `POST` | `/v1/w/{ws}/assistant/agent_configurations/{id}/runs` | Run the "exec brief" agent |
| `GET`  | `/v1/w/{ws}/assistant/conversations/{cid}`      | Stream agent reply for the in-app sidebar |

The package `packages/dust-client` wraps these with retries (exp backoff), 429 handling, and Pino logging.

## 2. Webhooks (inbound)

Dust posts events to `POST /webhooks/dust`.

- **Verify:** `X-Dust-Signature: sha256=…` against `DUST_WEBHOOK_SECRET`. Reject mismatched.
- **Deduplicate:** insert event id into a Redis set with 7-day TTL; reject duplicates.
- **Ack fast:** write to `sync_events`, enqueue a BullMQ job, return 200 within 50ms.

Subscribed events:
- `document.created` → reindex
- `document.updated` → reindex
- `agent.run.completed` → if it was a bid-summary run, attach output to opportunity
- `conversation.message.created` → push to dashboard live feed

## 3. MCP server (Dust → us)

We host an MCP server at `${DUST_MCP_PUBLIC_URL}/mcp`. Dust agents call our tools.

See `mcp.tools.md` for the tool definitions. Implement with `@modelcontextprotocol/sdk` + Fastify HTTP transport. Auth via per-workspace API key (`api_keys` table, scope `mcp`).

## Deployment

The MCP server lives in `apps/mcp-server` and deploys as its own Fly app. Public URL must terminate TLS and be configured in Dust under **Workspace → Tools → External MCP**.
