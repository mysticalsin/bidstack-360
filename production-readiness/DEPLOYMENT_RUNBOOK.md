# BidStack 360° — Deployment Runbook

**Scope:** How to build, migrate, deploy, gate, and smoke-test BidStack 360° from this repo.
**Grounded in:** `Dockerfile` (root, multi-target), `apps/api/Dockerfile` + `apps/worker/Dockerfile` (Railway), `apps/marketing/Dockerfile`, `docker-compose.prod.yml`, `scripts/run-deploy-evidence-bundle.mjs`, `scripts/verify-deploy-evidence.mjs`, `.github/workflows/ci.yml`, `package.json`.
**Companion docs:** `RELEASE_GATE_MATRIX.md` (per-gate status), `PRODUCTION_READINESS_REPORT.md` (verdict), `INVENTORY.md`, `UNKNOWN_ITEMS.md`.

> **Release status (from the gate matrix, 2026-06-27): NOT READY.** This runbook is the _procedure_. It does not by itself make the release shippable — the deploy-evidence gate (§7) and the operational gates (backup/restore drill, live IAM/network/TLS, load test) must PASS first. Items that cannot be completed without cloud/CI credentials or an authorized-testing scope are marked **REQUIRES ACCESS**.

---

## 1. Prerequisites

| Tool                         | Version / source                                                        | Why                                                                                                                              |
| ---------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Node.js                      | 24 LTS (`.nvmrc`, `engines.node >=24 <25`)                              | runtime + build                                                                                                                  |
| pnpm                         | 10 (`packageManager: pnpm@10.27.0`)                                     | workspace install/build                                                                                                          |
| Docker                       | Buildx with `# syntax=docker/dockerfile:1` (uses `--mount=type=cache`)  | image builds                                                                                                                     |
| Docker Compose v2            | supports `deploy.replicas`, `condition: service_completed_successfully` | local/compose path                                                                                                               |
| PostgreSQL image             | **`pgvector/pgvector:pg16`** — NOT stock `postgres:16`                  | schema uses `CREATE EXTENSION vector`, `vector(1024)` columns, HNSW indexes (RFP embeddings); `migrate deploy` fails on stock pg |
| Redis                        | `redis:7-alpine`, password-protected (`--requirepass`)                  | BullMQ queues + rate-limit + cache                                                                                               |
| Trivy, Semgrep, k6, gitleaks | pulled as pinned Docker images by the evidence scripts                  | container scan / SAST / load / secret scan (§7)                                                                                  |

The evidence-bundle tool-readiness step probes Node 24, a reachable Docker daemon, and the gitleaks/k6/semgrep/trivy images; semgrep + trivy are always run as Docker.

---

## 2. Environment & secrets (names only — never commit values)

Source of truth for the _required_ set is `docker-compose.prod.yml` (every `${VAR:?...}` is a hard requirement). Full catalogue of optional/feature vars: `.env.example`. **Never read or commit `.env*` except `.env.example`.** In the platform paths these are platform-managed secrets, not files.

### 2.1 Required — infrastructure

- **Postgres:** `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`
- **Redis:** `REDIS_PASSWORD`
- **Connection strings (every app + migrate):** `DATABASE_URL`, `REDIS_URL`

### 2.2 Required — migrate one-shot

- `DATABASE_URL`
- `BIDSTACK_DEPLOY_ENV=production`
- `BIDSTACK_MIGRATE_BACKUP_PROOF` — path to the fresh pre-migrate backup proof JSON. In compose this is a host file path; compose mounts it read-only at `/run/bidstack/migrate-backup-proof.json`.
- Optional: `BIDSTACK_MIGRATE_BACKUP_MAX_AGE_MINUTES` (default `60`)

### 2.3 Required — API service

- `DATABASE_URL`, `REDIS_URL`
- `PUBLIC_BASE_URL`, `PUBLIC_API_URL`
- `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`
- `INTEGRATION_TOKEN_KEY` (envelope key for stored integration tokens)
- `STORAGE_DRIVER` (must be `s3`), `S3_BUCKET`, `S3_REGION`, `STORAGE_SCAN_REQUIRED` (must be set explicitly)
- Optional/with defaults: `S3_ENDPOINT`, `S3_FORCE_PATH_STYLE`, `STORAGE_UPLOAD_MAX_BYTES`, `SENTRY_DSN`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `LOG_LEVEL`

### 2.4 Required — Web build args (baked at build time, not runtime)

- `VITE_CLERK_PUBLISHABLE_KEY` (passed in as build arg `PUBLIC_CLERK_PUBLISHABLE`; required when `BIDSTACK_WEB_BUILD_MODE=clerk`)
- `VITE_API_URL` (default `/api`), `ASSET_CDN_URL` (optional, for CDN base-path rewrite), `BIDSTACK_WEB_BUILD_MODE` (`clerk` | `demo` | `stub`)

### 2.5 Required — Worker service

- `DATABASE_URL`, `REDIS_URL`, `INTEGRATION_TOKEN_KEY`
- `STORAGE_DRIVER`, `S3_BUCKET`, `S3_REGION` (+ optional `S3_ENDPOINT`, `S3_FORCE_PATH_STYLE`)
- OCR (defaults present): `BIDSTACK_OCR_ENABLED`, `BIDSTACK_OCR_LANGUAGES`, `BIDSTACK_OCR_TIMEOUT_MS`, `BIDSTACK_OCRMYPDF_BIN`, `BIDSTACK_TESSERACT_BIN`
- Optional: `OMNIPARSE_BASE_URL`, `OMNIPARSE_TIMEOUT_MS`, all `DUST_*` agent IDs (`DUST_API_KEY`, `DUST_WORKSPACE_ID`, `DUST_DOCUMENT_EXTRACT_AGENT_ID`, `DUST_RFP_REVIEW_*_AGENT_ID`), `SENTRY_DSN`

### 2.6 Required — MCP server

- `DATABASE_URL`, `REDIS_URL`

### 2.7 Strongly recommended for real production (names from `.env.example`; not enforced by compose)

- **PII at rest:** `PII_FIELD_ENCRYPTION` (default OFF - set `true`), `PII_ENCRYPTION_MASTER_KEY`, storage-encryption evidence, and `User.email` at-rest decision evidence (see `PRODUCTION_READINESS_REPORT.md` Gate 5/13; run `scripts/encrypt-existing-pii.ts`, then `pnpm deploy:evidence:pii` against the release DB). **REQUIRES ACCESS** (prod secret store + DB access + platform/security decision).
- **Metrics scrape auth:** `METRICS_BEARER_TOKEN` (without it `/metrics` returns 404; with it, 401 on bad token)
- **Proxy trust / rate-limit correctness:** `TRUSTED_PROXIES`
- **Webhook verification:** `DUST_WEBHOOK_SECRET`; `CLERK_WEBHOOK_SECRET` (svix signing secret for `/webhooks/clerk` — automatic org bootstrap on `organization.created`; without it the endpoint refuses events and org registration falls back to `pnpm db:seed:prod`). Outbound webhook signing secrets use `INTEGRATION_TOKEN_KEY` and must have `BIDSTACK_WEBHOOK_SECRET_PLAINTEXT_FALLBACK=false` for release evidence.
- **Job signing:** `JOB_SIGNING_SECRET` / `BIDSTACK_JOB_SIGNING_SECRET`
- **Backups:** `BACKUP_S3_BUCKET`, `BACKUP_S3_REGION`, `BACKUP_S3_PREFIX`, `BACKUP_S3_ACCESS_KEY`, `BACKUP_S3_SECRET`, `BACKUP_ENCRYPT_KEY`
- Feature integrations (Apollo/Seamless/Tech-Intel/Microsoft/Google/Slack/Zoom/Twilio/Deepgram/Odoo/Salesforce/HubSpot/DocuSign), SSO (`SSO_ALLOWED_EMAIL_DOMAINS`), push (`VAPID_*`) — enable per feature scope.

> The `BIDSTACK_*` `deploy:evidence` env vars (release id, reviewer, approver, ops-readiness file, CI repeat proof input, container scan images, PII/webhook ciphertext DB URLs, load/API/sentry/a11y/browser/MCP targets and tokens) are inputs to the gate bundle (§7), not app runtime config.

---

## 3. Build sequence

The root `Dockerfile` `builder` stage encodes the canonical workspace build order. Out-of-order builds fail because each app imports the compiled `dist/` of its workspace deps and the generated Prisma client.

```
pnpm install --frozen-lockfile          # base stage
pnpm db:generate                        # Prisma client -> packages/db/generated  (MUST be first)
pnpm --filter @bidstack/shared build
pnpm --filter @bidstack/db build
pnpm --filter @bidstack/dust-client build
pnpm --filter @bidstack/memos build
pnpm --filter @bidstack/odoo-mcp-client build
pnpm --filter @bidstack/api build
pnpm --filter @bidstack/web build:prod  # mode-dependent (see below)
pnpm --filter @bidstack/worker build
pnpm --filter @bidstack/mcp-server build
```

Web build mode is selected by build arg `BIDSTACK_WEB_BUILD_MODE`:

- `clerk` -> `build:prod` (needs `PUBLIC_CLERK_PUBLISHABLE`) — **the production web build**
- `demo` -> `build:demo`
- `stub` -> `build` (default; non-Clerk)

Root Dockerfile targets: `base` -> `builder` -> { `migrate`, `api`, `web`, `worker`, `mcp-server` }, plus `worker-builder` (worker-only build path). The `marketing` site builds from `apps/marketing/Dockerfile` (no DB/Redis/auth). The `apps/worker/Dockerfile` ships the worker's OCR toolchain (ocrmypdf/tesseract/ghostscript/qpdf + python3); the XGBoost scoring sidecar is intentionally omitted and the worker degrades gracefully (falls back to logistic regression).

CI build verification (`.github/workflows/ci.yml`, `unit` job, no DB): `pnpm install --frozen-lockfile` -> `pnpm audit --audit-level high` -> `pnpm db:generate` -> `pnpm -r lint` -> `pnpm -r typecheck` -> `pnpm -r test` -> `pnpm -r build` -> PWA manifest check (`manifest.json`, `sw.js`, `icon-192.png`, `icon-512.png` present in `apps/web/dist`) -> web bundle-size guard (non-`react-*` chunk over 200 KB fails).

---

## 4. Database migration — migrate BEFORE rollout (non-negotiable)

Migrations run as a **dedicated one-shot** that must complete (exit 0) **before any app revision serves traffic**. This ordering prevents new app code from hitting an old schema.

The `migrate` target (root `Dockerfile`):

- Minimal image: installs only `@bidstack/db` deps, copies `packages/db/prisma`, strips pnpm/npm/corepack, **runs as non-root `bidstack`**.
- `CMD ["node", "scripts/run-safe-migrate-deploy.mjs", "--prisma-bin", "./packages/db/node_modules/.bin/prisma", "--schema", "packages/db/prisma/schema.prisma"]` — verifies the pre-migrate backup proof, then applies pending migrations idempotently.

### Pre-migrate backup proof (required for staging/production)

`scripts/run-safe-migrate-deploy.mjs` is the only approved migration entry point for staging/production. It fails closed unless the backup proof is fresh, encrypted, tied to the exact `DATABASE_URL` fingerprint, and stored in a durable location. It prints only the fingerprint prefix; it never prints the database URL.

Proof JSON contract:

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-06-29T11:58:00.000Z",
  "environment": "production",
  "databaseUrlFingerprint": "sha256:<64 hex chars>",
  "passed": true,
  "backup": {
    "kind": "pg_dump",
    "location": "s3://bidstack-prod-db-backups/pre-migrate/20260629T115800Z.dump",
    "encrypted": true,
    "restoreTested": false,
    "sizeBytes": 123456789
  }
}
```

Generate the fingerprint without printing `DATABASE_URL`:

```bash
node -e "if(!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required'); const {createHash}=require('crypto'); console.log('sha256:'+createHash('sha256').update(process.env.DATABASE_URL).digest('hex'))"
```

### Compose path (local / single-host)

`docker-compose.prod.yml` wires the ordering automatically:

- `migrate` `depends_on: postgres (service_healthy)`
- `api`, `worker`, `mcp-server` each `depends_on: migrate (service_completed_successfully)`

So `docker compose -f docker-compose.prod.yml up` is plug-and-play: Postgres becomes healthy -> `migrate` runs to completion -> apps boot. A failed migration exits non-zero and **blocks the apps from starting**.

```bash
export BIDSTACK_MIGRATE_BACKUP_PROOF=./ops/pre-migrate-backup-proof.production.json
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml logs -f migrate   # confirm "exited (0)"
```

### Azure path

Run the `migrate` image as a **Container Apps Job to completion** before rolling app revisions. Mount or inject the backup proof JSON at the path named by `BIDSTACK_MIGRATE_BACKUP_PROOF` before starting the job. Do not bake migrate into app startup. **REQUIRES ACCESS** (Azure subscription, ACR, job trigger).

> Never hand-run Prisma or hand-edit `prisma/migrations/` (generated). Use the migrate target / `pnpm db:migrate:deploy`.

**After first migrate on a fresh database:** register the Clerk organization +
system roles with `pnpm db:seed:prod -- --clerk-org <org_...> --name "<Org>"` —
without it every sign-in 404s ("Organization not registered") and, once the org
exists, every permission gate 403s until roles are seeded. System rows only,
idempotent, zero fixtures. Full real-data flow: `docs/PRODUCTION_DATA_BOOTSTRAP.md`.
Never run plain `pnpm db:seed` against production (fixture workspace).

---

## 5. Per-service deploy

| Service        | Target                                    | User                | Internal port(s)                                        | Healthcheck                               | Compose replicas / mem                  |
| -------------- | ----------------------------------------- | ------------------- | ------------------------------------------------------- | ----------------------------------------- | --------------------------------------- |
| **api**        | `api` (root Dockerfile)                   | non-root `bidstack` | 4000                                                    | `GET /readyz` (DB+Redis+storage, 200/503) | 2 / 512M                                |
| **web**        | `web` (nginx-unprivileged)                | `nginx` (UID 101)   | 8080                                                    | `GET /health` (nginx)                     | 2 / 128M; host `${WEB_HTTP_PORT:-8080}` |
| **marketing**  | `marketing` (`apps/marketing/Dockerfile`) | unprivileged nginx  | 8080                                                    | `GET /health`                             | 2 / 64M; host `8081`                    |
| **worker**     | `worker`                                  | non-root `bidstack` | 4002 (`WORKER_HEALTH_PORT`)                             | `GET /health` on 4002                     | 1 / 512M                                |
| **mcp-server** | `mcp-server`                              | non-root `bidstack` | 4001 MCP (`PORT_MCP`) + 4003 health (`MCP_HEALTH_PORT`) | `GET /health` on 4003                     | 1 / 256M                                |

Boot order is enforced by `depends_on`: postgres + redis healthy -> migrate completed -> api -> (web waits on api healthy). Worker and mcp-server also wait on migrate.

Build a single service image (Azure/registry path), e.g.:

```bash
docker build --target api -t <registry>/bidcrm-api:<immutable-tag> .
docker build --target worker -t <registry>/bidcrm-worker:<immutable-tag> .
docker build --target mcp-server -t <registry>/bidcrm-mcp:<immutable-tag> .
docker build --target migrate -t <registry>/bidcrm-migrate:<immutable-tag> .
docker build --target web \
  --build-arg BIDSTACK_WEB_BUILD_MODE=clerk \
  --build-arg PUBLIC_CLERK_PUBLISHABLE=<key> \
  --build-arg VITE_API_URL=/api \
  -t <registry>/bidcrm-web:<immutable-tag> .
```

Use **immutable digest refs** (`@sha256:...`) for anything fed to the container scan — the strict gate rejects mutable tags (§7).

---

## 6. Database / runtime dependencies

- **Postgres** = `pgvector/pgvector:pg16` (see §1). Memory limit 1G in compose; healthcheck `pg_isready`.
- **Redis** = `redis:7-alpine` started with `--requirepass ${REDIS_PASSWORD}`; healthcheck `redis-cli -a ... ping`. Unauthenticated Redis on the internal network is explicitly disallowed.
- **Object storage** = S3-compatible (`STORAGE_DRIVER=s3`). `STORAGE_SCAN_REQUIRED` must be set explicitly (malware-scan-before-serve posture).

---

## 7. Deploy-evidence gate (run before promoting)

The release gate is a two-layer system: a **bundle runner** that produces evidence artifacts, and a **strict verifier** that reads them and renders a pass/fail verdict. Artifacts land in `deploy-evidence/` and `load-test-report/`; the verifier enforces a freshness window (default 24h, `BIDSTACK_DEPLOY_EVIDENCE_MAX_AGE_HOURS`).

### 7.1 Preflight (operator readiness — no commands executed)

```bash
pnpm deploy:evidence:preflight:production    # -> deploy-evidence/release-preflight-latest.json
```

Validates that release inputs are present and non-placeholder: deploy env, immutable container scan image refs, load/API/sentry/a11y/browser/MCP **non-local** targets + tokens, ops-readiness file, secret-disposition file, approver/reviewer/ticket/timestamps. Passing preflight ≠ release approval — it just means the env is ready to run the real bundle. **Targets/tokens REQUIRE ACCESS.**

Use the generated `preflightSummary` and `preflightActionItems` fields as the operator checklist. Each failed input is grouped by area and includes the acceptable env var names, whether a value was present, whether the value is sensitive, and the non-secret failure detail. The console prints category counts plus the first required inputs; the JSON artifact is the complete list.

### 7.2 Full bundle (runs every evidence step, then the strict verifier)

```bash
pnpm deploy:evidence:bundle:production       # or :staging
```

Command plan (`scripts/run-deploy-evidence-bundle.mjs`), each step writes a `*-latest.json`:

| Step       | Script                              | What it proves                                                                                                                                                                                                                                                                                                                   |
| ---------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| tools      | `deploy:evidence:tools`             | Release tool readiness — Node 24, Docker daemon, gitleaks/k6/semgrep/trivy image probes                                                                                                                                                                                                                                          |
| source     | `deploy:evidence:source`            | Source-control evidence — release commit SHA, upstream, branch synced, **clean worktree**                                                                                                                                                                                                                                        |
| sourcePlan | `deploy:evidence:source:plan:write` | Source-review cleanup plan (diagnostic; runs even if `source` fails)                                                                                                                                                                                                                                                             |
| ci         | `deploy:evidence:ci`                | CI repeat evidence - compact proof of at least 10 consecutive full-suite CI runs on isolated pgvector-enabled Postgres tied to the exact release commit/branch; no failed/skipped suites, raw logs, command output, provider payloads, or secrets                                                                                |
| ops        | `deploy:evidence:ops`               | Operational readiness — approval (approver/ticket/ISO timestamp), Bicep build + what-if, private-networking, storage validated, migration job + deploy validated, backups configured + retention >=30d + geo-redundant, restore drill (RTO <=240m / RPO <=60m), rollback runbook + drill, monitoring alerts + on-call            |
| api        | `deploy:evidence:api`               | Live API connectivity — non-local API target + authenticated token; proves `/livez`, `/readyz` (DB + Redis + storage), `/health` (DB + Redis), matching release identity, `/api/me/capabilities` with user/org tenant context, and a no-match `GET /api/companies` domain read smoke without storing raw rows                    |
| pii        | `deploy:evidence:pii`               | Raw DB PII ciphertext proof - privacy-safe counts only; proves `Contact`, `Lead`, and `KamConsultant` PII columns are `enc:v1:*`, email hashes are present/valid, no plaintext rows remain, release DB storage encryption is evidenced, and `User.email` has an explicit storage-encryption-only decision for the current schema |
| webhooks   | `deploy:evidence:webhooks`          | Raw DB webhook signing-secret proof — privacy-safe counts only; proves every `WebhookSubscription.secret` decrypts with `INTEGRATION_TOKEN_KEY`, every decryptable row has a valid keyed `secret_hash`, and no legacy plaintext/unreadable/empty rows remain                                                                     |
| providers  | `deploy:evidence:providers`         | Provider source quality — `apollo`, `seamless`, `tech_intel` reachable/quality-checked                                                                                                                                                                                                                                           |
| mcp        | `deploy:evidence:mcp`               | Live MCP connectivity — non-local Streamable HTTP target + bearer token; proves `/.well-known/mcp`, `/health`, matching release identity, `initialize`, `notifications/initialized`, `tools/list` includes required tools, and one privacy-safe read-only `tools/call` succeeds                                                  |
| load       | `deploy:evidence:load`              | k6 **certification** load test (strict mode) against a non-local target; thresholds, p95 < 500ms, fail rate < 1%, checks > 99%                                                                                                                                                                                                   |
| semgrep    | `deploy:evidence:semgrep`           | Semgrep SAST — pinned image, scan configs, blocking severities (ERROR/CRITICAL/HIGH), Dockerfile syntax check, zero blocking findings                                                                                                                                                                                            |
| container  | `deploy:evidence:container`         | Trivy scan (strict) — **immutable digest refs**, raw Trivy vulnerability JSON + CycloneDX SBOM JSON per image, all required images covered, zero blocking vulns                                                                                                                                                                  |
| secrets    | `deploy:evidence:secrets`           | Secret-history disposition — current tree + current commit clean, full-history reviewed/rotated/owner-approved                                                                                                                                                                                                                   |
| sentry     | `deploy:evidence:sentry:trigger`    | Sentry smoke — triggers controlled API + worker failures against a non-local target, verifies Sentry issue queries for the exact release/environment/project, and stores only compact issue metadata with raw event payloads/stack traces/request bodies/user emails/command output omitted                                      |
| a11y       | `deploy:evidence:a11y`              | Accessibility Playwright regression — axe, color-contrast, and keyboard-navigation specs against a production build; strict mode requires non-local target + Clerk-backed auth and rejects failed/skipped/unknown outcomes                                                                                                       |
| browser    | `deploy:evidence:browser`           | Cross-role Playwright regression — roles admin/manager/read-only/viewer × chromium/firefox/webkit, `e2e/flows/rbac.spec.ts`, production build                                                                                                                                                                                    |
| verify     | `deploy:evidence:production`        | **Final strict verifier** — reads all artifacts, checks freshness + env match + strict invariants; exit 0 only if every gate passes                                                                                                                                                                                              |

Required container images the strict verifier expects in the scan: `bidcrm-api`, `bidcrm-web`, `bidcrm-worker`, `bidcrm-mcp`, `bidcrm-migrate` (override via `BIDSTACK_DEPLOY_REQUIRED_IMAGES`). The strict verifier rejects compact-only container summaries; each image report must include a raw Trivy JSON proof file and a valid CycloneDX SBOM JSON proof file. Override output folders with `BIDSTACK_CONTAINER_SCAN_RAW_REPORT_DIR` and `BIDSTACK_CONTAINER_SCAN_SBOM_REPORT_DIR` when CI stores evidence elsewhere.

CI repeat evidence inputs: provide either `BIDSTACK_CI_REPEAT_INPUT` pointing to a compact JSON object or `BIDSTACK_CI_REPEAT_RUNS_JSON` inline. The source must describe at least 10 consecutive passing full-suite CI runs, the exact release commit and branch, CI provider/workflow/review URL, isolated infrastructure, pgvector-enabled Postgres, zero failed/skipped suites, and privacy flags proving raw logs, command output, raw provider payloads, and secrets are excluded. The writer emits `deploy-evidence/ci-repeat-latest.json`; the strict verifier rejects artifacts that do not match `deploy:evidence:source`.

API evidence inputs: `BIDSTACK_API_CONNECTIVITY_TARGET` (or `BIDSTACK_API_BASE_URL` / `API_BASE_URL`), `BIDSTACK_API_CONNECTIVITY_API_TOKEN` (or `BIDSTACK_API_KEY` / `API_TOKEN`), optional `BIDSTACK_API_CONNECTIVITY_AUTH_SCHEME=api-key|bearer`, and optional `BIDSTACK_API_CONNECTIVITY_EXPECTED_ORG_ID`. Deployed API/MCP services must expose `BIDSTACK_RELEASE_COMMIT` and `BIDSTACK_RELEASE_BRANCH`; strict evidence compares live release metadata against `deploy:evidence:source`.

PII ciphertext evidence inputs: `BIDSTACK_PII_CIPHERTEXT_DATABASE_URL` (or `DATABASE_URL`), `PII_FIELD_ENCRYPTION=true`, `PII_ENCRYPTION_MASTER_KEY`, `BIDSTACK_STORAGE_ENCRYPTION_AT_REST=true`, `BIDSTACK_STORAGE_ENCRYPTION_PROVIDER`, `BIDSTACK_STORAGE_ENCRYPTION_EVIDENCE`, `BIDSTACK_USER_EMAIL_AT_REST_DECISION=storage-encryption-only`, `BIDSTACK_USER_EMAIL_AT_REST_DECISION_REF`, `BIDSTACK_USER_EMAIL_AT_REST_DECISION_OWNER`, optional `BIDSTACK_PII_CIPHERTEXT_REQUIRED_MODELS=contact,lead,kamConsultant`, and optional `BIDSTACK_PII_CIPHERTEXT_EVIDENCE`.

Webhook secret evidence inputs: run `pnpm webhooks:encrypt-secrets` first for a dry run, then `tsx scripts/encrypt-webhook-secrets.ts --apply` with release DB access if legacy plaintext rows or missing/invalid secret hashes are reported. The release gate then needs `BIDSTACK_WEBHOOK_SECRET_EVIDENCE_DATABASE_URL` (or `DATABASE_URL`), `INTEGRATION_TOKEN_KEY`, `BIDSTACK_WEBHOOK_SECRET_PLAINTEXT_FALLBACK=false`, and optional `BIDSTACK_WEBHOOK_SECRET_EVIDENCE`.

Sentry smoke evidence inputs: runtime must have `SENTRY_SMOKE_ENABLED=true`, `SENTRY_SMOKE_TOKEN`, `SENTRY_DSN`, `SENTRY_RELEASE`, and `SENTRY_ENVIRONMENT` for the deployed API/worker. The evidence runner also needs `BIDSTACK_SENTRY_API_BASE_URL` (or `API_BASE_URL`), `BIDSTACK_SENTRY_SMOKE_TOKEN` (or `SENTRY_SMOKE_TOKEN`), `BIDSTACK_SENTRY_AUTH_TOKEN` (or `SENTRY_AUTH_TOKEN`) for `sentry issue list`, `BIDSTACK_SENTRY_RELEASE` (or `SENTRY_RELEASE`), `BIDSTACK_SENTRY_ORG` (or `SENTRY_ORG`), `BIDSTACK_SENTRY_API_PROJECT`, `BIDSTACK_SENTRY_WORKER_PROJECT`, and `BIDSTACK_SENTRY_DSN_CONFIGURED=true`. The strict verifier rejects missing project metadata, failed issue queries, issue metadata from the wrong project, local/placeholder trigger targets, and artifacts containing raw event payloads, stack traces, request bodies, user emails, or raw command output.

Required MCP tools default to `opportunities.list`, `contacts.list`, `tasks.list`, `crm_search_companies` (override via `BIDSTACK_DEPLOY_REQUIRED_MCP_TOOLS` or `BIDSTACK_MCP_CONNECTIVITY_REQUIRED_TOOLS`). The default tool-call smoke is `crm_search_companies` with a no-match query and `limit:1`; override only with another read-only tool via `BIDSTACK_MCP_CONNECTIVITY_SMOKE_TOOL` and JSON-object `BIDSTACK_MCP_CONNECTIVITY_SMOKE_ARGS`. MCP evidence inputs: `BIDSTACK_MCP_CONNECTIVITY_TARGET` (or `BIDSTACK_MCP_PUBLIC_URL` / `DUST_MCP_PUBLIC_URL` / `MCP_BASE_URL`) and `BIDSTACK_MCP_CONNECTIVITY_API_TOKEN` (or `MCP_API_TOKEN` / `API_TOKEN`). The artifact stores release identity, tool names, status, result-shape counts, and privacy flags only; it must not store raw arguments or tool output.

A11y evidence inputs: `BIDSTACK_A11Y_TARGET` (or `BIDSTACK_BROWSER_E2E_TARGET` / `PLAYWRIGHT_BASE_URL`), `BIDSTACK_A11Y_AUTH_MODE=clerk` for strict release runs, and `BIDSTACK_A11Y_PRODUCTION_BUILD=true` (or `BIDSTACK_BROWSER_E2E_PRODUCTION_BUILD=true`). Override required specs/projects with `BIDSTACK_DEPLOY_REQUIRED_A11Y_SPECS` and `BIDSTACK_DEPLOY_REQUIRED_A11Y_PROJECTS` only when the release profile explicitly changes.

### 7.3 Verifier alone (re-check existing artifacts)

```bash
pnpm deploy:evidence:production    # strict; staging/production = STRICT_ENVS
pnpm deploy:evidence:staging
pnpm deploy:evidence               # default env=production
```

In strict envs (`staging`/`production`) soft-fails become hard fails; the process exits non-zero on any failure. Self-test (no live infra): `pnpm webhooks:encrypt-secrets:selftest`, `pnpm deploy:evidence:pii:selftest`, `pnpm deploy:evidence:webhooks:selftest`, `pnpm deploy:evidence:ci:selftest`, `pnpm deploy:evidence:selftest`, `pnpm deploy:evidence:bundle:selftest`.

### 7.4 Standalone policy / scan checks (also usable in CI)

`pnpm deploy:evidence:compose:policy`, `:azure:policy`, `:secret-rotation:policy`, `pnpm security:scan` (semgrep), `pnpm container:scan` (Trivy vulnerability scan + CycloneDX SBOM), `pnpm load-test:certify` (k6 certification).

> **REQUIRES ACCESS:** load/API/sentry/a11y/browser/provider/MCP steps need live non-local targets + authenticated tokens; container/semgrep need a Docker daemon + image pulls; ops + secrets steps need a populated readiness/disposition file backed by real backup/restore/rollback drills and a security owner sign-off. None of these can be PASSed from this sandbox.

---

## 8. Post-deploy smoke / health checks

Per-service probes (from the Dockerfile `HEALTHCHECK`s and `apps/api/src/routes/health.ts`):

```bash
# API (port 4000)
curl -fsS http://<api-host>:4000/livez     # liveness — 200 if the process is up
curl -fsS http://<api-host>:4000/readyz    # readiness — 200 only when DB + Redis + storage ready (503 otherwise)
curl -fsS http://<api-host>:4000/health    # DB + Redis ping, always 200 (dashboard view)
# /metrics requires METRICS_BEARER_TOKEN (404 if unset, 401 on bad token)

# Worker (port 4002)
curl -fsS http://<worker-host>:4002/health

# MCP server (health on 4003; MCP protocol on 4001)
curl -fsS http://<mcp-host>:4003/health

# Web + marketing (nginx, port 8080 internal)
curl -fsS http://<web-host>:8080/health
curl -fsS http://<marketing-host>:8080/health
```

Promote a service only after `/readyz` (API) returns 200 — it is the deepest probe (DB + Redis + storage). Use `/livez` for restart loops, `/readyz` for traffic gating, `/health` for dashboards. Confirm the `migrate` job/container shows `exited (0)` before traffic.

Smoke flow after green health: log in (Clerk), load dashboard, open an account, confirm a worker job (e.g. enrichment / RFP) is picked up, and check Sentry receives nothing unexpected.

---

## 9. The two in-repo deploy paths

### Path A — Azure Container Apps (production-grade) — via root `Dockerfile`

- Build each service from its **non-root** target: `api`, `web`, `worker`, `mcp-server`. All four run as the unprivileged `bidstack`/`nginx` user (container-escape blast-radius reduction).
- Run the **`migrate` target as a one-shot Container Apps Job to completion BEFORE rolling app revisions** (§4). Migrate runs non-root.
- Push immutable digest-tagged images to ACR, feed those digests to the container-scan gate (§7), and set all secrets in the Azure secret store / Key Vault (§2). **REQUIRES ACCESS.**
- This is the path real production must use.

### Path B — Railway (demo only) — via `apps/api/Dockerfile` (+ `apps/worker/Dockerfile`)

- Single final stage per service; point the Railway service's `RAILWAY_DOCKERFILE_PATH` at the standalone Dockerfile.
- **The `apps/api/Dockerfile` runtime stage runs as ROOT** and ships the builder's full workspace wholesale. Its `CMD` runs migrations inline at boot: `pnpm --filter @bidstack/db migrate:deploy && node dist/main.js` (idempotent on restart). This bypasses the root safe-migrate wrapper.
- **This image is DEMO-ONLY.** Running as root + inline boot-time migration is explicitly acceptable only for an isolated demo container. **Real production MUST use the non-root `api` target of the root `Dockerfile` (Path A) plus the guarded one-shot migrate target** — do not promote the Railway root image to production.
- Note `apps/api/Dockerfile` uses `pnpm install --no-frozen-lockfile`; the root Dockerfile uses `--frozen-lockfile`. Prefer the frozen, non-root path for prod.

---

## 10. Rollback (outline — drill REQUIRES ACCESS)

- **App rollback:** redeploy the previous immutable image digest per service (Azure revision pin / Railway redeploy). Stateless apps roll back cleanly.
- **Schema rollback:** Prisma `migrate deploy` is forward-only. A schema rollback needs a compensating migration or a point-in-time restore — not an automatic down-migration. Validate via a **rollback drill** in staging before relying on it.
- The ops-readiness gate (§7) requires `rollback.runbookReviewed` + a `rollbackDrillAt` ISO timestamp and a restore drill within RTO/RPO thresholds. Those are real drills against real infra — **REQUIRES ACCESS**, and per the gate matrix are currently FAIL/UNKNOWN (Gate 12 CRITICAL).

---

## 11. REQUIRES ACCESS — cannot be completed from this repo/sandbox

1. Provisioning + secrets in the platform store (Azure Key Vault / Railway vars) — §2.
2. Running the Azure migrate Job and rolling app revisions — §4/§9A.
3. Backup configuration + **restore drill** + **rollback drill** (RTO/RPO) — §7 ops, §10. Gate 12 (CRITICAL).
4. Live IAM / network / DNS / TLS / bucket review — Gate 6.
5. k6 certification load test against a live non-local target — §7 load, Gate 10.
6. Live MCP Streamable HTTP smoke against the deployed MCP endpoint — §7 mcp, Gate 4/6.
7. Sentry smoke + strict a11y/cross-role browser regression against a live target — §7.
8. Container + SAST + secret scans run in CI with a Docker daemon — §7, Gates 7/8.
9. `PII_FIELD_ENCRYPTION=true` + master key + storage/User.email decision proof + `pnpm deploy:evidence:pii` release DB proof — §2.7/§7, Gate 5/13.
10. Webhook signing-secret backfill/apply + `pnpm deploy:evidence:webhooks` release DB proof — §2.7/§7, Gate 5.

See `UNKNOWN_ITEMS.md` for the full list and `RELEASE_GATE_MATRIX.md` for current per-gate status. Until those gates PASS, the strict verifier (`pnpm deploy:evidence:production`) will exit non-zero and the release is **NOT READY**.
