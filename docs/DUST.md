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

1. Get a Dust workspace API key from `https://dust.tt/w/<workspace>/admin/api-keys`
2. Set in `.env`:
   ```
   DUST_API_KEY=dust_…
   DUST_WORKSPACE_ID=mantu-presales
   DUST_DATA_SOURCE_ID=ds_bidstack_opportunities
   DUST_AGENT_EXEC_BRIEF=agt_…
   DUST_WEBHOOK_SECRET=whsec_…
   DUST_MCP_PUBLIC_URL=https://mcp.bidstack.mantu.com
   ```
3. Restart `pnpm dev` — the worker logs will switch from `dust.poll tick.stub` to `pulled N from dust`.
4. Register the MCP server in Dust → Workspace → Tools → External MCP. The URL must be public HTTPS and end in `/mcp` (`${DUST_MCP_PUBLIC_URL}/mcp`). Transport is streamable HTTP. Mint a Polo API key with scopes `mcp` and `read` (add `write` only for mutations) and send it as `Authorization: Bearer`. Dust cloud cannot reach `localhost` or `127.0.0.1`. A loopback `DUST_MCP_PUBLIC_URL` stays local-only and `mcp.configured` stays false.
5. Configure Dust webhooks → point at `${PUBLIC_API_URL}/webhooks/dust`, sign with `${DUST_WEBHOOK_SECRET}`. Subscribe to `document.created`, `document.updated`, `agent.run.completed`, `conversation.message.created`.

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
