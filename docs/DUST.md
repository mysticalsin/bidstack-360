# Dust integration — implementation notes

> Companion to `handoff/dust.integration.md`. This file documents *how* we wire Dust in this monorepo, not *what* the contract is.

## Where the code lives

| Concern | File |
|---|---|
| HTTP client (auth, retry, timeout) | [`packages/dust-client/src/index.ts`](../packages/dust-client/src/index.ts) |
| HMAC signature verification | [`packages/dust-client/src/index.ts`](../packages/dust-client/src/index.ts) → `verifyDustSignature` |
| Webhook receiver | [`apps/api/src/routes/webhooks.ts`](../apps/api/src/routes/webhooks.ts) |
| Sync status + force-resync API | [`apps/api/src/routes/dust-integration.ts`](../apps/api/src/routes/dust-integration.ts) |
| 5-minute poll loop | [`apps/worker/src/queues/dust-poll.ts`](../apps/worker/src/queues/dust-poll.ts) |
| Webhook event drainer | [`apps/worker/src/queues/webhook-processor.ts`](../apps/worker/src/queues/webhook-processor.ts) |
| Dust agent panel (UI) | TODO — Sprint 9 |

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
4. Register the MCP server URL in Dust → Workspace → Tools → External MCP. Mint a BidStack API key with `mcp` scope and paste it as the bearer token.
5. Configure Dust webhooks → point at `${PUBLIC_API_URL}/webhooks/dust`, sign with `${DUST_WEBHOOK_SECRET}`. Subscribe to `document.created`, `document.updated`, `agent.run.completed`, `conversation.message.created`.

## Failure modes + recovery

| Symptom | Likely cause | Recovery |
|---|---|---|
| `dust.poll tick.stub` log entries | `DUST_API_KEY` or `DUST_WORKSPACE_ID` not set | set env, restart worker |
| `401` on `dust-client.listDocuments` | rotated/expired key | mint new, update `.env`, restart |
| `429` from Dust | over rate limit | client auto-retries with `Retry-After`; if persistent, lower poll cadence in `dust-poll.ts` |
| Webhook 401 in production | signature mismatch | confirm `DUST_WEBHOOK_SECRET` matches Dust admin panel exactly |
| Dust says "MCP server unreachable" | `DUST_MCP_PUBLIC_URL` wrong, TLS missing | URL must terminate TLS publicly; localhost won't work |

## Stub mode

When Dust env keys are not set, the integration runs in **stub mode**:

- The poll worker logs a `tick.stub` `sync_event` every 5 min for each org so the Integrations page UI has feedback.
- `apps/api`'s `/api/integrations/dust/status` returns `pulled24h`/`pushed24h` from the `sync_events` table without calling Dust.
- `/api/opportunities/:id/brief` returns a deterministic stub markdown brief (so the UI doesn't break).

This keeps the dev environment functional without any external dependency.
