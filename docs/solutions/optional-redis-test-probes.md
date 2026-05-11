# Optional Redis Test Probes

## Problem

Tests that support an optional local Redis instance can still fail when Redis is absent if they construct an `IORedis` client just to probe availability. `ioredis` can emit late close/rejection events after the test catches the failed command, and Vitest reports those as unhandled errors.

## Solution

Probe the Redis host and port with a short-lived `node:net` socket before constructing `IORedis`. Only create BullMQ queues, workers, or Redis clients after the socket proves the service is reachable.

When the test owns an `IORedis` instance, close BullMQ workers/queues first and then call `connection.disconnect()` for teardown. Avoid `quit()` in optional-service tests because it sends another Redis command and can fail during shutdown.

## Prevention

Optional integration tests should follow this order:

1. Parse the service URL.
2. Probe with a short timeout using a raw socket or provider-neutral client.
3. Return early when the service is unavailable.
4. Construct the real SDK client only after reachability is confirmed.
5. Use non-command teardown for clients that may already be closed.
