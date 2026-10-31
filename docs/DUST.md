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

## Setup checklist

Dust’s current admin UI (docs.dust.tt, MCP servers and API keys) is the contract. Polo is ready once those values are set. It does not open Dust’s login for you.

1. In Dust, open **Admin > Developers > API keys** and create a key. Read-only is enough for Polo to list agents. Uploading deal text needs a key that can write to the Space that owns the data source. Copy it once. For an EU workspace, set `DUST_BASE_URL=https://eu.dust.tt/api`. The default base is `https://dust.tt/api`.
2. Copy the workspace id from the browser URL: `https://dust.tt/w/<id>` or `https://eu.dust.tt/w/<id>`. That id is `DUST_WORKSPACE_ID`. A display name is not an id.
3. Create the data source in Dust, then set `DUST_DATA_SOURCE_ID` to its id. Polo upserts deal markdown at `/v1/w/<id>/data_sources/<dataSourceId>/documents` with `Authorization: Bearer <DUST_API_KEY>`.
4. Publish the MCP server on public HTTPS. Set `DUST_MCP_PUBLIC_URL` to that origin. Polo’s endpoint is that origin plus `/mcp`.
5. In Dust, go to **Spaces > Tools > Add Tool > Add MCP Server**. Paste the URL that ends in `/mcp`. Choose **Bearer token**, not Automatic OAuth. Polo does not speak Dust’s OAuth callback. Mint a Polo API key (`POST /api/integrations/api-keys`) with scopes `mcp` and `read`, and paste that secret as the bearer. Dust sends it as `Authorization`. Add `write` only if agents should create or change records.
6. Restart the API and worker. With the API key and workspace id set, status moves from `stub` to `configured_unverified` until a live Dust call succeeds. A loopback `DUST_MCP_PUBLIC_URL` stays local-only and `mcp.configured` stays false. Dust cloud cannot reach `localhost`.

Dust’s documented webhooks are inbound: another system calls Dust. Polo does not require a Dust outbound subscription for Dust to read the CRM. The MCP server is that read path. Polo still accepts a signed `POST /webhooks/dust` when `DUST_WEBHOOK_SECRET` is set, for a sender you control. There is no Dust admin screen that subscribes `document.created` to that URL.

Do not commit `DUST_API_KEY`, `DUST_WORKSPACE_ID`, or `DUST_MCP_PUBLIC_URL`. They belong in the environment secret store. This repository does not invent a public URL.

## Failure modes + recovery

| Symptom                              | Likely cause                                  | Recovery                                                                                    |
| ------------------------------------ | --------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `dust.poll tick.stub` log entries    | `DUST_API_KEY` or `DUST_WORKSPACE_ID` not set | set env, restart worker                                                                     |
| `401` on `dust-client.listDocuments` | rotated/expired key                           | mint new, update `.env`, restart                                                            |
| `429` from Dust                      | over rate limit                               | client auto-retries with `Retry-After`; if persistent, lower poll cadence in `dust-poll.ts` |
| Webhook 401 in production            | signature mismatch                            | confirm `DUST_WEBHOOK_SECRET` matches Dust admin panel exactly                              |
| Dust says "MCP server unreachable"   | `DUST_MCP_PUBLIC_URL` wrong, TLS missing      | URL must terminate TLS publicly; localhost won't work                                       |

## Stub mode

When `DUST_API_KEY` or `DUST_WORKSPACE_ID` is missing, the integration runs in **stub mode** (`connectionState: "stub"`). When those values are set but no live probe has run, the state is `configured_unverified`. Neither state is healthy, and `nextSyncAt` is null so the payload does not advertise a live sync.

- The poll worker logs a `tick.stub` `sync_event` every 5 min for each org so the Integrations page UI has feedback. That tick is not a Dust connection.
- `apps/api`'s `/api/integrations/dust/status` returns `pulled24h`/`pushed24h` from the `sync_events` table without calling Dust.
- `/api/opportunities/:id/brief` returns a deterministic stub markdown brief (so the UI doesn't break).
- Provider health for Dust REST stays `unverified` even if `DUST_API_KEY` is set. Configuration is not a live probe.

This keeps the dev environment functional without any external dependency. Dust cloud is not connected until a public HTTPS MCP URL and a Dust API key are supplied outside git.
