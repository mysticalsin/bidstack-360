# Factory 0: Recon (Polo enterprise upgrade)

Read-only recon of `mysticalsin/bidstack-360` for the Polo enterprise upgrade. Later slices (1 to 7)
depend on this file. Nothing in the app was changed to produce it.

- Recon date: 2026-11-06
- Base: `origin/main` at `ad2d0839` ("Merge pull request #293 from mysticalsin/fix/pipeline-layout-shift")
- Clone: `~/dev/bidstack-360` (outside OneDrive). Branch for this PR: `factory/0-recon-design`.

## 0. Read this first: `main` vs `demo`

- The GitHub **default branch is `demo`**, but **`main` is the integration branch**: it is 650 commits
  ahead of `demo` and every CI workflow on `main` triggers on `pull_request: branches: [main]`.
- A plain `git clone` checks out `demo`. Slice agents must branch from `origin/main`:
  `git fetch origin && git worktree add ../bidstack-360-<n> -b factory/<n>-<slug> origin/main`.
- `demo` has older workflows (different gate list, PNPM 10 floating, no worker/mcp excludes).
  Never copy gate commands from `demo`.

## 1. Monorepo map

pnpm 10.27.0 workspace (`pnpm-workspace.yaml`: `apps/*`, `packages/*`, excluding
`packages/twenty-bidstack` and `apps/mobile`). Node 24 (`.nvmrc` = `24`, engines `>=24 <25`).

| Package | Name | Stack | Role |
| --- | --- | --- | --- |
| `apps/web` | `@bidstack/web` | React 18.3, Vite 6.4, Tailwind 4.3 (CSS-first), React Router 6, TanStack Query 5, Radix, `motion` 12 + `framer-motion` 12, `lucide-react`, Recharts 3, Zustand, nuqs, i18next | SPA (port 38081 dev, 4173 preview, 4174 in CI e2e) |
| `apps/api` | `@bidstack/api` | Fastify 5, zod 3, BullMQ 5 producers, Prisma via `@bidstack/db`, `@fastify/rate-limit` | REST API (port 4000) |
| `apps/worker` | `@bidstack/worker` | BullMQ 5 workers on ioredis | Queues: webhook delivery, workflows, RFP, calendar, SMS, tenant export, retention |
| `apps/mcp-server` | `@bidstack/mcp-server` | Fastify 5, `@modelcontextprotocol/sdk` 1.29 | MCP tools over the CRM |
| `apps/marketing` | `@bidstack/marketing` | React 18, Vite, Tailwind 4 beta | Marketing site |
| `apps/polo-preview` | `@bidstack/polo-preview` | Cloudflare Worker + Durable Object relay | Access-gated preview tunnel |
| `apps/chrome-extension`, `apps/docs` | | | Extension, docs |
| `packages/db` | `@bidstack/db` | Prisma 5.22, Postgres 16 + pgvector | Schema (`prisma/schema.prisma`, 107 migrations), middleware: PII encryption, tenant scope guard, audit immutability, soft delete |
| `packages/shared` | `@bidstack/shared` | zod | RBAC matrix, permissions, queue configs, SSRF, webhook URL check, crypto (`server-crypto` subpath) |
| `packages/eslint-rules` | | | `design-law.js` (token and raw-hex rules), `no-raw-button-strings.js` |
| `packages/dust-client`, `odoo-mcp-client`, `integrations`, `memos` | | | Provider clients |
| `packages/sdk-go`, `sdk-python`, `sdk-ruby` | | | Public API SDKs |
| `packages/twenty-bidstack` | | | Frozen overlay, excluded from the workspace |

### Web UI specifics (for slices 1 to 5)

- Entry: `apps/web/src/main.tsx`, `App.tsx`. Routes: `apps/web/src/routes/AppRoutes.tsx`,
  `AdminRoutes.tsx`, `BidRoutes.tsx`, `OpsRoutes.tsx`, `DevRoutes.tsx`, `lazyPages.tsx`, `AuthGuards.tsx`.
- Shell today: `apps/web/src/components/layout/` (`AppShell.tsx`, `Sidebar.tsx`, `Topbar.tsx`,
  `MobileNav.tsx`, `navConfig.ts`, `PageHeader.tsx`, `RouteAnnouncer.tsx`).
- Settings is a tabbed page: `apps/web/src/pages/SettingsPage.tsx` + `components/settings/SettingsLayout.tsx`
  (tab ids include `webhooks`, `audit-log`, `identity`, `data-import`, `serum`). `/webhooks`,
  `/audit-log`, `/integrations` are redirects into `/settings?tab=...`.
- Styling: Tailwind 4.3.3 via `@tailwindcss/vite`, no `tailwind.config.*`. One big stylesheet
  `apps/web/src/index.css` (about 6,100 lines) holds `:root`/`[data-theme='light']` and
  `[data-theme='dark']` CSS variables plus a single `@theme` bridge. Route CSS: `src/styles/cockpit.css`,
  `src/styles/org-dashboard.css`. Dark mode is `@variant dark (&:where([data-theme="dark"], [data-theme="dark"] *))`.
- `cn()` lives at `apps/web/src/lib/cn.ts` (clsx + tailwind-merge). Alias `@/*` maps to `apps/web/src/*`
  (tsconfig paths + vite alias). There is no `@/lib/utils`.
- Motion: `apps/web/src/lib/motion.ts` (springs, eases, variants; imports `framer-motion`) and
  `components/motion/*`. CSS duration vars `--duration-exit 150ms / --duration-enter 210ms / --duration-move 400ms`.
  `motion/react` is already used in `components/login/*`.
- Component library: in-house, `apps/web/src/components/ui/` (Button, Badge, Card, Dialog, Sheet, Tabs,
  Toast, Tooltip, Table, Select, StateMessages, CursorPager, ...), table kit `components/table-kit/`,
  charts `components/charts/` (large custom SVG chart kit plus Recharts), `components/viz/`,
  `components/kokonutui/`, `components/motion-primitives/`.
- Icons: `lucide-react` only today. `@phosphor-icons/react` is not installed.
- One token vocabulary is law: ADR `docs/adr/0002-design-tokens.md` (Decisions 3 and 4) and the ESLint
  rules in `packages/eslint-rules/design-law.js` (`no-foreign-token-vocabulary`, `no-arbitrary-geometry`,
  `no-theme-variant-geometry` at `error`, `no-raw-hex-in-classname` at `warn`) ban shadcn names such as
  `text-muted-foreground` and literal geometry such as `rounded-[1.375rem]` in `apps/web/src`. Grafted
  components are rewritten to repo token names at import (precedent: `components/table-kit/*` headers
  list each rewrite). One live leftover: `components/charts/funnel-chart.tsx:627` uses `text-foreground`,
  which `@theme` does not define, so it renders unstyled.
- Brand: code on `main` is green (`--brand-primary` `#006b4f` light, `#00805e` dark fill, `--brand-deep`
  `#3fbe93` dark foreground; see `docs/DESIGN.md`). ADR 0002 Decision 1 and ADR 0005 still say blue
  `#2c4bff` / `#5e6ad2`; those brand rows are **stale** against the code. Root `DESIGN.md` v1.0.0 tables
  (blue, Inter, 14px radius) are also stale.

## 2. CI gate list on `main` (verbatim)

Workflows in `.github/workflows/`: `ci.yml`, `e2e.yml`, `gitleaks.yml`, `semgrep.yml`, `supply-chain.yml`,
`dependency-review.yml`, `lighthouse.yml`, `tsdoc-coverage.yml`, `deploy.yml` (CD, `workflow_run` after
CI and E2E on `main`). Setup everywhere: `pnpm/action-setup` with `10.27.0`, `setup-node` with `.nvmrc`,
then `pnpm install --frozen-lockfile`. There is **no separate architecture-ratchet script** in this repo;
the design-law ESLint rules run inside `pnpm -r lint`.

### `ci.yml` job `unit` (blocking, every PR and push to `main`)

```bash
pnpm install --frozen-lockfile
pnpm audit --audit-level high
pnpm db:generate
pnpm -r lint
pnpm typecheck
pnpm --filter '!@bidstack/api' --filter '!@bidstack/mcp-server' --filter '!@bidstack/worker' -r test
pnpm --filter @bidstack/worker exec vitest run --passWithNoTests --pool=forks --no-file-parallelism --isolate=true --exclude src/account-enrichment/job.test.ts --exclude src/agent/facts.contract.test.ts --exclude src/lib/org-llm.test.ts --exclude src/mars/sync-powerbi.test.ts --exclude src/mars/sync.test.ts --exclude src/meeting-intel/pipeline.test.ts --exclude src/org-chart/seed.test.ts --exclude src/queues/account-watchdog.contract.test.ts --exclude src/queues/ai-audit-retention.contract.test.ts --exclude src/queues/calendar-sync-cron.test.ts --exclude src/queues/calendar-sync-microsoft.test.ts --exclude src/queues/calendar-sync-push-idempotency.test.ts --exclude src/queues/company-intel-import.contract.test.ts --exclude src/queues/document-extract.contract.test.ts --exclude src/queues/msa-reminders.test.ts --exclude src/queues/msa-text-extract.test.ts --exclude src/queues/queues.test.ts --exclude src/queues/sms.test.ts --exclude src/queues/tenant-export.contract.test.ts
pnpm --filter @bidstack/mcp-server exec vitest run --passWithNoTests --exclude src/tools/kam-tools.test.ts
pnpm --filter @bidstack/api exec vitest run --passWithNoTests --exclude "**/*.integration.test.ts" --exclude "src/routes/audit-logs.test.ts" --exclude "src/routes/companies.test.ts" --exclude "src/routes/crm/companies.test.ts" --exclude "src/routes/crm/connectors.test.ts" --exclude "src/routes/crm/dashboard.test.ts" --exclude "src/routes/crm/health.test.ts" --exclude "src/routes/crm/summary.test.ts" --exclude "src/routes/crm/widgets.test.ts" --exclude "src/routes/notes.test.ts" --exclude "src/routes/opportunity-timeline.test.ts" --exclude "src/plugins/request-id.test.ts" --exclude "src/plugins/security-headers.test.ts" --exclude "src/routes/dust-integration.test.ts" --exclude "src/routes/ops-sentry-smoke.test.ts" --exclude "src/security/penetration.access-control.test.ts" --exclude "src/security/penetration.injection-upload.test.ts" --exclude "src/security/penetration.webhook.test.ts"
pnpm -r build
test -f apps/web/dist/manifest.json && test -f apps/web/dist/sw.js && test -f apps/web/dist/icon-192.png && test -f apps/web/dist/icon-512.png
cd apps/web && BIG=$(find dist/assets -name "*.js" -size +200k 2>/dev/null | grep -vE 'react-|vendor-|motion-|charts-|editor-|flow-|DashboardPage-|SettingsPage-|index-' || true); [ -z "$BIG" ]
```

### `ci.yml` job `secrets-full-scan`

```bash
bash scripts/check-secrets.sh --full
```

### `ci.yml` job `integration` (PRs and `main`; services `pgvector/pgvector:pg16`, `redis:7-alpine`)

Env: `NODE_ENV=test`, `DATABASE_URL=postgres://bidstack:bidstack_test@localhost:5432/bidstack_test`,
`REDIS_URL=redis://localhost:6379`.

```bash
pnpm db:generate
pnpm --filter @bidstack/shared --filter @bidstack/dust-client --filter @bidstack/odoo-mcp-client --filter @bidstack/db --filter @bidstack/memos --filter @bidstack/integrations build
pnpm db:migrate:deploy
pnpm db:seed
pnpm --filter @bidstack/api test
pnpm --filter @bidstack/mcp-server test
pnpm --filter @bidstack/worker test
```

### `ci.yml` job `e2e` (smoke)

```bash
pnpm --filter @bidstack/web exec playwright install --with-deps chromium
# db:generate, workspace package build, db:migrate:deploy, db:seed as above
VITE_API_URL=http://127.0.0.1:4000 VITE_AUTH_MODE=stub BIDSTACK_ALLOW_STUB_AUTH=true pnpm --filter @bidstack/web build
PORT_API=4000 BIDSTACK_ALLOW_STUB_AUTH=true BIDSTACK_ALLOW_STUB_ROLE_HEADER=true pnpm --filter @bidstack/api exec tsx src/main.ts &
pnpm --filter @bidstack/web exec vite preview --host 127.0.0.1 --port 4174 &
E2E_BASE_URL=http://127.0.0.1:4174 E2E_API_URL=http://127.0.0.1:4000 pnpm --filter @bidstack/web e2e:smoke
```

`e2e:smoke` = `playwright test e2e/smoke.spec.ts --project=chromium-desktop`.

### `e2e.yml` (full suite, 3 shards, PRs and `main`)

Same DB/API/preview setup (`VITE_AUTH_MODE=stub`, `BIDSTACK_ALLOW_STUB_AUTH=true`), then per shard:

```bash
CI=true E2E_BASE_URL=http://127.0.0.1:4174 E2E_API_URL=http://127.0.0.1:4000 E2E_BOOKING_SLUG='' E2E_SIGN_TOKEN='' \
  pnpm --filter @bidstack/web exec playwright test --project=chromium-desktop --shard="${E2E_SHARD}/${E2E_SHARD_TOTAL}"
```

### Other PR workflows

| Workflow | Command | Blocking? |
| --- | --- | --- |
| `gitleaks.yml` | `gitleaks/gitleaks-action@v3` with `GITLEAKS_CONFIG=.gitleaks.toml` (scans the pushed or PR commit range) | Yes |
| `semgrep.yml` | container `returntocorp/semgrep`; `SEMGREP_RULES="p/typescript p/owasp-top-ten p/secrets p/javascript p/dockerfile" semgrep scan --sarif --output=semgrep.sarif --severity=ERROR --error --metrics=off` | Yes (ERROR only) |
| `supply-chain.yml` | Checkov (`framework: dockerfile,bicep`, `soft_fail: true`) and Trivy fs (`vuln,secret,misconfig`, `CRITICAL,HIGH`, `ignore-unfixed`, `exit-code: '0'`) | No (advisory) |
| `dependency-review.yml` | `actions/dependency-review-action` `fail-on-severity: high`, only when the Dependency graph is enabled | Yes when enabled |
| `lighthouse.yml` | `pnpm --filter @bidstack/shared build`, `pnpm --filter @bidstack/web build` (stub auth), `npm install -g @lhci/cli@0.14.x`, `lhci autorun` with `lighthouserc.json` | No (all assertions are `warn`) |
| `tsdoc-coverage.yml` | `node scripts/audit-tsdoc.mjs --json` on base and PR; fails if coverage drops more than 0.5 points | Yes on PRs touching TS paths |

### Running the gates locally

- Toolchain: `export PATH=~/.nvm/versions/node/v24.14.0/bin:$PATH` (system node is 22), then
  `corepack enable` once; `pnpm -v` must print `10.27.0`.
- Unit job: run the commands above from the repo root, in order.
- Integration and e2e: start your own containers on your own ports and override the URLs, so parallel
  agents never collide:
  `docker run -d --name f<n>-pg -e POSTGRES_USER=bidstack -e POSTGRES_PASSWORD=bidstack_test -e POSTGRES_DB=bidstack_test -p <pgport>:5432 pgvector/pgvector:pg16`
  and `docker run -d --name f<n>-redis -p <redisport>:6379 redis:7-alpine`, then export
  `DATABASE_URL=postgres://bidstack:bidstack_test@localhost:<pgport>/bidstack_test` and
  `REDIS_URL=redis://localhost:<redisport>`. Ports 4000 and 4174 are fixed by the web build and the
  playwright config; check `lsof -ti tcp:4000` first and stop only your own PIDs (never `pkill` by pattern).
- Gitleaks, PR-equivalent: `gitleaks detect --redact --no-banner --config .gitleaks.toml --log-opts="origin/main..HEAD"`.
- Semgrep: `docker run --rm -v "$PWD:/src" -w /src -e SEMGREP_RULES="p/typescript p/owasp-top-ten p/secrets p/javascript p/dockerfile" returntocorp/semgrep semgrep scan --severity=ERROR --error --metrics=off`.
- Trivy: `docker run --rm -v "$PWD:/src" aquasec/trivy:latest fs --scanners vuln,secret,misconfig --severity CRITICAL,HIGH --ignore-unfixed --skip-dirs node_modules,dist,build --exit-code 0 /src`.
- Lighthouse: build web with stub auth, then `CHROME_PATH=<playwright chromium> npx -y @lhci/cli@0.14.x autorun`.

## 3. Baseline on `main` (`ad2d0839`, run 2026-11-06 on macOS, Node 24.14.0, pnpm 10.27.0)

GitHub CI for the same SHA: CI (unit, secrets, integration, e2e smoke), E2E full (3 shards), Lighthouse,
Supply Chain, Semgrep and gitleaks are all **green**.

| Gate | Local result | Notes |
| --- | --- | --- |
| `pnpm install --frozen-lockfile` | PASS | |
| `pnpm audit --audit-level high` | PASS | Root `pnpm.auditConfig.ignoreGhsas` on `main` |
| `pnpm db:generate` | PASS | |
| `pnpm -r lint` | PASS | 34 s |
| `pnpm typecheck` | PASS | 50 s |
| Test no-DB, other packages | PASS | web 253 files / 1,100 tests; memos 8 |
| Test no-DB, worker | PASS | 61 files / 672 tests |
| Test no-DB, mcp-server | PASS | 34 passed, 24 skipped |
| Test no-DB, api | PASS | 91 files / 638 tests |
| `pnpm -r build` | PASS | |
| PWA manifest check | PASS | |
| Bundle size guard | PASS | |
| `scripts/check-secrets.sh --full` | PASS | |
| Integration: migrate + seed (pgvector pg16) | PASS | |
| Integration: `pnpm --filter @bidstack/api test` | PASS | 153 s |
| Integration: mcp-server, worker | PASS | |
| E2E smoke | **FAIL locally (1 of 8)** | `smoke.spec.ts:81` "enterprise readiness surfaces": `/settings?tab=audit-log` and `?tab=data-import` render the Overview tab locally. Passes in GitHub CI on the same SHA, so treat as local-environment only; re-check if it appears in CI. |
| E2E full, chromium-desktop | **FAIL locally: 250 passed, 26 failed, 36 skipped, 6 did not run** | 18 failures are `e2e/responsive/*` screenshot baselines (macOS rendering vs Linux baselines). 6 are the same settings `?tab=` deep-link symptom (`enterprise-readiness.spec.ts`, `flows/migration.spec.ts`, `smoke.spec.ts`). 1 is `core-web-vitals.spec.ts` leads CLS, 1 is `serum-account-experience.spec.ts:133`. CI is green, so none are regressions on `main`. |
| gitleaks, PR-equivalent range | PASS | `--log-opts="5dbb2bf4..HEAD"`: no leaks |
| gitleaks, full history | 14 historical hits | Rule ids only: `generic-api-key` and `hubspot-api-key`, mostly in test fixtures (2026-05 to 2026-07) plus `apps/polo-preview/wrangler.toml` (2026-11-01). Not a CI gate (CI scans the commit range). Triage `wrangler.toml` once; no values recorded here. |
| Semgrep (ERROR) | PASS | |
| Trivy fs (advisory) | 3 HIGH, 0 CRITICAL | `scratch_img/package-lock.json` (sharp 0.34.5, fix 0.35.0) and `apps/marketing/Dockerfile` DS-0002 (no non-root USER). Advisory only. |
| Lighthouse (warn-only) | PASS | `lhci autorun` rc 0, 197s, 3 runs each. `/login`: perf 98, a11y 100, best practices 96, SEO 91. `/dashboard`: perf 99, a11y 100, best practices 96, SEO 91. |
| TSDoc coverage | 9.5% overall | Gate is "no regression over 0.5 points" |
| Checkov, dependency-review | Not run locally | Checkov is `soft_fail`; dependency-review needs the GitHub PR context |

Slice agents: a gate counts as green when it is green in GitHub CI. Locally, compare against this table
and only investigate failures that are not listed here.

## 4. Existing surfaces (upgrade these, do not duplicate)

### Webhooks (outbound)

- Model: `packages/db/prisma/schema.prisma` `WebhookSubscription` (url, encrypted `secret`, `secretHash`,
  `events[]`, `active`, `failureCount`, `lastDeliveryAt`, `lastFailureAt`, soft delete) and
  `WebhookDelivery` (one row per attempt: event, statusCode, success, durationMs, attempt 1 to 5,
  errorMessage). **No payload, request headers or response body are stored.**
- API routes: `apps/api/src/routes/webhook-subscriptions.ts`: list, create, patch, delete
  (`webhooks:read` / `webhooks:write` + human actor), `GET /webhook-subscriptions/:id/deliveries`,
  `POST /webhook-subscriptions/:id/test`.
- Producer (API): `apps/api/src/queues/webhook-delivery.ts` `fanOutWebhookEvent` (fail-open; does not
  stamp `eventId`/`eventTimestamp`). A second producer lives in the worker
  (`apps/worker/src/queues/webhook-delivery.ts` `fanOutWebhookEvent`, stamps them). Two code paths.
- Consumer: `apps/worker/src/queues/webhook-delivery.ts` (BullMQ, concurrency 20, 10 s timeout,
  DNS-rebind-safe fetch, `assertSafeWebhookUrl`, HMAC-SHA256 `X-Polo-Signature: t=<s>,v1=<hex>` plus legacy
  `X-BidStack-Signature`, stable event id across retries, auto-disable after 10 failures,
  `UnrecoverableError` on decrypt failure, SERUM connector policy check).
- Retry config: `packages/shared/src/queue-config.integrations.ts` `WEBHOOK_DELIVERY`: 5 attempts,
  exponential 30 s base (about 30 s, 60 s, 120 s, 240 s), completed jobs kept 7 days, failed 30 days. The
  worker header comment claims "+2 min, +15 min, +1 h", which does not match the config.
- Shared helpers: `packages/shared/src/utils/ssrf.ts`, `webhook-url.ts`, `crypto.ts`,
  `packages/shared/src/server/safe-outbound-fetch.ts`, `packages/shared/src/crypto/token-cipher.ts`.
- Evidence scripts: `scripts/encrypt-webhook-secrets.ts`, `scripts/write-webhook-secret-ciphertext-evidence.mjs`.
- Inbound webhooks (signature-verified receivers): `apps/api/src/routes/webhooks.ts` (Dust),
  `webhooks-clerk.ts`, `routes/integrations/*` (Twilio, Slack, Zapier, Microsoft, calls).
- Web: `apps/web/src/components/settings/WebhooksSection.tsx`, `components/webhooks/CreateWebhookDialog.tsx`,
  `DeliveryHistoryPanel.tsx`, `SignatureGuide.tsx`, `hooks/useWebhookSubscriptions.ts`,
  `pages/integrations/WebhookEventsCard.tsx`.
- Missing for slice 4: delivery heatmap / success-rate, stored message plus replay, per-endpoint retry
  schedule, `Retry-After` handling, no-retry on non-retryable 4xx, dead-letter view, response-time histogram.

### RBAC and policies

- Matrix: `packages/shared/src/types/rbac-matrix.ts` (6 system roles), keys in `permissions.ts`
  (66 `resource:read|write` keys). Seeded by `packages/db/src/seed.rbac.ts`.
- Runtime: DB tables `Role`, `Permission`, `RolePermission`, `UserRole`; `apps/api/src/plugins/rbac.ts`
  (`requirePermission`, `requireRole`, `requireHumanActor`, `hasPermission`), cache
  `apps/api/src/lib/rbac-decision-cache.ts` (bounded LRU, explicit invalidation), API key scopes
  `apps/api/src/lib/api-key-scopes.ts`, ADR `docs/adr/0001-rbac-no-claim-fallback.md`.
- Routes: `apps/api/src/routes/roles.ts` (admin), `apps/api/src/routes/users.ts` (role assignment). About 632 route registrations,
  339 `requirePermission(` call sites.
- Web: `apps/web/src/pages/RolesPage.tsx`, `components/settings/RolesSection.tsx`, `UserRolesManager.tsx`.
- Doc: `production-readiness/AUTHORIZATION_MATRIX.md`.
- Missing for slice 5: no policy layer (no conditions, exceptions, versions, simulation or impact preview).

### Approvals

- `ApprovalGate` model (opportunity / bid document gates with status, approver, decision notes).
  API: `apps/api/src/routes/bid-workspace.ts`, `bid-workspace.helpers.ts`, `crews.ts`, `serum.ts`,
  `proposals.approval.ts`, `rfp-pipeline` approve. Web: `components/rfp/draft/DraftApprovalGate.tsx`,
  `components/bid/BidGovernancePanel.tsx`, `components/settings/StageGateSection.tsx`,
  `SerumControlPlaneSection.tsx`.
- Missing: one cross-cutting approvals queue.

### Audit

- `AuditLog` model (BigInt id, org, user, action, target, diff JSON, soft delete; indexes for keyset
  paging). App-layer insert-only guard: `packages/db/src/middleware/audit-immutability.ts` (blocks
  update/delete/upsert; retention purge uses `$executeRaw`). Writers: `apps/api/src/plugins/mutation-audit.ts`,
  `auth-audit.ts`, explicit `auditLog.create` in routes. Read: `apps/api/src/routes/audit-logs.ts`
  (`audit-log:read`, id-keyset cursor). Retention: `apps/worker/src/queues/ai-audit-retention.ts`.
- Web: `apps/web/src/pages/audit-log/*` (hero, filters, insights, table, export),
  `components/settings/AuditLogSection.tsx`.
- Missing for slice 6: hash chain, DB-level trigger / `REVOKE UPDATE, DELETE`.

### Other enterprise plumbing already present

- Idempotency keys: `apps/api/src/plugins/idempotency.ts`. Rate limit: `@fastify/rate-limit` in
  `apps/api/src/server.ts` (Redis-backed when available). Query guard: `plugins/query-guard.ts`.
  Cursor pager: `apps/web/src/components/ui/CursorPager.tsx`; keyset on audit logs.
- Tenancy: `packages/db/src/middleware/tenant-scope-guard.ts` (`BIDSTACK_TENANT_SCOPE_GUARD=warn|enforce`),
  `apps/api/src/lib/tenant-ownership.ts`. No Postgres RLS (0 `CREATE POLICY` in 107 migrations).
- Privacy: PII field encryption `packages/db/src/middleware/pii-encryption.ts` (Contact, Lead,
  KamConsultant email/phone), tenant export `apps/api/src/routes/tenant-export.ts` + worker
  `queues/tenant-export.ts` + `apps/worker/src/lib/tenant-export-registry.ts`, erasure
  `apps/api/src/routes/erasure.ts`.
- Queue: BullMQ 5 everywhere (`bullmq` in api, worker, root). Queue configs in
  `packages/shared/src/queue-config*.ts`.
- Backups: `scripts/backup-postgres.sh`, `restore-postgres.sh`, `backup-restore-selftest.sh`;
  safe migrate `scripts/run-safe-migrate-deploy.mjs`; load test `scripts/run-k6-load-test.mjs`.

## 5. Enterprise gaps vs `production-readiness/` (docs dated 2026-06-28 to 2026-07-02)

Status checked against code on `main` `ad2d0839`. "Stale" means the doc statement no longer matches the code.

| Item (source) | Status today | Slice |
| --- | --- | --- |
| B1 PII backfill on release DB (GAP_AUDIT, REMAINING) | Open, ops. Code present | 7 (evidence) |
| B2 production backup + PITR | Open, cloud. Backup scripts now exist on `main` (`db:backup`, `db:restore`), so "0 hits for pg_dump" is **stale** | 7 |
| H1 webhook secret backfill | Open, ops | 4 (evidence) |
| Tenant isolation: no RLS (D2 ADR) | Open. Guard exists, still 0 RLS policies | 6 |
| 4 models with plaintext PII outside `PII_MAP` (SmsMessage, SmsConsent, ActivityAttendee, CalendarEvent) | Open, still only contact, lead, kamconsultant in `PII_MAP` | 7 |
| "CI triggers on `main` but integration branch is `demo`; added `demo`" | **Stale**. `main` is now the integration branch; CI on `main` triggers on `main` only | n/a |
| "CI migrate ran on postgres:16-alpine" | **Stale / fixed**. ci.yml and e2e.yml use `pgvector/pgvector:pg16` | n/a |
| "No gated CD; `deploy.workflow.yml.draft`" | **Stale**. `deploy.yml` is live (waits for CI + E2E green on the SHA). Environment reviewers and secrets still a GitHub UI task | n/a |
| Container image CVE scan + SBOM | Present in `deploy.yml` (Trivy + SBOM) | n/a |
| Coverage thresholds are dead config | Still true: `vitest run` without `--coverage` in CI | 6 |
| Cross-tenant IDOR tests cover Opportunity only | Partly addressed (IntegrationToken, ERP, analytics tests added 2026-07); no generated per-route authZ test | 6 |
| Audit log tamper evidence | App-layer guard only; no hash chain, no DB trigger | 6 |
| Webhook outbox | Missing: enqueue happens after commit and is fail-open | 6 |
| Load / soak run (H4), SLOs (D4) | Open, ops | 6 to 7 |
| Live infra / IAM / TLS (H2), Sentry trigger (H7), 10x green CI (H8) | Open, ops | 7 |
| `User.email` plaintext (D1), plaintext sign-off (D3), legal sign-off (D6) | Open, decisions for Tony | 7 |
| Half-wired UI flows (calendar edit, report schedule, Lead Kanban, pipeline cap 50) | Not re-verified in this recon | later |

## 6. Notes for slice agents

- Do not name the commercial app used as visual inspiration anywhere (code, docs, PRs, commits).
- Copy rules and the pinned consent list are in `DESIGN.md` (section "v3.0.0 (2026-11-06)").
- Prior-art decisions are in `docs/factory/PRIOR-ART.md`.
- PR bodies must stay under 4,000 characters; read them back after saving.
