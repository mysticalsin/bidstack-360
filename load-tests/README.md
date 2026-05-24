# Load Tests — BidStack 360°

k6-based load test suite covering baseline sustained load, spike scenarios, and soak (memory-leak detection).

## Prerequisites

Install k6: https://k6.io/docs/getting-started/installation/

```bash
# macOS
brew install k6

# Windows (chocolatey)
choco install k6

# Linux (debian/ubuntu)
sudo gpg -k
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg \
  --keyserver hkp://keyserver.ubuntu.com --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" \
  | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update && sudo apt-get install k6
```

## Environment variables

| Variable        | Description                                          | Default                       |
|-----------------|------------------------------------------------------|-------------------------------|
| `API_BASE_URL`  | Base URL of the API (no trailing slash)              | `http://localhost:4000`       |
| `AUTH_TOKEN`    | Bearer token for authenticated endpoints             | `dev-stub-token` (dev only)   |
| `ORG_ID`        | Optional org ID header for multi-tenant routing      | (empty — inferred from token) |

## Running locally

Ensure the API is running (`pnpm dev:api`) and the database is seeded (`pnpm db:seed`).

```bash
# Baseline: 100 VUs × 5 min
k6 run load-tests/baseline.js

# With custom target
k6 run --env API_BASE_URL=http://localhost:4000 --env AUTH_TOKEN=your-token load-tests/baseline.js

# Spike: 0→2000 VUs over 30s, 5 min sustained
k6 run load-tests/spike.js

# Soak: 50 VUs × 30 min (memory leak detection)
k6 run load-tests/soak.js
```

## Running against staging

```bash
export API_BASE_URL=https://api-staging.bidstack.io
export AUTH_TOKEN=$(cat .staging-token)   # never commit this file

k6 run --env API_BASE_URL=$API_BASE_URL --env AUTH_TOKEN=$AUTH_TOKEN load-tests/baseline.js
```

## Test files

| File          | VUs           | Duration    | Purpose                                      |
|---------------|---------------|-------------|----------------------------------------------|
| `baseline.js` | 100           | 5 min       | Normal production load; p95 < 100ms baseline |
| `spike.js`    | 0 → 2000      | ~6 min      | No crash under sudden traffic surge          |
| `soak.js`     | 50            | 30 min      | Memory leak detection (compare APM snapshots)|

## Thresholds

| Test     | Metric          | Threshold      |
|----------|-----------------|----------------|
| baseline | p95 duration    | < 100 ms       |
| baseline | error rate      | < 0.1%         |
| spike    | p99 duration    | < 2000 ms      |
| spike    | error rate      | < 1%           |
| soak     | p95 duration    | < 100 ms       |
| soak     | error rate      | < 0.1%         |

## Memory delta check (soak test)

k6 does not directly measure server memory. Use your APM tool:

1. Note `process.memoryUsage().rss` at t=0 (via `/metrics` Prometheus endpoint or APM).
2. Run soak test for 30 minutes.
3. Note RSS at t=30m.
4. **Pass**: delta < 10% of initial RSS. **Fail**: investigate with heap snapshots.

With Node.js, you can expose a `/debug/heap` endpoint in non-production environments
using `v8.writeHeapSnapshot()` triggered by a SIGUSR2 signal.

## CI integration

Load tests are NOT run in the standard PR pipeline (they take 6–30 minutes and need a live DB).
Run them manually in a dedicated performance environment before major releases.

Add to CI for performance tracking (optional):

```yaml
# .github/workflows/perf.yml (manual trigger only)
on:
  workflow_dispatch:
    inputs:
      test:
        type: choice
        options: [baseline, spike, soak]
```
