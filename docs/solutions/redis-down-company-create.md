# Company create when Redis is down

## Problem

`POST /api/v1/companies` writes the company, then awaits the account-intel
producer. That producer used ioredis with `enableOfflineQueue: true` and
`maxRetriesPerRequest: null`. A refused Redis port never rejects `Queue.add()`,
so the HTTP handler does not finish. On `main` `40b13242` the client saw no
status within 45 seconds. The row was already committed.

`/readyz` already returned 503 with `redis: false` in about 64ms. The body did
not say whether Redis was connected, degraded, or unavailable, and it did not
include latency. `/healthz` was not a route. `/livez` stayed 200.

## What Redis is for on create

The insert and the audit row are Postgres. Redis is the async enrichment
enqueue (account intel and tech-stack detect). The create commits either way.
A failed enqueue is logged and returned as
`enrichment.status = "failed"` with the message
`Enrichment queued later or failed`.

## Producer bound

Request-path producers wait up to `QUEUE_PRODUCER_TIMEOUT_MS` (1s) for the
client to be ready, then run the command with the same `commandTimeout`.
`enableOfflineQueue` is false, so a command cannot sit across reconnects.
BullMQ's `Queue` rejects a client whose `maxRetriesPerRequest` is a positive
number, so that option stays `null`. The bound is the ready wait and
`commandTimeout`.

## Readiness

Redis down is **not ready**: `GET /readyz` is 503 and
`dependencies.redis.status` is `unavailable`. A replica that cannot reach Redis
cannot share rate limits, idempotency, or job enqueue, so it should leave the
load balancer. A ping that succeeds but takes at least half the probe budget is
`degraded` and the probe stays 200, because the dependency answered.

`GET /livez` and `GET /healthz` are liveness. They do not call Redis or
Postgres. `GET /health` keeps returning 200 for dashboards and includes the
same dependency object.
