# Redis Readiness Reconnect

## Problem

The API Redis helper used `retryStrategy: () => null` and
`enableOfflineQueue: false` so cache and health calls would fail fast when
Redis was unavailable. That is good for request latency, but it created a
long-running process risk: after a startup race or transient idle disconnect,
the client could stay in an ended/closed state. `/readyz` then stayed `503`
until the API process restarted, even if Redis was reachable again.

For the account cockpit, this made an otherwise healthy dashboard feel like it
had crashed after the user left the page open and a later background refresh hit
a degraded API/proxy state.

## Solution

- Keep fail-fast Redis command behavior.
- Add an explicit `ensureRedisReady()` helper that reconnects only from
  reconnectable states (`wait`, `close`, `end`).
- Use `pingRedis()` in readiness instead of calling `redis.ping()` directly.
- Use `ensureRedisReady()` before cache get/set/delete, then fall back to the
  process-local cache when Redis is still unavailable.
- Keep liveness and readiness separate: `/livez` can be green while `/readyz`
  correctly fails if Redis is down.

## Verification

- `pnpm --filter @bidstack/api exec vitest run src/redis.test.ts src/routes/health.test.ts src/plugins/redis-cache.test.ts --reporter=dot`
- `pnpm --filter @bidstack/api exec vitest run src/routes/crm/dashboard.test.ts --reporter=dot`
- `pnpm --filter @bidstack/web exec vitest run src/pages/DashboardPage.test.tsx --reporter=dot`
- `pnpm --filter @bidstack/api typecheck`
- `pnpm --filter @bidstack/api lint`
- Live `/readyz` returns `200` with `redis: true` after the patch.
- Browser smoke on the affected account cockpit shows no fatal CRM cockpit error
  and no console errors.
