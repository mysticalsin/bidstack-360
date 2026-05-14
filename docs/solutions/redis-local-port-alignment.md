# Redis Local Port Alignment

## Context

BidStack's Docker Compose Redis service publishes container port `6379` to host port `6380` to avoid colliding with a host-installed Redis. `.env.example` already documents `REDIS_URL=redis://localhost:6380`.

## Decision

Local API and worker defaults must match the documented Compose host port:

- API health Redis client: `redis://localhost:6380`
- API BullMQ producer clients: `redis://localhost:6380`
- Worker BullMQ connection: `redis://localhost:6380`

Production and containerized deployments should still set `REDIS_URL` explicitly, for example `redis://redis:6379` inside Compose networking.

## Verification

- `docker exec bidstack-redis redis-cli ping`
- `pnpm --filter @bidstack/api typecheck`
- `pnpm --filter @bidstack/worker typecheck`
- API `/health` should report `redis: true` after restarting the API with Redis running.
