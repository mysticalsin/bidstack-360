# Production Redis URL Fail-Fast

Redis backs shared rate limiting, BullMQ queues, cache invalidation, outbound
communication caps, OAuth refresh locks, presence, and MCP rate limits. A
production service that silently defaults to `redis://localhost:6380` may boot
against a dead local address or split counters per replica.

Pattern used in BidStack:

- keep localhost Redis as the development default;
- in production, require an explicit `REDIS_URL`;
- accept only `redis:` or `rediss:` URLs;
- reject `localhost`, `127.0.0.0/8`, `::1`, and unspecified bind addresses;
- enforce the same contract in API, worker, and MCP boot validation;
- document the local-vs-production distinction in `.env.example`.

This is configuration validation, not live infrastructure proof. Operators still
must run the staging/prod evidence bundle and prove Redis is reachable, shared
across replicas, and monitored.
