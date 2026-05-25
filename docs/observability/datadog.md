# Datadog APM Integration — BidStack 360°

## Overview

BidStack uses Datadog for APM (Application Performance Monitoring), distributed
tracing, log aggregation, and infrastructure metrics.

Surfaces:
- **API** (`apps/api`) — HTTP request tracing, Prisma/pg spans, custom metrics
- **Worker** (`apps/worker`) — BullMQ job tracing, queue depth metrics
- **Logs** — Pino JSON logs with trace correlation injected by `dd-trace`

## Setup

### 1. Create a Datadog Account + API Key

1. Sign in at [datadoghq.com](https://www.datadoghq.com) (or EU: datadoghq.eu).
2. Go to **Organization Settings → API Keys → New Key**.
3. Copy the API key.

### 2. Set Environment Variables

```bash
# Datadog APM (backend only — never expose DD_API_KEY to frontend)
DD_API_KEY=your-datadog-api-key
DD_SERVICE=bidstack-api          # or bidstack-worker for the worker process
DD_ENV=production                # development | staging | production
DD_VERSION=git-sha-or-semver     # optional, for deployment tracking
DD_PROFILING_ENABLED=false       # set true to enable continuous profiling (extra cost)
```

### 3. Wire Up in Code

**API** — call `initDatadog()` in `apps/api/src/index.ts` BEFORE any imports:
```ts
// WHY first: dd-trace must patch Node.js built-ins before they're loaded
import { initDatadog } from './plugins/datadog.js';
initDatadog();

import { buildServer } from './server.js';
// ...
```

Register the Fastify plugin in `buildServer()` AFTER sentryPlugin:
```ts
import { datadogPlugin } from './plugins/datadog.js';
await server.register(sentryPlugin);   // first
await server.register(datadogPlugin);  // second
```

**Worker** — call before starting workers:
```ts
import { initWorkerDatadog, attachDatadogToWorker, startQueueDepthMetrics } from './plugins/datadog.js';
initWorkerDatadog(log);
// After each worker is created:
attachDatadogToWorker(smsSendWorker, 'sms.send', log);
startQueueDepthMetrics(queues, log);
```

## Agent Deployment

Datadog requires an Agent process to receive metrics and traces from `dd-trace`.

### Option A: Docker Sidecar (recommended for self-hosted / Docker Compose)

```yaml
# docker-compose.yml
services:
  datadog:
    image: gcr.io/datadoghq/agent:7
    environment:
      DD_API_KEY: ${DD_API_KEY}
      DD_SITE: datadoghq.com  # or datadoghq.eu
      DD_APM_ENABLED: "true"
      DD_DOGSTATSD_NON_LOCAL_TRAFFIC: "true"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - /proc/:/host/proc/:ro
      - /sys/fs/cgroup/:/host/sys/fs/cgroup:ro
    ports:
      - "8125:8125/udp"    # StatsD
      - "8126:8126/tcp"    # APM trace receiver
```

Set `DD_AGENT_HOST=datadog` in your API/worker containers.

### Option B: Vercel + Vector Forwarder (recommended for serverless)

Vercel functions are ephemeral — a persistent Datadog Agent cannot run as a
sidecar. Use the **Vector** log forwarder instead:

1. Deploy [Vector](https://vector.dev) as a separate service (e.g., Railway or Fly.io).
2. Configure Pino to write JSON to stdout (already configured).
3. Forward stdout logs from Vercel Log Drains → Vector → Datadog Logs API.

```toml
# vector.toml (excerpt)
[sources.vercel_logs]
type = "http"
address = "0.0.0.0:9000"

[sinks.datadog]
type = "datadog_logs"
inputs = ["vercel_logs"]
api_key = "${DD_API_KEY}"
site = "datadoghq.com"
```

Configure Vercel Log Drain to point at your Vector endpoint.

### Option C: Fluent Bit (Kubernetes / EKS)

Use the Datadog Kubernetes integration with Fluent Bit DaemonSet.
See: https://docs.datadoghq.com/agent/kubernetes/log/

## Custom Metrics

| Metric | Type | Tags |
|--------|------|------|
| `bidstack.api.requests.total` | Counter | method, route, status |
| `bidstack.api.latency` | Histogram | method, route, status |
| `bidstack.integrations.calls` | Counter | provider, success |
| `bidstack.workers.jobs.processed` | Counter | queue, job, status |
| `bidstack.workers.job.duration` | Histogram | queue, job |
| `bidstack.workers.queue.depth` | Gauge | queue |

## Log Correlation

When `DD_API_KEY` is set, `dd-trace` injects `dd.trace_id`, `dd.span_id`, and
`dd.service` into every Pino log line. In the Datadog UI, click any log line
and choose **View in APM** to jump to the matching trace.

Ensure your Pino logger uses the factory from `apps/api/src/lib/logger.ts`
which sets the correct `base` fields and redact paths.

## Cost Optimization

- **Sampling**: `tracesSampleRate: 0.1` in production. Do not set to 1.0 in
  production — APM ingestion is priced per GB.
- **Log filtering**: Use a Vector/Fluentd filter to drop `level: debug` logs
  before shipping to Datadog in production.
- **Metrics cardinality**: Avoid high-cardinality tag values (e.g., userId as a
  tag). The route patterns used in `bidstack.api.latency` are already low-cardinality.
- **Profiling**: `DD_PROFILING_ENABLED=false` by default. Enable only on
  specific services where you need continuous profiling — it adds ~5% CPU overhead.
- **Retention**: Set 15-day retention on low-priority indexes, 30-day on error logs.
