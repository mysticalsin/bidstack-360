---
source_agent: codex
generated: 2026-06-29T06:36:00-04:00
confidence: 0.86
target_path: D:\BIDCRM
---

# OAuth Refresh Single-Flight

## Problem

Concurrent Gmail or Microsoft Graph requests could see the same near-expired
`IntegrationToken`, then all call the provider refresh endpoint. Providers can
rotate refresh tokens, so racing refreshes can invalidate the token saved by a
peer and break the connection.

## Fix

- Centralize refresh locking in
  `apps/api/src/lib/oauth-refresh-lock.ts`.
- Use Redis `SET key owner PX ttl NX` to allow one refresher per token across
  API replicas.
- Release with an owner-checked Lua script so a slow releaser cannot delete a
  newer owner's lock.
- Waiters poll the database and reuse the fresh access token after the owner
  writes it.
- Production fails closed when Redis locking is required but unavailable.

## Prevention

New OAuth providers that store access/refresh tokens in `IntegrationToken`
should refresh through `runWithOAuthRefreshLock`. Do not call provider refresh
endpoints directly from `getAccessToken`-style helpers.
