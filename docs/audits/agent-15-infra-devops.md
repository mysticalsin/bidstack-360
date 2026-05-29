# Infrastructure & DevOps Audit — BidStack 360°

**Auditor:** agent-15  
**Scope:** `.github/workflows/`, `Dockerfile*`, `docker-compose*`, `.env.example`, `package.json` scripts, CI configs, deployment configs  
**Rubric dimension:** Infra 25  
**Date:** 2026-05-23

---

## 1. Score

**72 / 100**

The domain demonstrates strong fundamentals—multi-layered secret scanning, multi-stage Docker builds with health checks, comprehensive GitHub Actions CI, structured observability (Pino + Sentry + OpenTelemetry + Prometheus), and graceful shutdown hooks. However, the score is capped by the absence of an automated rollback strategy, missing production environment template files, env-var documentation drift, and no container image vulnerability scanning or Infrastructure-as-Code.

---

## 2. Strengths

- **Multi-layered secret scanning** — Three independent gates: (a) `.husky/pre-commit:11` runs `scripts/check-secrets.sh` on staged diffs; (b) `.github/workflows/gitleaks.yml:29-45` scans full git history with `fetch-depth: 0`; (c) `.github/workflows/ci.yml:86-95` runs a full-tree custom pattern scan. The patterns are synchronized between `.gitleaks.toml` and `scripts/check-secrets.sh`.

- **Multi-stage Docker builds with per-service health checks** — `Dockerfile:1-145` defines targets `base → builder → api | web | worker | mcp-server`. Every runtime target exposes a health check: API uses `/readyz` (`Dockerfile:70-71`), web uses nginx `wget` (`Dockerfile:80-81`), worker uses `:4002/health` (`Dockerfile:114-115`), MCP server uses `:4003/health` (`Dockerfile:143`). The marketing site has its own `Dockerfile` with `nginxinc/nginx-unprivileged:alpine` and a health check on `:8080/health`.

- **Comprehensive CI pipeline with quality gates** — `.github/workflows/ci.yml:1-254` runs: `pnpm audit --audit-level high` (line 41), Prisma generate (line 46), lint, typecheck, unit tests (with DATABASE_URL guard so integration suites self-skip), build, PWA manifest verification (lines 61-65), bundle size guard rejecting non-react chunks >200 KB (lines 67-80), full-tree secret scan (lines 86-95), integration tests against real Postgres 16 + Redis 7 (lines 99-163), and an E2E smoke pass with Playwright (lines 166-254). Concurrency controls cancel stale runs (line 10-12).

- **Structured observability stack** — `apps/api/src/lib/logger.ts:33-79` configures Pino with Datadog correlation fields (`service`, `env`), redaction of 17+ secret/PII paths, and ISO 8601 timestamps. `apps/api/src/plugins/sentry.ts:59-89` initializes Sentry with recursive PII scrubbing (`scrubPii`) and a 10% traces sample rate. `apps/api/src/otel.ts:11-30` sets up OpenTelemetry OTLP trace export when `OTEL_EXPORTER_OTLP_ENDPOINT` is present. `apps/api/src/routes/health.ts:125-185` exposes a built-in Prometheus-compatible `/metrics` endpoint with counters/histograms for HTTP requests, DB query duration, and BullMQ job stats.

- **Graceful shutdown and boot-time hardening** — `apps/api/src/main.ts:39-62` implements a 15-second shutdown timeout that closes Fastify, disconnects Prisma, quits Redis, and shuts down Sentry + OTEL. `apps/api/src/env.ts` validates all environment variables with Zod at startup, failing fast on misconfiguration.

- **Production Docker Compose with resource limits and required-env validation** — `docker-compose.prod.yml:1-164` enforces required env vars via bash `${VAR:?msg}` syntax (e.g., line 7: `POSTGRES_USER: ${POSTGRES_USER:?POSTGRES_USER is required}`), sets `restart: unless-stopped`, deploys replicas, and applies memory limits (Postgres 1G, API 512M, web 128M, marketing 64M).

- **Performance & documentation quality gates in CI** — `.github/workflows/lighthouse.yml:1-129` runs Lighthouse CI with thresholds (performance ≥90, accessibility ≥95, best-practices ≥90, SEO ≥90) and posts averaged scores as PR comments. `.github/workflows/tsdoc-coverage.yml:1-139` computes TSDoc coverage deltas and blocks regressions >0.5%. `.github/workflows/semgrep.yml:1-61` runs OWASP + secrets + Dockerfile SAST with ERROR-only blocking. `.github/workflows/dependency-review.yml:1-41` blocks PRs introducing CRITICAL/HIGH CVEs.

- **Operational runbooks** — `scripts/ops/rotate-secrets.sh:1-288` implements a quarterly secret rotation workflow with JWT 1-hour overlap, backup creation, and audit logging. `scripts/ops/deploy-checklist.sh:1-293` provides an 8-gate pre-deploy script. `scripts/load-test.js:1-67` includes a k6 load-test with p95 < 500ms and error-rate < 1% thresholds.

---

## 3. P0 Gaps (Critical)

### 3.1 No automated rollback strategy

There is no blue/green, canary, or automated rollback mechanism in any workflow. The `deploy-checklist.sh` script validates gates locally, but the CI pipeline does not deploy images or execute an automated rollback if health checks fail post-deploy. The only rollback artifact is `scripts/merge/rollback.sh` (a Git merge helper), not an infrastructure rollback.

**Impact:** A bad deploy to production requires manual intervention; there is no automated path to the previous stable version.

### 3.2 Missing `.env.production.template`

`scripts/ops/bootstrap-production.sh:26` references `.env.production.template` as its source of truth, but the file does not exist in the repository. The script will fail at line 71-74 with `"$TEMPLATE_FILE not found"`.

**Evidence:**

```bash
# scripts/ops/bootstrap-production.sh:71-74
if [[ ! -f "$TEMPLATE_FILE" ]]; then
  log_error "$TEMPLATE_FILE not found. Run this script from the project root."
  exit 1
fi
```

### 3.3 deploy-checklist.sh validates undocumented environment variables

`scripts/ops/deploy-checklist.sh:87-101` checks for `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PUBLISHABLE_KEY`, `JWT_SIGNING_PRIVATE_KEY`, `JWT_SIGNING_PUBLIC_KEY`, `APP_URL`, and `CORS_ORIGINS`. None of these keys appear in `.env.example`.

**Evidence:**

```bash
# scripts/ops/deploy-checklist.sh:87-101
REQUIRED_VARS=(
  DATABASE_URL
  REDIS_URL
  CLERK_SECRET_KEY
  CLERK_PUBLISHABLE_KEY
  STRIPE_SECRET_KEY          # NOT in .env.example
  STRIPE_WEBHOOK_SECRET      # NOT in .env.example
  STRIPE_PUBLISHABLE_KEY     # NOT in .env.example
  JWT_SIGNING_PRIVATE_KEY    # NOT in .env.example
  JWT_SIGNING_PUBLIC_KEY     # NOT in .env.example
  INTEGRATION_TOKEN_KEY
  RESEND_API_KEY
  APP_URL                    # NOT in .env.example (PUBLIC_BASE_URL exists)
  CORS_ORIGINS               # NOT in .env.example
)
```

### 3.4 No container image vulnerability scanning in CI

Neither the CI workflows nor the Dockerfile build steps scan images for OS or dependency CVEs. Tools like Trivy, Grype, or Anchore are absent.

**Impact:** A vulnerable base image (e.g., `node:24-alpine` or `nginx:alpine`) can propagate to production undetected.

### 3.5 Redis service in CI E2E job lacks health-check options

In `.github/workflows/ci.yml:187-189`, the Redis service definition does not include `--health-cmd`, `--health-interval`, `--health-timeout`, or `--health-retries`, unlike the Postgres service immediately above it (lines 114-118) and unlike the Redis definitions in `.github/workflows/e2e.yml:130-137`.

**Evidence:**

```yaml
# .github/workflows/ci.yml:187-189
redis:
  image: redis:7-alpine
  ports: ['6379:6379']
  # Missing: options: --health-cmd "redis-cli ping" ...
```

---

## 4. P1 Gaps (High)

### 4.1 No Docker image build or push in CI

The CI workflows never build or push container images to a registry. The Dockerfiles are only exercised via `docker-compose.yml` locally. There is no `docker/build-push-action`, no image tagging by git SHA, and no registry caching.

### 4.2 No automated dependency update mechanism

There is no `dependabot.yml`, Renovate config, or similar automated dependency update workflow. While Semgrep and dependency-review block new CVEs, proactive updates are manual.

### 4.3 No staging / pre-production deployment workflow

All workflows target `main` and PR branches. There is no workflow that deploys to a persistent staging environment on merge to `main`, which means the first time the full stack runs in a production-like configuration is either locally or in production itself.

### 4.4 Missing observability env vars in `.env.example`

`METRICS_BEARER_TOKEN` (gated in `apps/api/src/routes/health.ts:192-194`), `SENTRY_RELEASE`, `SENTRY_TRACES_SAMPLE_RATE`, `DD_SERVICE`, and `DD_ENV` are referenced in code but absent from `.env.example`, making local reproduction of production observability behavior difficult.

### 4.5 No log shipping sidecar or centralized log forwarding config

While Pino produces structured logs, `docker-compose.prod.yml` does not include a Fluent Bit, Vector, or similar sidecar to forward logs to a centralized store. Production operators must rely on host-level log collection.

### 4.6 Database migration strategy lacks dry-run and backward-compatibility checks

CI runs `pnpm db:migrate:deploy` (`.github/workflows/ci.yml:153`), but there is no step to verify that migrations are backward-compatible with the currently deployed app version, nor a dry-run mode for production migrations. A breaking migration could cause downtime during deploy.

### 4.7 Worker health-check port mismatch risk

`Dockerfile:113-114` exposes port `4002` for the worker health check, but `docker-compose.prod.yml:108-141` does not map or document this port. If the worker health check is intended for orchestrator use, the port should be exposed in compose.

---

## 5. P2 Gaps (Nice-to-have)

### 5.1 No Infrastructure-as-Code

There is no Terraform, Pulumi, Helm, or CloudFormation for provisioning Postgres, Redis, S3, DNS, or load balancers. All infrastructure provisioning is assumed to be manual or managed outside the repo.

### 5.2 No automated DB backup verification or restore drill

`.env.example:197-216` documents backup S3 config and a Slack webhook for recovery drill notifications, but there is no CI workflow or cron job that automates backup creation, verification, or restore drills.

### 5.3 No container image signing or SBOM generation

Images are neither signed (cosity / notation) nor accompanied by a Software Bill of Materials, which limits supply-chain auditability.

### 5.4 No multi-region or disaster-recovery strategy documented

No runbook, diagram, or configuration exists for failing over to a secondary region or recovering from a complete regional outage.

### 5.5 No automated base-image patching workflow

There is no scheduled workflow (e.g., weekly) that rebuilds images to pull the latest `node:24-alpine` or `nginx:alpine` security patches and runs smoke tests.

---

## 6. Evidence

### 6.1 Secret scanning layers

**Pre-commit hook (`.husky/pre-commit:8-11`):**

```bash
MAX_ARG_LENGTH=4096 pnpm exec lint-staged || exit 1
sh scripts/check-secrets.sh || exit 1
```

**CI full-tree scan (`.github/workflows/ci.yml:91-95`):**

```yaml
steps:
  - uses: actions/checkout@v4
    with:
      fetch-depth: 1
  - name: Scan tracked files
    run: bash scripts/check-secrets.sh --full
```

**Gitleaks config (`.gitleaks.toml:1-50`)** layers custom Stripe, Clerk, AWS, and PEM rules on top of the default ruleset.

### 6.2 Dockerfile health checks

**API target (`Dockerfile:70-71`):**

```dockerfile
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:4000/readyz', (r) => r.statusCode===200?process.exit(0):process.exit(1))"
```

### 6.3 Pino redaction (`apps/api/src/lib/logger.ts:49-70`)

```typescript
redact: {
  paths: [
    'req.headers.authorization',
    'req.headers.cookie',
    'req.headers["x-api-key"]',
    '*.password',
    '*.secret',
    '*.token',
    '*.apiKey',
    '*.api_key',
    '*.accessToken',
    '*.refresh_token',
    'err.config.headers.Authorization',
  ],
  remove: true,
},
```

### 6.4 Prometheus metrics (`apps/api/src/routes/health.ts:129-157`)

```typescript
export const httpRequestsTotal = new Counter(
  'http_requests_total',
  'Total HTTP requests processed',
  ['method', 'route', 'status_code'],
);
export const httpRequestDuration = new Histogram(
  'http_request_duration_seconds',
  'HTTP request duration in seconds',
  ['method', 'route'],
);
export const dbQueryDuration = new Histogram(
  'db_query_duration_seconds',
  'Prisma query duration in seconds',
  ['operation'],
);
```

### 6.5 Graceful shutdown (`apps/api/src/main.ts:40-62`)

```typescript
const shutdown = async (signal: string) => {
  server.log.info({ signal }, 'shutting down API');
  const timeout = setTimeout(() => {
    server.log.error('forced exit after shutdown timeout');
    process.exit(1);
  }, 15_000);
  try {
    await server.close();
    await prisma.$disconnect();
    await redis.quit();
    await shutdownSentry();
    await shutdownTelemetry();
    clearTimeout(timeout);
    server.log.info('shutdown complete');
    process.exit(0);
  } catch (err) {
    server.log.error({ err }, 'shutdown error');
    clearTimeout(timeout);
    process.exit(1);
  }
};
```

### 6.6 Required env validation in production compose (`docker-compose.prod.yml:46-50`)

```yaml
environment:
  NODE_ENV: production
  DATABASE_URL: ${DATABASE_URL:?DATABASE_URL is required}
  REDIS_URL: ${REDIS_URL:?REDIS_URL is required}
  PUBLIC_BASE_URL: ${PUBLIC_BASE_URL:?PUBLIC_BASE_URL is required}
```

### 6.7 Bundle size guard (`.github/workflows/ci.yml:72-80`)

```yaml
- name: Bundle size guard (web)
  run: |
    set -e
    cd apps/web
    BIG=$(find dist/assets -name "*.js" -size +200k 2>/dev/null | grep -v "react-" || true)
    if [ -n "$BIG" ]; then
      echo "::error::Web chunk over 200KB (excluding react-*):"
      echo "$BIG" | xargs ls -lah
      exit 1
    fi
```

### 6.8 Redis missing health check in CI smoke (`ci.yml:187-189`)

```yaml
redis:
  image: redis:7-alpine
  ports: ['6379:6379']
  # No options: --health-cmd ...
```

---

## 7. Recommendations (Priority Order)

1. **Create `.env.production.template`** and synchronize it with `deploy-checklist.sh` and `.env.example` so that all three env-var references are consistent.
2. **Add a container image build/push job** to CI (e.g., on pushes to `main` and `release/**`) with `docker/build-push-action`, layer caching via `cache-from`/`cache-to`, and a Trivy/Grype vulnerability scan step.
3. **Add an automated rollback workflow** — at minimum, a GitHub Actions job that deploys to staging first, runs smoke tests against `/readyz`, and gates production deploy on success.
4. **Add `--health-cmd` to the Redis service** in `.github/workflows/ci.yml` to match the E2E workflow and ensure the E2E smoke job waits for a healthy Redis.
5. **Add `METRICS_BEARER_TOKEN`, `SENTRY_RELEASE`, `SENTRY_TRACES_SAMPLE_RATE`, `DD_SERVICE`, and `DD_ENV`** to `.env.example` with documentation comments.
6. **Document the database migration rollback procedure** and add a backward-compatibility check (e.g., verify no column drops or renames in the migration diff) to the integration job.
7. **Add a staging deploy workflow** triggered on merge to `main` that exercises `docker-compose.prod.yml` with stub secrets and runs the k6 load test.
