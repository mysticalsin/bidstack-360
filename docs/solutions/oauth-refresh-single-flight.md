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
  writes it. The lock TTL (30s by default) is longer than the waiter (10s)
  and longer than the provider refresh timeout (15s, OAUTH_HTTP_TIMEOUT_MS).
  A waiter or a refresh that lasts at least as long as the TTL can take the
  key while the previous holder still owns it, so that configuration is refused.
- Redis is required in every mode until OAUTH_REFRESH_LOCK_REDIS_REQUIRED=false.
  That one variable is the opt-out. Startup refuses it when NODE_ENV=production.
  The API and the worker share oauthRefreshLockRedisRequired and
  oauthRefreshLockStartupError.

## Refresh-token rotation

Microsoft rotates the refresh token on every successful refresh. The worker
asks `https://login.microsoftonline.com/.../oauth2/v2.0/token` and stores
`refresh_token` only when the response includes one.

Google's refresh goes to `https://oauth2.googleapis.com/token`. A new refresh
token is stored only when the response includes one. Google does not rotate
on every refresh the way Microsoft does.

A holder that crashes after the provider has rotated the refresh token and
before that value is written is a separate backlog slice. Nothing here changes
that write.

## Prevention

New OAuth providers that store access/refresh tokens in `IntegrationToken`
should refresh through `runWithOAuthRefreshLock`. Do not call provider refresh
endpoints directly from `getAccessToken`-style helpers.
