# DevOps, Performance & Infra Audit Findings

## Findings
| ID | Severity | Location | Finding | Fix Effort |
|---|---|---|---|---|
| 1 | Critical | `Dockerfile:72, 115, 142` | **Security/DevOps:** The `node` process runs as the `root` user in all container stages. A `USER node` directive must be added to drop privileges in the `api`, `worker`, and `mcp-server` targets. | Low |
| 2 | High | `load-tests/*.js` | **Load Testing:** The k6 load tests (`soak.js`, `spike.js`, `baseline.js`) exclusively test `http.get` endpoints. Write-heavy paths (POST/PUT), database transaction locks, and BullMQ worker enqueueing are completely untested under load, which hides potential connection pool exhaustion and memory leaks. | Medium |
| 3 | High | `load-tests/spike.js:67` | **Load Testing:** `spike.js` intentionally omits `sleep()` between VU iterations. This often saturates the k6 load generator's CPU, skewing metrics and causing false negatives/connection drops originating from the client side rather than stressing the API server properly. | Low |
| 4 | High | `packages/shared/src/queue-config.ts` | **Queue Configuration:** BullMQ configurations rely on `removeOnFail: { age: ..., count: 100 }`. In an extended outage generating >100 failed jobs, BullMQ will silently hard-delete older failures. A dedicated Dead Letter Queue (DLQ) or significantly higher limits are required to prevent data loss. | Low |
| 5 | Medium | `apps/worker/src/queues/queues.test.ts:34-36` | **Secret Leak:** The connection check throws `Redis at ${redisUrl} not reachable`. This prints the unparsed connection string (potentially containing a password) directly to test logs, creating a credential leak risk in CI environments. | Low |
| 6 | Medium | `apps/api/src/otel.ts:16-27` | **SRE/Metrics:** OpenTelemetry is configured with an `OTLPTraceExporter` for distributed tracing, but completely omits a `MeterProvider` or `MetricReader`. Essential application metrics (memory, queue depth, HTTP throughput) are not exported to the APM, rendering the APM instructions in the load-test README obsolete. | Medium |

**Final Score:** 5/10
