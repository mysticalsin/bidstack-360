# Dust integration — implementation notes

> Companion to `handoff/dust.integration.md`. This file documents _how_ we wire Dust in this monorepo, not _what_ the contract is.

## Where the code lives

| Concern                            | File                                                                                                |
| ---------------------------------- | --------------------------------------------------------------------------------------------------- |
| HTTP client (auth, retry, timeout) | [`packages/dust-client/src/index.ts`](../packages/dust-client/src/index.ts)                         |
| HMAC signature verification        | [`packages/dust-client/src/index.ts`](../packages/dust-client/src/index.ts) → `verifyDustSignature` |
| Webhook receiver                   | [`apps/api/src/routes/webhooks.ts`](../apps/api/src/routes/webhooks.ts)                             |
| Sync status + force-resync API     | [`apps/api/src/routes/dust-integration.ts`](../apps/api/src/routes/dust-integration.ts)             |
| 5-minute poll loop                 | [`apps/worker/src/queues/dust-poll.ts`](../apps/worker/src/queues/dust-poll.ts)                     |
| Webhook event drainer              | [`apps/worker/src/queues/webhook-processor.ts`](../apps/worker/src/queues/webhook-processor.ts)     |
| Dust agent panel (UI)              | TODO — Sprint 9                                                                                     |

## Operator checklist

Checked against docs.dust.tt (Adding an MCP Server, API keys, datasources OpenAPI). Polo does not open Dust’s login and does not invent a key or a public URL. Dust cloud is not connected until the values below exist outside git.

**What “connected” looks like**

- Dust shows the Polo server under Spaces > Tools after a successful Bearer registration.
- Polo’s Integrations screen says **Configured, unverified**. It does not say healthy. `nextSyncAt` stays null.
- A saved Dust API key is “API key saved”. That only means Dust accepted the key for Polo’s outbound calls. It is not proof that Dust cloud can call Polo.
- `connectionState` is `stub` when `DUST_API_KEY` or a real workspace id is missing, and `configured_unverified` when both are set. Neither state is healthy.

**localhost cannot be registered with Dust cloud.** A loopback `DUST_MCP_PUBLIC_URL` (`localhost`, `127.0.0.1`, `::1`) is local-only. `mcp.configured` stays false.

1. **API key.** In Dust open **Admin > Developers**, the **API keys** tab, then **Create API Key**. Read-only can list agents and read data sources. Uploading deal text needs the Space added on that key (an Admin key can also modify resources). Copy the key once. Set `DUST_API_KEY`.
2. **Workspace id.** Copy the id from `https://dust.tt/w/<id>` or `https://eu.dust.tt/w/<id>`. Set `DUST_WORKSPACE_ID` to that id. A display name is not an id. Pasting the workspace URL is accepted; the id is the path segment.
3. **Region.** Default client base is `https://dust.tt/api`. For an EU workspace set `DUST_BASE_URL=https://eu.dust.tt/api`. OpenAPI servers are `https://dust.tt` and `https://eu.dust.tt`; paths include `/api/v1/...`, which is the same base.
4. **Space id.** Document calls use the space. `GET /api/v1/w/<workspaceId>/spaces` returns each space’s `sId`. Set `DUST_SPACE_ID` to that `sId`, not the space name. Without it, Polo does not call the old workspace-level document URL.
5. **Data source.** Create it in the Dust UI inside that space. Set `DUST_DATA_SOURCE_ID` to its id. Polo upserts with `Authorization: Bearer <DUST_API_KEY>` at `POST /api/v1/w/<workspaceId>/spaces/<spaceId>/data_sources/<dataSourceId>/documents/<documentId>` (`text`, `mime_type`, `tags`).
6. **Public MCP URL.** Publish Polo on public HTTPS. Set `DUST_MCP_PUBLIC_URL` to that origin. Polo’s endpoint is that origin plus `/mcp` (Streamable HTTP). **localhost cannot be registered with Dust cloud.**
7. **Register in Dust.** **Spaces > Tools > Add Tool > Add MCP Server.** Paste the URL that ends in `/mcp`. Choose **Bearer token**, not Automatic OAuth and not Static OAuth. Polo has no Dust OAuth callback. Dust’s OAuth finalize URLs are `https://app.dust.tt/oauth/mcp/finalize` and `https://app.dust.tt/oauth/mcp_static/finalize`; they are not Polo routes. Mint a Polo API key (`POST /api/integrations/api-keys`) with scopes `mcp` and `read`, and paste that secret as the bearer. Dust sends `Authorization: Bearer`. Add `write` only if agents should create or change records. A key that has mcp but lacks write gets an MCP isError result (text starts with "API key lacks"), not HTTP 403. Missing the mcp scope is HTTP 403.
8. Restart the API and worker. Status moves from `stub` to `configured_unverified` when the API key and workspace id are set. That is still not healthy.

Dust’s product webhooks are inbound to Dust (Spaces > Triggers). They are not a push of `document.created` to Polo. Polo still accepts a signed `POST /webhooks/dust` when `DUST_WEBHOOK_SECRET` is set, for a sender you control.

Do not commit `DUST_API_KEY`, `DUST_WORKSPACE_ID`, `DUST_SPACE_ID`, or `DUST_MCP_PUBLIC_URL`. They belong in the environment secret store.

## Failure modes + recovery

| Symptom                              | Likely cause                                  | Recovery                                                                                    |
| ------------------------------------ | --------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `dust.poll tick.stub` log entries    | `DUST_API_KEY` or `DUST_WORKSPACE_ID` not set | set env, restart worker                                                                     |
| `401` on `dust-client.listDocuments` | rotated/expired key                           | mint new, update `.env`, restart                                                            |
| `429` from Dust                      | over rate limit                               | client auto-retries with `Retry-After`; if persistent, lower poll cadence in `dust-poll.ts` |
| Webhook 401 in production            | signature mismatch                            | `DUST_WEBHOOK_SECRET` must match the sender you configured; Dust does not subscribe this URL |
| Dust says "MCP server unreachable"   | `DUST_MCP_PUBLIC_URL` wrong, TLS missing      | URL must terminate TLS publicly; localhost won't work                                       |

## Stub mode

When `DUST_API_KEY` or `DUST_WORKSPACE_ID` is missing, the integration runs in **stub mode** (`connectionState: "stub"`). When those values are set but no live probe has run, the state is `configured_unverified`. Neither state is healthy, and `nextSyncAt` is null so the payload does not advertise a live sync.

- The poll worker logs a `tick.stub` `sync_event` every 5 min for each org so the Integrations page UI has feedback. That tick is not a Dust connection.
- `apps/api`'s `/api/integrations/dust/status` returns `pulled24h`/`pushed24h` from the `sync_events` table without calling Dust.
- `/api/opportunities/:id/brief` returns a deterministic stub markdown brief (so the UI doesn't break).
- Provider health for Dust REST stays `unverified` even if `DUST_API_KEY` is set. Configuration is not a live probe.

This keeps the dev environment functional without any external dependency. Dust cloud is not connected until a public HTTPS MCP URL and a Dust API key are supplied outside git.
