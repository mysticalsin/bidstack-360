# MCP Production Env Fail-Fast Contract

## Problem

The MCP server is a public tool surface backed by API keys and shared
rate-limiting. Its Redis client defaulted to `redis://localhost:6380`, and
`server.ts` imported that Redis client before `main.ts` could validate
production configuration. In production, a missing or loopback `REDIS_URL`
could let the service start with broken shared rate limiting, and an explicit
`MCP_RATE_LIMIT_FAIL_CLOSED=false` could make Redis outages fail open.

## Pattern

- Keep production env checks pure and unit-tested.
- Validate before importing modules that open Redis connections or register
  public routes.
- Production MCP requires:
  - `DATABASE_URL`
  - `REDIS_URL`
  - a Redis URL using `redis:` or `rediss:`
  - non-loopback Redis host
  - no explicit `MCP_RATE_LIMIT_FAIL_CLOSED=false`
- Production Compose must require MCP `DATABASE_URL` and `REDIS_URL` with
  `${VAR:?message}` interpolation.

## Implementation

- `apps/mcp-server/src/production-env.ts`
- `apps/mcp-server/src/production-env.test.ts`
- `apps/mcp-server/src/main.ts`
- `scripts/verify-compose-production-policy.mjs`

## Verification

- Red test first: `pnpm --filter @bidstack/mcp-server exec vitest run src/production-env.test.ts --reporter=dot`
  failed because `./production-env.js` did not exist.
- `pnpm --filter @bidstack/mcp-server exec vitest run src/production-env.test.ts --reporter=dot`:
  7/7 pass.
- `pnpm --filter @bidstack/mcp-server exec vitest run src/plugins/hourly-rate-limit.test.ts src/serum-policy.test.ts --reporter=dot`:
  8/8 pass.
- `pnpm --filter @bidstack/mcp-server exec eslint src/production-env.ts src/production-env.test.ts src/main.ts src/redis.ts src/plugins/hourly-rate-limit.ts --max-warnings=0`:
  pass.
- `pnpm --filter @bidstack/mcp-server typecheck`: pass.
- `pnpm --filter @bidstack/mcp-server build`: pass.
- `pnpm deploy:evidence:compose:policy:selftest`: pass.
- `pnpm deploy:evidence:compose:policy`: pass.
- `node --check scripts/verify-compose-production-policy.mjs`: pass.
- `pnpm exec eslint --no-ignore --no-warn-ignored scripts/verify-compose-production-policy.mjs --max-warnings=0`:
  pass.
- `docker compose -f docker-compose.prod.yml config --quiet` with
  production-shaped dummy env: pass.
- `pnpm deploy:evidence:selftest`: pass.
- `pnpm deploy:evidence:source:selftest`: pass.
- `pnpm deploy:evidence:source`: expected release block; worktree has 405
  dirty entries.
- `pnpm deploy:evidence:source:plan:write`: refreshed six active review waves.

## Known Gap

`pnpm --filter @bidstack/mcp-server exec vitest run src/plugins/hourly-rate-limit.test.ts src/auth.test.ts src/serum-policy.test.ts --reporter=dot`
still requires a live Postgres at `localhost:5433`; `src/auth.test.ts` failed
locally when that DB was not running. That is an environment gap, not evidence
that the new env contract failed.

## 2026-06-19 Docker Port Metadata Alignment

The root `Dockerfile` MCP target exposed `3001`, while
`apps/mcp-server/src/main.ts` listens on `PORT_MCP` default `4001` and the
health server listens on `MCP_HEALTH_PORT` default `4003`. Some platforms use
`EXPOSE` metadata for automatic ingress or generated service defaults, so stale
metadata can route traffic to a dead port even when the process is healthy.

Pattern:

- Keep Dockerfile `EXPOSE` values aligned with runtime defaults.
- Health metadata remains separate from traffic metadata: MCP traffic is
  `4001`, health is `4003`.
- Add a package-level policy test when a deploy runtime contract is encoded in
  a root Dockerfile.

Implementation:

- `Dockerfile`
- `apps/mcp-server/src/dockerfile-policy.test.ts`

Verification:

- `pnpm --filter @bidstack/mcp-server test -- src/dockerfile-policy.test.ts src/production-env.test.ts --reporter=dot`:
  9/9 pass.
- `pnpm --filter @bidstack/mcp-server typecheck`: pass.
- `pnpm --filter @bidstack/mcp-server exec eslint src/dockerfile-policy.test.ts src/production-env.test.ts src/production-env.ts --max-warnings=0`:
  pass.
- `pnpm deploy:evidence:compose:policy:selftest`: pass.
- `pnpm deploy:evidence:compose:policy`: pass.
- `docker build --check --target mcp-server -f Dockerfile .`: pass, no
  warnings.
- `pnpm deploy:evidence:source`: expected release block, worktree has 416
  dirty entries.
- `pnpm deploy:evidence:source:plan`: expected release block, six review waves.
- `pnpm deploy:evidence:production`: expected release block, 46 pass / 75 fail.
