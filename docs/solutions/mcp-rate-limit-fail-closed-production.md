# MCP Rate Limits Fail Closed In Production

## Problem

MCP tools are automation-facing entry points. If Redis is unavailable, a shared
rate-limit budget cannot be enforced across API replicas. Failing open is useful
for development, but in production it lets one key bypass both per-minute and
hourly budgets while Redis is down.

## Solution

Use one explicit environment decision for MCP rate-limit failure behavior:

- `NODE_ENV=production` defaults to fail closed.
- Development and test default to fail open.
- `MCP_RATE_LIMIT_FAIL_CLOSED=true|false` can override the default for staging,
  local incidents, or controlled tests.

Wire that same decision into both MCP limiters:

- The custom 600/hour Redis sliding-window plugin denies `/mcp` traffic with
  `503` when Redis fails and fail-closed mode is active.
- `@fastify/rate-limit` uses `skipOnError: false` in fail-closed mode and
  `skipOnError: true` only for fail-open mode.

## Prevention

When changing MCP rate limits, test all three contracts:

1. Two replicas share a Redis-backed hourly budget.
2. Dev/test can still fail open when Redis is absent.
3. Enterprise fail-closed mode rejects MCP requests when Redis is absent.

Do not let the custom hourly limiter and Fastify per-minute limiter use
different Redis failure policies.
