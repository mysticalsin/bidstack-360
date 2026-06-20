# Deploy evidence hard gate

## Problem

The pre-deploy checklist could pass code health gates while the actual release
candidate still lacked fresh production-grade proof for load, SAST, container
vulnerabilities, secret-history disposition, Sentry smoke monitoring,
source-control provenance, operational readiness, and cross-role browser
regression.

For a 100k-user company rollout, "tests/build passed" is not enough. The deploy
candidate must carry current evidence that the shipped image, live target, and
monitoring path are ready, and that role-specific browser behavior was checked
against the release target.

## Pattern

Use `pnpm deploy:evidence:staging` or `pnpm deploy:evidence:production` before a
strict deploy. The verifier is cross-platform Node and is also called by
`scripts/ops/deploy-checklist.sh`.

Strict deploy targets fail closed when any proof is missing, stale, weak, or
points at local infrastructure.

For the normal release flow, use the bundle runner first:

```powershell
pnpm deploy:evidence:bundle:staging
pnpm deploy:evidence:bundle:production
```

Before spending time on live provider, Sentry, load, and browser evidence, run
the standalone preflight. It writes
`deploy-evidence/release-preflight-latest.json` and checks that the required
release targets, tokens, company key, operational approval, backup/restore,
rollback, secret disposition fields, Sentry projects, and Clerk browser
settings are present. Passing preflight is not deploy approval; it only proves
the release runner has enough inputs to start the evidence commands.

Start from `docs/templates/release-evidence.env.example` when preparing a
staging or production evidence run. Fill the values in a CI secret store or an
ignored local file such as `deploy-evidence/release-evidence.env`; never commit
the filled file. The template intentionally covers the live provider,
operational, load/Sentry/browser, and security-disposition inputs that the
bundle preflight checks.

```powershell
pnpm deploy:evidence:preflight:staging
pnpm deploy:evidence:preflight:production
```

The bundle runner executes the evidence commands in release order, writes
`deploy-evidence/release-evidence-bundle-latest.json`, redacts secret-like
output, and always finishes with the strict staging or production verifier. It
does not weaken the final gate. If preflight has blockers, normal bundle
execution fails fast and marks every evidence step as skipped for
`preflight blockers`; no tool/source/ops/provider/load commands are spawned. Use
`--continue-on-error` only when you intentionally want diagnostic evidence
despite missing release inputs. If source-control evidence fails after preflight
is clean, the bundle still writes the source review cleanup plan before
skipping later live evidence. If another command fails, later evidence
generation is skipped unless `--continue-on-error` is set, then the final
verifier still runs so the release record shows the authoritative blockers.

Dry-run the exact command plan and preflight without executing evidence tools:

```powershell
pnpm deploy:evidence:bundle:production -- --dry-run
```

Dry-run artifacts intentionally fail with `bundle.dry_run`; they are planning
proof, not deploy approval.

Preflight-only artifacts intentionally skip evidence commands. They pass only
when environment/input checks pass, and the printed output reminds operators
that evidence commands still need to run before deploy approval.

The default `deploy-evidence/` folder is gitignored because scanner output and
release smoke metadata belong in CI artifacts or the release record, not in
source control.

Default max evidence age is 24 hours. Override only for an explicit release
exception:

```powershell
$env:BIDSTACK_DEPLOY_EVIDENCE_MAX_AGE_HOURS='48'
pnpm deploy:evidence:production
```

## Required Artifacts

### Release tool readiness

Default path: `deploy-evidence/tool-readiness-latest.json`

Run this first on the release runner:

```powershell
pnpm deploy:evidence:tools
```

Strict requirements:

- Node major version is `24`
- pnpm major version is `10`
- Git, Bash, Docker CLI, and Docker daemon are available
- Sentry CLI is available for smoke evidence queries
- Playwright CLI is available for cross-role browser evidence
- k6 can run locally or through the Docker fallback
- Gitleaks can run locally or through the Docker fallback
- Semgrep and Trivy Docker runners can execute later evidence commands
- Docker fallback images execute when a release tool depends on Docker
- required evidence scripts and `.gitleaks.toml` exist

For lightweight local inventory without image pulls, run the writer directly.
Strict staging/production verification rejects that artifact if Docker-dependent
tools lack executed image probes.

```powershell
node scripts/write-release-tool-readiness.mjs
```

### Source-control provenance

Default path: `deploy-evidence/source-control-latest.json`

Run this before live evidence generation:

```powershell
pnpm deploy:evidence:source
```

The writer records the current Git branch, full commit SHA, commit timestamp,
upstream tracking branch, ahead/behind counts, and a bounded status summary. It
writes an artifact even when the tree is dirty, but the artifact fails release
validation so the strict verifier has an explicit source-control blocker.

Dirty-tree artifacts also include a review-oriented `sourceReview` section:
status-kind counts, path group counts, risk bucket counts, truncation metadata,
and small file samples. This keeps a large dirty worktree actionable without
printing file contents or weakening the clean-worktree release requirement.
Use the buckets to plan review/commit cleanup; do not use them as an exception
to the clean-source gate.

Keep generated local scratch out of Git status before running source evidence.
Local Forge run state and screenshots live under `.forge/`, and temporary i18n
sweep batch files use `apps/web/scripts/_i18n_*`; both are ignored because they
are release-runner artifacts, not source inputs. The canonical i18n coverage
script remains tracked as `apps/web/scripts/i18n-coverage.mts`.

For a large dirty tree, generate the non-destructive cleanup plan after source
evidence. The direct command intentionally exits non-zero while active cleanup
waves exist:

```powershell
pnpm deploy:evidence:source
pnpm deploy:evidence:source:plan
```

The normal bundle path runs the write-only diagnostic variant automatically
after a source-control failure:

```powershell
pnpm deploy:evidence:source:plan:write
```

`deploy-evidence/source-review-plan-latest.json` turns the source artifact into
priority waves: release-critical config/secrets, security/access, runtime code,
frontend UX, docs/runbooks, and uncategorized/local coordination files. The
waves include exact path-only file manifests, review notes, small samples, and
suggested verification commands. The write-only diagnostic mode may return
success so the bundle can continue to the final verifier, but the plan is
deliberately not a release artifact that can pass deployment; it is a cleanup
aid before
`pnpm deploy:evidence:source` can pass.

Strict requirements:

- fresh artifact at `deploy-evidence/source-control-latest.json`
- full 40-character release commit SHA is recorded
- release branch has an upstream tracking branch
- release branch has zero ahead/behind drift from upstream
- Git worktree is clean
- no tracked modifications
- no staged-but-uncommitted files
- no untracked files
- no tracked local agent worktrees under `.claude/worktrees/`

The writer also checks the Git index directly for `.claude/worktrees/` entries.
This catches the clean-but-bad case where a local agent workspace was committed
as a gitlink without a `.gitmodules` mapping. Those directories may exist on a
developer machine, but release source must not track them.

### Operational readiness

Default path: `deploy-evidence/operational-readiness-latest.json`

Generate this after platform/ops has reviewed the release infrastructure plan,
migration path, backup/restore proof, rollback drill, monitoring alerts, and
on-call escalation. Prefer a reviewed JSON file based on
`docs/templates/operational-readiness.example.json`:

```powershell
$env:BIDSTACK_OPS_READINESS_FILE='deploy-evidence/operational-readiness.json'
pnpm deploy:evidence:ops
```

The writer accepts either the file shape above or explicit `BIDSTACK_OPS_*`
environment variables, then writes a compact artifact for the strict verifier.
Template/example values are intentionally rejected by bundle preflight and the
strict gate.

Strict requirements:

- fresh artifact at `deploy-evidence/operational-readiness-latest.json`
- environment matches the deploy target
- non-placeholder release id is recorded
- named reviewer, approver, approval ticket/reference, and ISO approval
  timestamp are recorded
- Azure/Bicep build and what-if/plan are validated
- private networking posture is approved
- object storage driver is validated
- migration job and migration deploy path are validated
- database backups are configured
- backup retention is at least 30 days
- geo-redundant backup is enabled or explicitly approved
- restore drill has an ISO timestamp
- restore RTO is at most 240 minutes
- restore RPO is at most 60 minutes
- rollback runbook is reviewed
- rollback drill has an ISO timestamp
- monitoring alerts and on-call escalation are validated

### Provider source quality

Default path: `deploy-evidence/provider-quality-latest.json`

Generate this against the staging or production API after Apollo, Seamless, and
Tech Intel MCP credentials are configured for the release account:

```powershell
$env:API_BASE_URL='https://<staging-or-production-api>'
$env:API_TOKEN='<short-lived bearer token>'
$env:BIDSTACK_PROVIDER_QUALITY_COMPANY_KEY='<company-key-with-live-provider-data>'
$env:BIDSTACK_PROVIDER_QUALITY_TECH_INTEL_SOURCES='BuiltWith MCP,Wappalyzer MCP'
pnpm deploy:evidence:providers
```

The writer calls
`POST /api/v1/crm/companies/:companyKey/technical-stack/refresh`, records the
provider lanes returned by the API, counts attributed stack signals, and writes
a compact release artifact. The API token is never written to the artifact.

Strict requirements:

- fresh artifact at `deploy-evidence/provider-quality-latest.json`
- non-local API target
- live refresh command succeeded
- company key is recorded
- Apollo lane is queued for async enrichment or synced with source signals
- Apollo transport is `mcp`, `api`, or `queue`
- Seamless lane is synced through `mcp` or `api` and returns at least one
  technology signal
- Tech Intel lane is synced through `mcp` and returns at least one technology
  signal
- when `BIDSTACK_PROVIDER_QUALITY_TECH_INTEL_SOURCES` or
  `BIDSTACK_DEPLOY_REQUIRED_TECH_INTEL_SOURCES` is set, each named Tech Intel
  MCP source is observed in the artifact
- the refresh response includes all required lanes: `apollo`, `seamless`,
  `tech_intel`

BuiltWith, Wappalyzer, private enrichers, or another valid source should flow
through the generic Tech Intel MCP lane until they have first-class credentials,
rate limits, failure semantics, and tests.

### Load certification

Default path: `load-test-report/production-load-latest.json`

Generate against staging or production API with authenticated routes enabled:

```powershell
$env:BIDSTACK_DEPLOY_ENV='staging' # or production
$env:API_BASE_URL='https://<staging-or-production-api>'
$env:API_TOKEN='<short-lived bearer token>'
pnpm deploy:evidence:load
```

Strict requirements:

- `passed: true`
- `profile: "certification"`
- `strictEvidence: true`
- `environment` matches `BIDSTACK_DEPLOY_ENV`
- `authenticatedRoutes: true`
- non-local `target`
- raw k6 summary proof exists at `rawSummaryPath` and `rawSummaryFound: true`
- all k6 thresholds pass
- core k6 metrics are present: checks rate, HTTP failure rate, p95 latency,
  request count, and max VUs

`pnpm load-test` and `pnpm load-test:certify` remain useful local/dev
regressions. Use `pnpm deploy:evidence:load` for release proof because it
fails before k6 starts when the target is local, invalid, not certification
profile, health-only, missing `API_TOKEN`, or missing
`BIDSTACK_DEPLOY_ENV=staging|production`.

### Semgrep SAST

Default path: `deploy-evidence/semgrep-latest.json`

```powershell
pnpm deploy:evidence:semgrep
```

Strict requirements:

- valid Semgrep JSON with scanner metadata; compact summaries are not release proof
- pinned `semgrep/semgrep:<version>` Docker image recorded
- scan configs and blocking severities recorded
- scanned source coverage recorded with a positive mirrored-file count
- command exit code is `0`
- raw `results` and `errors` arrays are preserved
- Dockerfile syntax check passed when the release scan covers the Dockerfile
- no `ERROR`, `CRITICAL`, or `HIGH` blocking findings
- no scanner errors

### Container vulnerability scan

Default path: `deploy-evidence/container-scan-latest.json`

```powershell
$env:BIDSTACK_DEPLOY_ENV='staging' # or production
$env:BIDSTACK_CONTAINER_SCAN_IMAGES='registry.example.com/bidcrm-api@sha256:<digest>,registry.example.com/bidcrm-web@sha256:<digest>,registry.example.com/bidcrm-worker@sha256:<digest>'
$env:BIDSTACK_DEPLOY_REQUIRED_IMAGES=$env:BIDSTACK_CONTAINER_SCAN_IMAGES
pnpm deploy:evidence:container
```

Strict requirements:

- `strictEvidence: true`
- `environment` matches `BIDSTACK_DEPLOY_ENV`
- scanned image refs are immutable digest refs: `registry/image@sha256:<digest>`
- every required deploy image is present in the report
- every image points to a repo-local, parseable raw Trivy JSON report
- every image has zero fixed `CRITICAL`/`HIGH` vulnerabilities

Local development defaults for `pnpm container:scan`:

- `bidcrm-api:root-api-user-probe`
- `bidcrm-web:root-web-probe`
- `bidcrm-worker:root-current-osd`
- `bidcrm-mcp:root-mcp-user-probe`
- `bidcrm-migrate:nonroot-probe`

Those local mutable tags are useful for container hardening, but they are not
production release evidence. Override the required image set to the exact
immutable image refs used by the deploy plan:

```powershell
$env:BIDSTACK_DEPLOY_REQUIRED_IMAGES=$env:BIDSTACK_CONTAINER_SCAN_IMAGES
pnpm deploy:evidence:production
```

### Secret-history disposition

Default path: `deploy-evidence/secret-scan-latest.json`

Use the evidence writer for the provable pieces. It runs the tracked tree
secret scanner, scans untracked files with the same secret regex family, runs a
current-commit gitleaks snapshot, and writes the compact deploy artifact:

```powershell
New-Item -ItemType Directory -Force deploy-evidence
$env:BIDSTACK_SECRET_FULL_HISTORY_REVIEWED='true'
$env:BIDSTACK_SECRET_HISTORICAL_FINDINGS_COUNT='11'
$env:BIDSTACK_SECRET_HISTORICAL_ROTATED='true'
$env:BIDSTACK_SECRET_OWNER_APPROVED='true'
$env:BIDSTACK_SECRET_OWNER_APPROVER='security-owner@example.com'
$env:BIDSTACK_SECRET_OWNER_APPROVAL_TICKET='SEC-1234'
$env:BIDSTACK_SECRET_OWNER_APPROVED_AT='2026-06-18T10:00:00.000Z'
$env:BIDSTACK_SECRET_ROTATION_VERIFIED_AT='2026-06-18T09:30:00.000Z'
$env:BIDSTACK_SECRET_REVIEWER='security-owner@example.com'
pnpm deploy:evidence:secrets
```

Preferred release path: use a reviewed JSON disposition file instead of
hand-assembling approval flags. Copy
`docs/templates/secret-history-disposition.example.json`, fill it with the
security owner's ticket/reference and timestamps, then run:

```powershell
$env:BIDSTACK_SECRET_DISPOSITION_FILE='deploy-evidence/secret-history-disposition.json'
pnpm deploy:evidence:secrets
```

The bundle preflight also reads `BIDSTACK_SECRET_DISPOSITION_FILE`, so the full
`pnpm deploy:evidence:bundle:staging` path can pass preflight with the same
audited disposition file. The bundle preflight and secret evidence writer accept
UTF-8 JSON files with or without a BOM, so PowerShell-created disposition files
work on Windows release runners.

The writer is release-runner friendly: it first tries native `gitleaks` and,
when the binary is unavailable, automatically falls back to the pinned
Dockerized scanner `ghcr.io/gitleaks/gitleaks:v8.30.1`. Override only when the
release image policy requires it:

```powershell
$env:BIDSTACK_GITLEAKS_MODE='docker' # auto | native | docker
$env:BIDSTACK_GITLEAKS_IMAGE='ghcr.io/gitleaks/gitleaks:v8.30.1'
$env:GITLEAKS_BIN='C:\tools\gitleaks.exe'
pnpm deploy:evidence:secrets
```

If you want the writer to run full-history gitleaks and count findings directly,
add:

```powershell
$env:BIDSTACK_SECRET_RUN_FULL_HISTORY='true'
pnpm deploy:evidence:secrets
```

The rotation and owner approval fields are still intentionally explicit because
code cannot prove that historical credentials were revoked or that the security
owner accepted the disposition. Use the local gates from
`docs/solutions/security-scan-local-gates.md`, rotate/revoke any historical
credentials, record the security owner approver, approval ticket/reference,
owner approval timestamp, and rotation verification timestamp, and only then set
those fields.

The resulting artifact looks like:

```json
{
  "generatedAt": "2026-06-17T18:00:00.000Z",
  "currentTreeClean": true,
  "trackedTreeClean": true,
  "untrackedSecretScanClean": true,
  "currentCommitGitleaksClean": true,
  "fullHistoryReviewed": true,
  "historicalFindingsCount": 11,
  "historicalFindingsRotatedOrRevoked": true,
  "ownerApprovedDisposition": true,
  "ownerApprover": "security-owner@example.com",
  "ownerApprovalTicket": "SEC-1234",
  "ownerApprovedAt": "2026-06-18T10:00:00.000Z",
  "rotationVerifiedAt": "2026-06-18T09:30:00.000Z",
  "dispositionSource": "file",
  "reviewer": "security-owner@example.com"
}
```

If full git history has no findings, set `"fullHistoryClean": true` or
`"historicalFindingsCount": 0`.

Strict requirements:

- current tracked tree secret scan passes
- current untracked source-file secret scan passes
- current commit gitleaks snapshot passes
- full git history is reviewed
- any historical findings are rotated or revoked
- owner-approved disposition is recorded
- named owner approver is recorded when historical findings exist
- owner approval ticket or reference is recorded when historical findings exist
- ISO `ownerApprovedAt` timestamp is recorded when historical findings exist
- ISO `rotationVerifiedAt` timestamp is recorded when historical findings exist
- named reviewer is recorded

### Sentry smoke proof

Default path: `deploy-evidence/sentry-smoke-latest.json`

Create this after staging or production has real `SENTRY_DSN`,
`SENTRY_ENVIRONMENT`, and `SENTRY_RELEASE`, and after observing a controlled API
5xx event plus a controlled worker failure event in Sentry. Use unique smoke
markers so the release gate cannot pass on unrelated production errors:

- API marker: `bidstack-api-sentry-smoke`
- Worker marker: `bidstack-worker-sentry-smoke`

Trigger the smoke events from the release target and then query Sentry through
the CLI. The API smoke route intentionally returns HTTP 500 so the central error
handler captures the event. The worker smoke route queues a job that fails
inside the real BullMQ worker so the worker `failed` listener reports it.

Use the trigger-capable writer for the normal release flow:

```powershell
$env:API_BASE_URL='https://<staging-or-production-api>'
$env:SENTRY_SMOKE_TOKEN='<release-smoke-token>'
$env:SENTRY_RELEASE='bidstack@0.1.0+abc123'
$env:SENTRY_ENVIRONMENT='staging'
$env:BIDSTACK_SENTRY_ORG='<sentry-org-slug>'
$env:BIDSTACK_SENTRY_API_PROJECT='bidstack-api'
$env:BIDSTACK_SENTRY_WORKER_PROJECT='bidstack-worker'
$env:BIDSTACK_SENTRY_DSN_CONFIGURED='true'
pnpm deploy:evidence:sentry:trigger -- --observe-delay-ms 30000
```

The API must be deployed with `SENTRY_SMOKE_ENABLED=true` and
`SENTRY_SMOKE_TOKEN` set to a release-only secret of at least 24 characters.
Keep the flag off outside release evidence windows. The writer sends the token
only as `x-bidstack-sentry-smoke-token`; it is not written to the evidence
artifact.

Override the default issue queries only when the smoke event uses a different
marker or project taxonomy:

```powershell
$env:BIDSTACK_SENTRY_API_QUERY='release:"bidstack@0.1.0+abc123" environment:staging level:error *api-smoke-marker*'
$env:BIDSTACK_SENTRY_WORKER_QUERY='release:"bidstack@0.1.0+abc123" environment:staging level:error *worker-smoke-marker*'
pnpm deploy:evidence:sentry
```

If release ops already triggered both smoke events manually, use
`pnpm deploy:evidence:sentry` without `--trigger-smoke` to query and write the
compact artifact only. Keep `API_BASE_URL` or `BIDSTACK_SENTRY_API_BASE_URL`
set to the same non-local release API target so the artifact still records the
target that produced the smoke events.

The resulting artifact looks like:

```json
{
  "generatedAt": "2026-06-17T18:00:00.000Z",
  "environment": "staging",
  "triggerTarget": "https://<staging-or-production-api>",
  "dsnConfigured": true,
  "release": "bidstack@0.1.0+abc123",
  "api5xxSmokeObserved": true,
  "workerFailureObserved": true,
  "sendDefaultPii": false,
  "sessionReplayEnabled": false
}
```

If session replay is enabled, the artifact must also prove legal approval:

```json
{
  "sessionReplayEnabled": true,
  "legalApproval": true
}
```

Strict requirements:

- `SENTRY_DSN`, release, and environment are configured for the deploy target
- non-local Sentry smoke trigger target is recorded
- Sentry CLI query for the API smoke marker returns at least one issue
- Sentry CLI query for the worker smoke marker returns at least one issue
- privacy source proof is present or `sendDefaultPii: false`
- session replay is disabled, or legal approval is recorded

### Cross-role browser regression

Default path: `deploy-evidence/browser-regression-latest.json`

Run the release browser suite against the staging or production web app using
real Clerk-backed test accounts. The artifact is intentionally separate from
Playwright's raw report so release approval can quickly see which personas,
browsers, and specs were covered:

```powershell
New-Item -ItemType Directory -Force deploy-evidence
$env:E2E_API_URL='https://<staging-or-production-api>'
pnpm deploy:evidence:browser -- --target https://<staging-or-production-web> --auth-mode clerk --production-build
pnpm deploy:evidence:staging
```

`pnpm deploy:evidence:browser` runs Playwright with JSON output, writes the raw
report to `deploy-evidence/playwright-browser-regression.json`, then parses that
report to derive covered personas, browser projects, specs, and test counts from
the actual run. Pipelines that already generated a report can use
`pnpm deploy:evidence:browser:write -- --report <path> ...`.

The writer fails strict evidence generation for local targets, stub auth,
missing required personas, missing required browser projects/specs, command
failures, failed tests, flaky/unexpected Playwright status, or
non-production-build evidence.

```json
{
  "generatedAt": "2026-06-17T18:45:00.000Z",
  "environment": "staging",
  "profile": "cross-role-regression",
  "target": "https://<staging-or-production-web>",
  "productionBuild": true,
  "clerkBackedAuth": true,
  "commandExitCode": 0,
  "passed": true,
  "roles": ["admin", "manager", "read-only", "viewer"],
  "projects": ["chromium-desktop", "firefox-desktop", "webkit-desktop"],
  "specs": ["e2e/flows/rbac.spec.ts"],
  "tests": { "passed": 18, "failed": 0, "unknown": 0, "skipped": 2 },
  "sourceReport": "deploy-evidence/playwright-browser-regression.json",
  "playwrightCommand": "pnpm --filter @bidstack/web exec playwright test e2e/flows/rbac.spec.ts ..."
}
```

Strict requirements:

- `passed: true`
- `commandExitCode: 0`
- `profile: "cross-role-regression"` or `"release-regression"`
- non-local `target`
- `productionBuild: true`
- Clerk-backed auth via `clerkBackedAuth: true` or `authMode: "clerk"`
- required personas: `admin`, `manager`, `read-only`, `viewer`
- required browser projects: `chromium-desktop`, `firefox-desktop`,
  `webkit-desktop`
- required spec coverage: `e2e/flows/rbac.spec.ts`
- a raw Playwright JSON `sourceReport` exists inside the repo
- a recorded `playwrightCommand` shows the Playwright test invocation
- zero failed or unknown tests and at least one passing test

Override required roles/projects/specs only when the release evidence plan
explicitly changes:

```powershell
$env:BIDSTACK_DEPLOY_REQUIRED_BROWSER_ROLES='admin,manager,read-only,viewer'
$env:BIDSTACK_DEPLOY_REQUIRED_BROWSER_PROJECTS='chromium-desktop,firefox-desktop,webkit-desktop'
$env:BIDSTACK_DEPLOY_REQUIRED_BROWSER_SPECS='e2e/flows/rbac.spec.ts'
pnpm deploy:evidence:staging
```

## Verification

Local verifier and evidence generation commands:

```powershell
pnpm deploy:evidence:selftest
pnpm deploy:evidence:bundle:selftest
pnpm deploy:evidence:preflight:production
pnpm deploy:evidence:bundle:production -- --dry-run
pnpm deploy:evidence:tools:selftest
pnpm deploy:evidence:tools
pnpm deploy:evidence:source:selftest
pnpm deploy:evidence:source
pnpm deploy:evidence:source:plan:selftest
pnpm deploy:evidence:source:plan
pnpm deploy:evidence:source:plan:write
pnpm deploy:evidence:ops:selftest
pnpm deploy:evidence:ops
pnpm deploy:evidence:azure:policy:selftest
pnpm deploy:evidence:azure:policy
pnpm deploy:evidence:providers:selftest
pnpm deploy:evidence:providers
pnpm deploy:evidence:semgrep
pnpm deploy:evidence:container
pnpm deploy:evidence:browser:selftest
pnpm deploy:evidence:secrets:selftest
pnpm deploy:evidence:sentry:selftest
```

Current local proof on 2026-06-17:

- `pnpm deploy:evidence:tools` produced a fresh passing tool-readiness artifact
  with Node 24, pnpm 10, Git, Bash, Docker, Sentry CLI, Playwright, k6 Docker
  fallback, Gitleaks Docker fallback, Semgrep Docker runner, and Trivy Docker
  runner available.
- `pnpm deploy:evidence:secrets` reached Dockerized Gitleaks and produced a
  current-tree/current-commit clean artifact. It still correctly failed because
  historical findings need a security-owner approval field; do not set
  `BIDSTACK_SECRET_OWNER_APPROVED=true` until rotation or revocation has been
  completed and accepted.

Current local proof on 2026-06-18:

- `node --check scripts/write-source-control-evidence.mjs`: pass.
- `node --check scripts/write-secret-scan-evidence.mjs`: pass.
- `node --check scripts/verify-deploy-evidence.mjs`: pass.
- `node --check scripts/run-deploy-evidence-bundle.mjs`: pass.
- `pnpm deploy:evidence:source:selftest`: pass.
- `pnpm deploy:evidence:secrets:selftest`: pass, including disposition-file,
  owner-ticket, owner-approval timestamp, and rotation-timestamp fixtures.
- `pnpm deploy:evidence:selftest`: pass.
- `pnpm deploy:evidence:bundle:selftest` passed.
- `pnpm deploy:evidence:source` on the current local worktree writes
  `deploy-evidence/source-control-latest.json` and correctly fails because the
  worktree is dirty. The branch does have an upstream (`origin/demo`) and is
  synced (`ahead=0`, `behind=0`). The source artifact now expands untracked
  directories with `git status -uall` and includes `sourceReview` buckets so the
  cleanup can be reviewed by area and risk. Generated `.forge/` and temporary
  `_i18n_*` sweep files are ignored, reducing local source evidence noise from
  373 dirty entries to 363 while keeping actual source/docs changes blocked.
- `pnpm deploy:evidence:source:plan` on the same artifact writes
  `deploy-evidence/source-review-plan-latest.json` and correctly fails because
  cleanup waves are active. The source artifact now includes a full path-only
  `statusManifest`, and the plan attaches exact file lists to each wave. Current
  waves: release-critical P0, security/access P0, runtime P1, frontend UX P1,
  docs P2, uncategorized P2.
- `pnpm deploy:evidence:bundle:production -- --dry-run` wrote
  `deploy-evidence/release-evidence-bundle-latest.json`, listed the twelve
  release evidence commands, and correctly marked the artifact as blocked by
  preflight gaps plus `bundle.dry_run`.
- `pnpm deploy:evidence:tools` produced a fresh passing artifact with
  `scripts/run-deploy-evidence-bundle.mjs` and
  `scripts/write-source-control-evidence.mjs`,
  `scripts/verify-azure-infra-policy.mjs`, and the other evidence writers
  included in the required file proof.
- `pnpm deploy:evidence:bundle:production` correctly fails at
  `Source-control evidence`, writes `Source review cleanup plan` with active
  cleanup waves, skips later live evidence generation, then runs the strict
  verifier.
- `docs/templates/release-evidence.env.example` now provides the single
  placeholder-only input template for operational, Apollo/Seamless/Tech Intel
  provider, non-local load/Sentry/browser, Clerk-backed browser, and
  security-owner disposition inputs.
- `pnpm deploy:evidence:preflight:staging` now requires release-shaped values,
  not merely non-empty values. The bundle preflight rejects `.example` hosts,
  angle-bracket placeholders, known sample tokens, sample approval tickets, and
  `example.com` approver/reviewer emails.
- Placeholder probe on 2026-06-18 exited `1` and blocked:
  `load.apiBaseUrl`, `load.apiToken`, `providers.apiBaseUrl`,
  `providers.apiToken`, `providers.companyKey`,
  `providers.techIntelSources`, `secrets.ownerApprover`,
  `secrets.ownerApprovalTicket`, `secrets.reviewer`, `sentry.apiBaseUrl`,
  `sentry.smokeToken`, `sentry.release`, `sentry.org`, and `browser.target`.
- Non-placeholder release-shaped staging probe on 2026-06-18 exited `0` with
  zero preflight blockers. Evidence commands still need to run before deploy
  approval.
- Refreshed `deploy-evidence/release-preflight-latest.json` on 2026-06-18 with
  the current shell and no real staging secrets. It now correctly blocks
  (`exit=1`, 46 blockers) instead of preserving the old placeholder-green
  artifact.
- Full blocked production bundle probe on 2026-06-18 now fails fast before
  evidence execution: `exit=1`, 46 preflight blockers, all 12 planned steps
  skipped with `skipReason="preflight blockers"`, and blocking failures contain
  only `preflight.*` IDs.

Operational readiness and provider source quality are now part of the release
gate. The bundle runner requires platform/ops approval fields plus
`BIDSTACK_PROVIDER_QUALITY_COMPANY_KEY`, a non-local provider API target, token,
and required Tech Intel source labels before execution. The strict verifier
rejects missing, placeholder, stale, weak, or incomplete ops proof and missing,
fixture-only, local, weak, or incomplete Apollo/Seamless/Tech Intel source
evidence.

Current repo proof run on 2026-06-18 correctly passes release-tool readiness,
Semgrep, container scan evidence, current secret tree/current-commit proof, and
provider-tool wiring. It still blocks production because the worktree is dirty,
the available load artifact is a local `smoke` profile, historical secret
findings need owner disposition, live Apollo/Seamless/Tech Intel provider proof
has not been supplied, platform/ops readiness proof has not been supplied, and
live Sentry/browser evidence has not been supplied:

```text
FAIL Source-control evidence gate did not pass
PASS Source-control evidence has an upstream branch
PASS Release branch is synced with upstream
FAIL Git worktree must be clean for staging/production release evidence
FAIL Load profile must be certification for staging/production
FAIL Strict deploy evidence cannot target a local API
FAIL Historical credentials were rotated or revoked
FAIL Owner approved the history disposition
FAIL Secret history disposition needs a named owner approver
FAIL Secret history disposition needs an owner approval ticket or reference
FAIL Secret owner approval needs an ISO ownerApprovedAt timestamp
FAIL Historical secret rotation/revocation needs an ISO rotationVerifiedAt timestamp
FAIL Operational readiness artifact is missing
FAIL Provider source quality gate did not pass
FAIL Provider refresh command did not succeed
FAIL Strict deploy provider evidence cannot target a local API
FAIL Provider quality company key is missing
FAIL One or more required provider lanes failed quality checks
FAIL Provider refresh response is missing required lanes
FAIL Sentry smoke artifact is missing
FAIL Cross-role browser regression artifact is missing
```

That block is expected. The gate is working when it refuses to certify weak or
missing evidence.

## 2026-06-18: Placeholder Preflight Rejection

Preflight used to answer only "are all required environment fields present?"
That let a copied template look ready when values like
`https://staging-api.bidstack.example`, `<release-smoke-token-at-least-24-chars>`,
`security-owner@example.com`, and `SEC-123` were still in place.

The bundle runner now rejects placeholder evidence inputs before any command can
look green:

- URL checks still require absolute non-local HTTP(S) targets, and now also
  reject `.example` / `example.com` infrastructure.
- Token checks for load, provider quality, and Sentry smoke require minimum
  length and reject known placeholder strings.
- Secret-history approver, reviewer, and ticket fields reject template/sample
  values.
- Sentry release/org/project fields reject angle-bracket and example
  placeholders.

Verification:

- `node --check scripts/run-deploy-evidence-bundle.mjs`: pass.
- `pnpm deploy:evidence:bundle:selftest`: pass, including placeholder-blocking
  and release-shaped passing fixtures.
- Placeholder preflight probe: expected block, exit `1`, blocker list above.
- Non-placeholder preflight probe: pass, exit `0`, zero blockers.
- `pnpm deploy:evidence:preflight:staging` in the current shell: expected
  block, exit `1`, refreshed latest artifact with preflight blockers.
- `pnpm deploy:evidence:bundle:production -- --out <temp>` in the current
  shell: expected block, exit `1`, all planned steps skipped for preflight
  blockers and no non-preflight blocking IDs.
- `pnpm deploy:evidence:bundle:production` refreshed
  `deploy-evidence/release-evidence-bundle-latest.json`: expected block,
  exit `1`, 46 preflight blockers, 12 skipped steps, and only `preflight.*`
  blocking IDs.
- `pnpm exec eslint --no-ignore --no-warn-ignored scripts/run-deploy-evidence-bundle.mjs`:
  pass.
- `pnpm deploy:evidence:selftest`: pass.

## 2026-06-18: Source Review Plan Currency

The source review plan is a remediation artifact for dirty source, so it must
be tied to the exact source-control snapshot it explains. A stale plan is worse
than no plan: it can tell reviewers to inspect the wrong files after a long
multi-slice build.

`scripts/write-source-review-plan.mjs` now compares the source-control
artifact's commit, branch, upstream, and full `statusManifest` against the
current Git worktree before it allows active cleanup waves. If the artifact no
longer matches the current worktree, the command writes the diagnostic JSON but
exits non-zero with `source_evidence_stale`.

Current behavior:

- `pnpm deploy:evidence:source:plan:write` rejects stale source evidence even
  with `--allow-active`.
- `pnpm deploy:evidence:source` must be rerun first.
- After fresh source evidence is generated, `pnpm deploy:evidence:source:plan:write`
  can write the active cleanup plan for the current dirty worktree.
- `sourceEvidenceCurrent` and `sourceCurrency` are recorded in
  `deploy-evidence/source-review-plan-latest.json`.

Verification:

- `node --check scripts/write-source-review-plan.mjs`: pass.
- `pnpm deploy:evidence:source:plan:selftest`: pass, including stale-manifest
  detection.
- `pnpm exec eslint --no-ignore --no-warn-ignored scripts/write-source-review-plan.mjs`:
  pass.
- Stale artifact probe: `pnpm deploy:evidence:source:plan:write` exited `1`
  with `Source evidence current: no` and `status_manifest_mismatch`.
- Fresh artifact probe:
  `pnpm deploy:evidence:source` expected-failed on the dirty worktree after
  writing 371 current status entries, then `pnpm deploy:evidence:source:plan:write`
  exited `0` with `Source evidence current: yes` and six active cleanup waves.

## 2026-06-18: Source Review Packets + Exact Counts

The source review plan already carried exact wave file lists, but reviewers
still had to dig through one large JSON artifact. That is too much friction for
a 377-file release blocker, and the previous wave totals could also double-count
files that matched both a risk bucket and a path group.

Current behavior:

- `scripts/write-source-review-plan.mjs` writes per-wave review packets beside
  the JSON plan by default:
  `deploy-evidence/source-review-plan-latest-packets/INDEX.md`.
- Each active wave gets:
  - `<priority>-<wave>.paths.txt` with exact files only.
  - `<priority>-<wave>.review.md` with counts, notes, verification commands,
    and a file-by-file checklist.
- `reviewWaves[].reviewPacket` and the top-level `reviewPackets` object link
  the machine JSON to the human packet files.
- Wave counts now come from the de-duplicated exact file manifest, not aggregate
  bucket/path-group counts.
- The packets are review aids only. They do not approve release; clean source
  evidence must still pass.

Verification:

- `node --check scripts/write-source-review-plan.mjs`: pass.
- `pnpm deploy:evidence:source:plan:selftest`: pass, including packet file
  generation and overlap-safe exact counts.
- `pnpm exec eslint --no-ignore --no-warn-ignored scripts/write-source-review-plan.mjs`:
  pass.
- `pnpm deploy:evidence:source`: expected block, exit `1`, refreshed current
  dirty-source evidence with 377 entries.
- `pnpm deploy:evidence:source:plan:write`: pass with active waves, wrote
  `deploy-evidence/source-review-plan-latest-packets/INDEX.md`, and reported
  exact counts: P0 release-critical 25 files, P0 security/access 52, P1 runtime
  151, P1 frontend 150, P2 docs 42, P2 uncategorized 28.

## 2026-06-18: Secret Disposition Placeholder Rejection

Secret-history disposition now fails closed when approval evidence still looks
like copied template data. The evidence writer and strict verifier both reject
placeholder owner/reviewer/ticket strings such as `security-owner@example.com`,
`release-security@example.com`, `SEC-123`, `SEC-1234`, angle-bracket values,
`sample`, `placeholder`, `replace-me`, and `todo`.

Why this matters: historical secret exposure is a launch-blocking security item.
The current tree and commit can scan clean while old leaked credentials still
need rotation/revocation proof and a named security-owner disposition. A copied
template must not be able to produce a passing artifact or pass strict
verification.

Verification:

- `node --check scripts/write-secret-scan-evidence.mjs`: pass.
- `node --check scripts/verify-deploy-evidence.mjs`: pass.
- `pnpm deploy:evidence:secrets:selftest`: pass, including a poisoned
  disposition-file fixture with placeholder owner/reviewer/ticket values.
- `pnpm deploy:evidence:selftest`: pass, including strict verifier rejection of
  placeholder secret disposition evidence.
- `pnpm deploy:evidence:bundle:selftest`: pass.
- `pnpm exec eslint --no-ignore --no-warn-ignored scripts/write-secret-scan-evidence.mjs scripts/verify-deploy-evidence.mjs`:
  pass.
- `pnpm deploy:evidence:production`: expected block, exit `1`, 20 failures. The
  verifier ran successfully and still blocks release on dirty source, missing
  ops/Sentry/browser artifacts, stale/local load evidence, incomplete secret
  disposition, and missing live Apollo/Seamless/Tech Intel provider evidence.
- `pnpm deploy:evidence:source`: expected block, exit `1`, refreshed source
  evidence with 371 dirty entries.
- `pnpm deploy:evidence:source:plan:write`: pass, source evidence current, six
  active cleanup waves.

## 2026-06-18: Operational Approval Ticket Placeholder Rejection

Operational readiness already required platform/ops approval evidence. This
slice tightens the approval-ticket field so copied sample tickets cannot look
release-shaped after the rest of the template has been replaced.

The writer, strict verifier, and bundle preflight now reject exact sample values
such as `OPS-123`, `OPS-1234`, and `ticket-123`, in addition to existing
angle-bracket, example, sample, placeholder, replace-me, and todo signals. The
template now uses `MANTU-OPS-<real-ticket-id>` so it reads as a placeholder, not
as release proof.

Verification:

- `node --check scripts/write-operational-readiness-evidence.mjs`: pass.
- `node --check scripts/verify-deploy-evidence.mjs`: pass.
- `node --check scripts/run-deploy-evidence-bundle.mjs`: pass.
- `pnpm deploy:evidence:ops:selftest`: pass, including `OPS-1234` poisoned
  approval-ticket fixture.
- `pnpm deploy:evidence:selftest`: pass, including strict verifier rejection of
  a stale ops artifact with `OPS-1234`.
- `pnpm deploy:evidence:bundle:selftest`: pass, including preflight rejection
  of the same sample ticket.
- `pnpm exec eslint --no-ignore --no-warn-ignored scripts/write-operational-readiness-evidence.mjs scripts/verify-deploy-evidence.mjs scripts/run-deploy-evidence-bundle.mjs`:
  pass.
- `pnpm deploy:evidence:preflight:production`: expected block, exit `1`, 46
  blockers.
- `pnpm deploy:evidence:production`: expected block, exit `1`, 20 failures.
- `pnpm deploy:evidence:source`: expected block, exit `1`, refreshed source
  evidence with 371 dirty entries.
- `pnpm deploy:evidence:source:plan:write`: pass, source evidence current, six
  active cleanup waves.

## 2026-06-18: Strict Provider Refresh Placeholder Rejection

Provider release evidence now fails closed when a provider-quality run looks
like a fixture, local smoke, or copied template instead of live staging or
production proof.

The provider evidence writer rejects placeholder or local-looking targets,
placeholder company keys, placeholder or short API tokens, and strict
`live-refresh` artifacts that come from a response-file fixture. Fixture-based
selftests still work only in non-strict mode, so test coverage cannot become
release proof by accident.

The strict deploy verifier also rejects placeholder provider targets, company
keys, API tokens, and expected Tech Intel source requirements. The bundle
preflight now treats values such as `release-token` as placeholders, matching
the writer and verifier.

Verification:

- `node --check scripts/write-provider-quality-evidence.mjs`: pass.
- `node --check scripts/verify-deploy-evidence.mjs`: pass.
- `node --check scripts/run-deploy-evidence-bundle.mjs`: pass.
- `pnpm deploy:evidence:providers:selftest`: pass, including poisoned twins for
  placeholder target, company key, token, short token, missing token, and
  strict fixture response.
- `pnpm deploy:evidence:selftest`: pass, including provider placeholder
  verifier failures.
- `pnpm deploy:evidence:bundle:selftest`: pass.
- `pnpm exec eslint --no-ignore --no-warn-ignored scripts/write-provider-quality-evidence.mjs scripts/verify-deploy-evidence.mjs scripts/run-deploy-evidence-bundle.mjs`:
  pass.
- `pnpm deploy:evidence:preflight:production`: expected block, exit `1`, 46
  blockers.
- `pnpm deploy:evidence:production`: expected block, exit `1`, 20 failures,
  including missing live Apollo, Seamless, and Tech Intel provider evidence.

## 2026-06-18: Production Integration Token Key Format

The production API boot check now rejects malformed `INTEGRATION_TOKEN_KEY`
values instead of only checking that a value exists. The accepted format is a
64-character hex string from `openssl rand -hex 32`, matching the runtime token
cipher and operational runbook.

This removes a release footgun: a copied sample value or base64 value could pass
presence-only production env validation, then fail later when a user connects or
refreshes an OAuth-backed integration.

Verification:

- `pnpm --filter @bidstack/shared test -- src/crypto/token-cipher.test.ts --reporter=dot`:
  4/4 pass.
- `pnpm --filter @bidstack/api test -- src/env.test.ts --reporter=dot`: 5/5
  pass.
- `pnpm --filter @bidstack/shared exec tsc --noEmit --pretty false`: pass.
- `pnpm --filter @bidstack/api exec tsc --noEmit --pretty false`: pass.
- Targeted shared/API ESLint: pass.
- `bash -n scripts/ops/rotate-secrets.sh scripts/ops/deploy-checklist.sh scripts/check-secrets.sh`:
  pass.
- `pnpm --filter @bidstack/shared build`: pass.
- `pnpm --filter @bidstack/api build`: pass.
- `pnpm deploy:evidence:source`: expected block, exit `1`, refreshed source
  evidence with 374 dirty entries.
- `pnpm deploy:evidence:source:plan:write`: pass, source evidence current, six
  active cleanup waves.
- `pnpm deploy:evidence:preflight:production`: expected block, exit `1`, 46
  blockers.
- `pnpm deploy:evidence:production`: expected block, exit `1`, 20 failures.

## 2026-06-18: Azure Integration Token Key Policy

The Azure draft now carries the same integration-token key contract as the
runtime: `integrationTokenKey` is a 64-character hex value generated with
`openssl rand -hex 32`, stored in Key Vault as `integration-token-key`, and
injected into API/worker as `INTEGRATION_TOKEN_KEY`.

`scripts/verify-azure-infra-policy.mjs` is a source-policy guard for the Azure
draft. It fails if the Bicep parameter loses its `@minLength(64)` /
`@maxLength(64)` decorators, if the description reverts to base64 wording, or
if Key Vault / Container Apps / env wiring stops referencing the same secret.

Verification:

- `node --check scripts/verify-azure-infra-policy.mjs`: pass.
- `pnpm deploy:evidence:azure:policy:selftest`: pass.
- `pnpm deploy:evidence:azure:policy`: pass.
- `pnpm exec eslint --no-ignore --no-warn-ignored scripts/verify-azure-infra-policy.mjs`:
  pass.
- `node --check scripts/write-release-tool-readiness.mjs`: pass.
- `pnpm deploy:evidence:tools:selftest`: pass.
- `pnpm exec eslint --no-ignore --no-warn-ignored scripts/verify-azure-infra-policy.mjs scripts/write-release-tool-readiness.mjs`:
  pass.
- `pnpm deploy:evidence:tools`: pass, 27 required checks and zero blockers.
- `az bicep version`: not run; Azure CLI is not installed on this machine.
- `pnpm deploy:evidence:source`: expected block, exit `1`, refreshed source
  evidence with 379 dirty entries.
- `pnpm deploy:evidence:source:plan:write`: pass, source evidence current, six
  active cleanup waves. Exact counts: release-critical 25, security/access 54,
  runtime 152, frontend UX 150, docs 42, uncategorized 28.

## 2026-06-19: Operational Restore Thresholds Reject Missing Values

The strict deploy verifier now treats missing operational restore targets as
missing evidence instead of coercing `null` to `0`.

Why this matters: `scripts/write-operational-readiness-evidence.mjs` writes
`null` for absent restore RTO/RPO values. JavaScript `Number(null)` is `0`, so
the production verifier could display false-green subchecks such as
`Restore RTO is within release threshold - 0m` even while the top-level
operational readiness gate failed. The release was still blocked, but the
subcheck text was misleading.

The verifier now parses numeric evidence with an explicit missing-value guard
before comparing backup retention, restore RTO, and restore RPO thresholds.

Verification:

- `pnpm deploy:evidence:selftest`: pass, including a poisoned operational
  artifact with `restoreRtoMinutes: null` and `restoreRpoMinutes: null`.
- `node --check scripts/verify-deploy-evidence.mjs`: pass.
- `pnpm exec eslint --no-ignore --no-warn-ignored scripts/verify-deploy-evidence.mjs scripts/write-operational-readiness-evidence.mjs --max-warnings=0`:
  pass.
- `pnpm deploy:evidence:ops:selftest`: pass.
- `$env:BIDSTACK_DEPLOY_ENV='production'; pnpm deploy:evidence:ops`: expected
  block, writes a fresh production-targeted ops artifact with 21 concrete
  missing-proof failures.
- `pnpm deploy:evidence:production`: expected block, now reports
  `Restore RTO exceeds release threshold - rto=missing max=240` and
  `Restore RPO exceeds release threshold - rpo=missing max=60`, plus
  `Operational readiness matches deploy environment - production`.

## 2026-06-19: Sentry Smoke Preflight Requires CLI Auth

The release bundle preflight now checks for `SENTRY_AUTH_TOKEN` or
`BIDSTACK_SENTRY_AUTH_TOKEN` before it attempts the Sentry smoke evidence step.

Why this matters: `scripts/write-sentry-smoke-evidence.mjs` can trigger smoke
events through the app API, but it verifies ingestion by shelling out to
`sentry issue list`. Without Sentry CLI auth, the bundle could pass preflight
far enough to spend time triggering or querying smoke evidence, then fail late
with missing issue observations.

The new preflight check is sensitive, requires at least 24 characters, rejects
placeholder-looking values, and is covered by the deploy bundle selftest.

Verification:

- `pnpm deploy:evidence:bundle:selftest`: pass, including a poisoned placeholder
  `SENTRY_AUTH_TOKEN` check.
- `node --check scripts/run-deploy-evidence-bundle.mjs`: pass.
- `pnpm exec eslint --no-ignore --no-warn-ignored scripts/run-deploy-evidence-bundle.mjs --max-warnings=0`:
  pass.
- `pnpm deploy:evidence:selftest`: pass.
- `pnpm deploy:evidence:preflight:production`: expected block, exit `1`, now
  reports 47 blockers including `preflight.sentry.authToken`.

## 2026-06-19: Browser Evidence Must Match Deploy Environment

The strict deploy verifier now checks the browser regression artifact's
environment against the target deploy environment, matching the Sentry and ops
evidence posture.

Why this matters: browser regression evidence already recorded an
`environment`, but the verifier only checked profile, target, auth mode, build
type, personas, projects, specs, and test counts. A staging browser run against
a non-local Clerk-backed target could satisfy a production verification pass if
the artifact path was reused. The same pass also split evidence normalization
from deploy-target normalization so missing Sentry/browser environment evidence
stays `missing` instead of defaulting to `production`.

Verification:

- `node --check scripts/verify-deploy-evidence.mjs`: pass.
- `pnpm deploy:evidence:selftest`: pass, including a poisoned browser artifact
  whose environment is `production` while the strict verifier target is
  `staging`.
- `pnpm exec eslint --no-ignore --no-warn-ignored scripts/verify-deploy-evidence.mjs --max-warnings=0`:
  pass.

## 2026-06-19: Load Evidence Requires Raw k6 Summary Proof

Strict load certification verification now rejects compact load artifacts that
do not point to an existing raw k6 summary export inside the repo. The verifier
emits `load.rawSummary` and requires `rawSummaryFound: true` plus a valid
`rawSummaryPath`.

Why this matters: `production-load-latest.json` is a derived release summary.
Without the raw k6 summary, a hand-authored compact artifact could provide
passing thresholds and metrics without preserving the source run that produced
them. The strict deploy gate now requires both layers: raw k6 output and the
compact release record.

Verification:

- `node --check scripts/verify-deploy-evidence.mjs`: pass.
- `pnpm deploy:evidence:selftest`: pass, including a poisoned missing raw k6
  summary fixture.
- `pnpm load-test:selftest`: pass.
- `pnpm exec eslint --no-ignore --no-warn-ignored scripts/verify-deploy-evidence.mjs scripts/run-k6-load-test.mjs --max-warnings=0`:
  pass.
- `pnpm deploy:evidence:semgrep`: pass, refreshed strict Semgrep evidence with
  1,444 mirrored files, zero findings, and Dockerfile syntax check pass.
- `pnpm deploy:evidence:production`: expected block, now reports 26 pass / 47
  fail; Semgrep is fresh and clean, while remaining failures are release
  blockers that still need clean source, live target/credentials, evidence, or
  owner approval.

## 2026-06-19: Provider Evidence Must Match Deploy Environment

The strict deploy verifier now checks provider source-quality evidence against
the target deploy environment.

Why this matters: provider evidence already recorded `environment`, but the
verifier only checked the live-refresh command, target, company key, required
provider lanes, response lanes, and expected Tech Intel MCP sources. A staging
provider refresh could otherwise be reused in a production verification pass if
the target was non-local and the lane data looked complete.

Verification:

- `node --check scripts/verify-deploy-evidence.mjs`: pass.
- `pnpm deploy:evidence:selftest`: pass, including a poisoned provider artifact
  whose environment is `production` while the strict verifier target is
  `staging`.
- `pnpm exec eslint --no-ignore --no-warn-ignored scripts/verify-deploy-evidence.mjs --max-warnings=0`:
  pass.
- `pnpm deploy:evidence:production`: expected block, now reports 26 pass / 48
  fail. The extra failure is intentional: current provider evidence is
  staging-scoped and production now rejects it explicitly.

## 2026-06-19: Load Evidence Must Match Deploy Environment

The strict deploy verifier now checks load certification evidence against the
target deploy environment, and the k6 wrapper writes `environment` from
`BIDSTACK_DEPLOY_ENV` into `load-test-report/production-load-latest.json`.

Why this matters: browser and provider artifacts already had environment
checks, but load certification only checked profile, auth, target, thresholds,
and latency/error metrics. A stale staging certification against a non-local
target could otherwise be reused during a production verifier run.

The strict verifier also requires `strictEvidence: true` and the core k6 metric
block. Thresholds alone are not enough release proof if request count, max VUs,
checks rate, failure rate, or p95 latency are missing from the artifact.

Verification:

- `node --check scripts/run-k6-load-test.mjs`: pass.
- `node --check scripts/verify-deploy-evidence.mjs`: pass.
- `pnpm load-test:selftest`: pass, including strict preflight rejection of a
  missing `BIDSTACK_DEPLOY_ENV`.
- `pnpm deploy:evidence:selftest`: pass, including poisoned load artifacts for
  environment mismatch, missing `strictEvidence`, missing k6 metrics, and local
  smoke profile.

## 2026-06-19: Tool Readiness Requires Docker Image Execution Proof

The strict deploy verifier now rejects skipped image probes for any release tool
that depends on Docker fallback execution.

Why this matters: the existing tool-readiness artifact could pass by proving the
Docker daemon was reachable while leaving the pinned Gitleaks, k6, Semgrep, and
Trivy image probes marked `skipped`. For release evidence, Docker reachability
is not enough; the exact fallback image must execute before the runner is
trusted.

The release-facing `pnpm deploy:evidence:tools` command and the bundle's first
tools step now force `BIDSTACK_TOOL_READINESS_EXECUTE_IMAGE_PROBES=true`. Direct
`node scripts/write-release-tool-readiness.mjs` remains available for local
inventory, but strict deploy verification will reject its artifact if
Docker-dependent tools lack executed image probes.

Verification:

- `node --check scripts/write-release-tool-readiness.mjs`: pass.
- `node --check scripts/verify-deploy-evidence.mjs`: pass.
- `node --check scripts/run-deploy-evidence-bundle.mjs`: pass.
- `pnpm deploy:evidence:tools:selftest`: pass.
- `pnpm deploy:evidence:selftest`: pass, including a poisoned skipped-probe
  artifact rejected by `tools.imageProbes`.
- `pnpm deploy:evidence:bundle:selftest`: pass.
- `pnpm deploy:evidence:tools`: pass, 31 required checks and executed
  Gitleaks, k6, Semgrep, and Trivy image probes.
- `pnpm exec eslint --no-ignore --no-warn-ignored scripts/verify-deploy-evidence.mjs scripts/run-deploy-evidence-bundle.mjs scripts/write-release-tool-readiness.mjs`:
  pass.
- `pnpm deploy:evidence:production`: expected block, now reports 29 pass / 52
  fail and passes `Docker fallback images have execution proof`.

## 2026-06-19: Strict Verifier Writes Release Report By Default

The strict deploy verifier now writes the target release report path by default:
`deploy-evidence/strict-staging-latest.json` for staging and
`deploy-evidence/strict-production-latest.json` for production.

Why this matters: the verifier previously updated the console output unless
`BIDSTACK_DEPLOY_EVIDENCE_REPORT` was set, but it could leave the JSON release
artifact stale. A release review that opens the JSON report must see the same
fresh pass/fail state that the operator saw in the terminal.

Non-strict environments still write
`deploy-evidence/deploy-evidence-latest.json` unless an explicit report path is
provided.

Verification:

- `node --check scripts/verify-deploy-evidence.mjs`: pass.
- `pnpm deploy:evidence:selftest`: pass, including default report path
  assertions for staging and production config.
- `pnpm exec eslint --no-ignore --no-warn-ignored scripts/verify-deploy-evidence.mjs`:
  pass.
- `git diff --check -- packages/dust-client/src/index.ts scripts/verify-deploy-evidence.mjs`:
  pass after removing a whitespace-only line in `packages/dust-client/src/index.ts`.
- `pnpm --filter @bidstack/dust-client build`: pass.
- `pnpm deploy:evidence:production`: expected block, now reports 29 pass / 52
  fail and writes `deploy-evidence/strict-production-latest.json` with
  `tools.imageProbes` passing.

## 2026-06-19: Sentry Smoke Requires Non-Local Trigger Target Proof

Sentry smoke evidence now records `triggerTarget`, and the strict deploy
verifier rejects Sentry artifacts whose trigger target is missing, local, or
placeholder-looking.

Why this matters: the Sentry writer proved that release-scoped API and worker
issues were visible in Sentry, but the strict verifier did not prove which API
target produced them. Bundle preflight already required a non-local API target,
yet a direct artifact path could still produce structurally valid query
evidence without release-target proof.

The query-only path remains available after release ops manually trigger both
smoke events, but it must still provide `API_BASE_URL` or
`BIDSTACK_SENTRY_API_BASE_URL` so the compact artifact records the non-local
release target.

Verification:

- `node --check scripts/write-sentry-smoke-evidence.mjs`: pass.
- `node --check scripts/verify-deploy-evidence.mjs`: pass.
- `pnpm deploy:evidence:sentry:selftest`: pass, including missing/local trigger
  target fixtures.
- `pnpm deploy:evidence:selftest`: pass, including strict verifier missing/local
  Sentry target fixtures.
- `pnpm exec eslint --no-ignore --no-warn-ignored scripts/write-sentry-smoke-evidence.mjs scripts/verify-deploy-evidence.mjs`:
  pass.
- `git diff --check -- scripts/write-sentry-smoke-evidence.mjs scripts/verify-deploy-evidence.mjs`:
  pass.
- `pnpm deploy:evidence:production`: expected block, now reports 29 pass / 53
  fail and explicitly includes `sentry.target` until real production Sentry
  smoke evidence records a non-local release API target.

## 2026-06-19: Strict Source Evidence Must Match Current Git State

The strict deploy verifier now compares
`deploy-evidence/source-control-latest.json` with the live Git worktree before
accepting source-control evidence. The comparison checks commit, branch,
upstream, and the full `git status --porcelain=v1 -uall` manifest.

Why this matters: the source-review planner already detected stale source
artifacts, but the strict deploy verifier trusted the source-control JSON as
long as it was fresh enough. A stale clean artifact could otherwise be reused
after new local modifications, allowing `source.clean` to pass from old JSON
rather than the current release candidate.

Strict verification now emits `source.current`. It fails when the source
artifact no longer matches current Git state, when the worktree is not a Git
repo, or when the status manifest is missing for dirty evidence.

Verification:

- `node --check scripts/verify-deploy-evidence.mjs`: pass.
- `pnpm deploy:evidence:selftest`: pass, including a Git-backed poisoned
  stale-source fixture.
- `pnpm exec eslint --no-ignore --no-warn-ignored scripts/verify-deploy-evidence.mjs`:
  pass.
- `git diff --check -- scripts/verify-deploy-evidence.mjs`: pass.
- `pnpm deploy:evidence:production`: expected block, now reports 30 pass / 53
  fail. Current dirty source evidence still matches the live dirty manifest
  (`source.current` passes), while `source.clean` correctly blocks release.

## 2026-06-19: Browser Evidence Requires Source Report Proof

Strict browser regression verification now rejects synthetic browser artifacts
that only provide summary fields. The artifact must point to a raw Playwright
JSON source report inside the repo and must record the Playwright test command
that generated the report.

Why this matters: the browser writer already emits `sourceReport` and
`playwrightCommand`, but the strict deploy verifier could previously accept a
hand-authored summary with `passed: true`, required roles/projects/specs, and a
non-local target. The verifier now requires the command/report trail before
staging or production evidence can pass.

The strict verifier also rejects browser artifacts with unknown test outcomes
even when `passed: true` is set. A release browser run must have at least one
passing test, zero failed tests, and zero unknown outcomes.

Verification:

- `node --check scripts/verify-deploy-evidence.mjs`: pass.
- `pnpm deploy:evidence:selftest`: pass, including poisoned synthetic-browser
  and unknown-test-count fixtures.
- `pnpm exec eslint --no-ignore --no-warn-ignored scripts/verify-deploy-evidence.mjs --max-warnings=0`:
  pass.

## 2026-06-19: Container Evidence Requires Raw Trivy Report Proof

Strict container verification now rejects compact-only scan artifacts. Each
image entry in `deploy-evidence/container-scan-latest.json` must include a
repo-local raw Trivy JSON report path, and that file must exist and parse as
JSON.

Why this matters: the compact container artifact is a release summary. Without
the raw Trivy output, a copied or hand-authored zero-finding summary could pass
the gate without preserving the scanner run that produced it.

The scanner writes raw reports under
`deploy-evidence/container-scan-reports/` by default. Override with
`BIDSTACK_CONTAINER_SCAN_RAW_REPORT_DIR` only when the release runner stores
raw artifacts in a different repo-local folder.

Verification:

- `node --check scripts/run-container-vulnerability-scan.mjs`: pass.
- `node --check scripts/verify-deploy-evidence.mjs`: pass.
- `node scripts/run-container-vulnerability-scan.mjs --selftest`: pass.
- `pnpm deploy:evidence:selftest`: pass, including a poisoned compact-only
  container artifact rejected by `container.rawReports`.
- Targeted ESLint on the scanner and verifier: pass.

## 2026-06-19: Raw Source Evidence Must Be Parseable JSON

Strict load and browser verification now parse their raw source reports instead
of only checking that a file exists.

Why this matters: after adding raw-source proof for k6 and Playwright, a stub
file could still satisfy the path/existence check. The strict verifier now
requires the raw k6 summary and raw Playwright JSON report to be repo-local and
parseable JSON, matching the stricter Trivy source-proof posture.

Verification:

- `node --check scripts/verify-deploy-evidence.mjs`: pass.
- `pnpm deploy:evidence:selftest`: pass, including poisoned invalid-JSON
  fixtures for `load.rawSummary` and `browser.sourceReport`.
- `pnpm exec eslint --no-ignore --no-warn-ignored scripts/verify-deploy-evidence.mjs --max-warnings=0`:
  pass.
- `pnpm deploy:evidence:production`: expected block, 31 pass / 54 fail. The
  current raw k6 summary parses, while release is still blocked by stale/local
  load evidence and missing browser evidence.

## 2026-06-19: Semgrep Evidence Requires Scanner Metadata

Strict Semgrep verification now rejects compact zero-finding summaries. A
release artifact must preserve real Semgrep output and the release-runner
metadata that makes it reviewable.

Why this matters: Semgrep was already passing, but the verifier could accept a
tiny hand-authored `{ "passed": true, "blockingFindings": 0 }` artifact. That
is not enough for a 100k-user release gate because it does not prove the scanner
ran, which configs ran, how much source was scanned, or whether Dockerfile
syntax was checked.

Strict verification now emits and enforces:

- `semgrep.scanner`
- `semgrep.image`
- `semgrep.configs`
- `semgrep.severities`
- `semgrep.coverage`
- `semgrep.command`
- `semgrep.reportShape`
- `semgrep.dockerfileSyntax`

Verification:

- `node --check scripts/verify-deploy-evidence.mjs`: pass.
- `pnpm deploy:evidence:selftest`: pass, including a poisoned compact Semgrep
  summary.
- `pnpm exec eslint --no-ignore --no-warn-ignored scripts/verify-deploy-evidence.mjs --max-warnings=0`:
  pass.
- `pnpm deploy:evidence:production`: expected block, 39 pass / 54 fail. The
  real Semgrep artifact stays green with scanner, image, config, severity,
  coverage, command, raw array, and Dockerfile syntax proof.

## 2026-06-19: Secret Evidence Requires Raw Gitleaks Report Proof

Strict secret verification now rejects summary-only Gitleaks evidence. The
secret evidence writer copies raw Gitleaks JSON reports into
`deploy-evidence/secret-scan-reports/` and records them under
`rawReports.currentCommit` and `rawReports.fullHistory`.

Why this matters: a release artifact that only says
`currentCommitGitleaksClean: true` and `fullHistoryReviewed: true` is not
enough to prove the scanner ran. Strict production now parses the raw JSON
reports before accepting the current-commit scan or full-history review.

Strict verification now emits:

- `secrets.currentCommitRawReport`
- `secrets.fullHistoryRawReport`

The writer still blocks on real historical secret disposition when full history
contains findings. Raw report proof does not replace credential rotation,
revocation, owner approval, approval ticket, or ISO timestamps.

Verification:

- `node --check scripts/write-secret-scan-evidence.mjs`: pass.
- `node --check scripts/verify-deploy-evidence.mjs`: pass.
- `pnpm deploy:evidence:secrets:selftest`: pass.
- `pnpm deploy:evidence:selftest`: pass, including a poisoned summary-only
  secret evidence fixture.
- `pnpm exec eslint --no-ignore scripts/write-secret-scan-evidence.mjs scripts/verify-deploy-evidence.mjs`:
  pass.
- `pnpm deploy:evidence:secrets`: expected block. Current tree/current commit
  are clean and raw reports are written; the artifact still fails until the 11
  historical findings have real rotation/revocation and owner-approved
  disposition evidence.
- `pnpm deploy:evidence:production`: expected block, 41 pass / 54 fail.
  `secrets.currentCommitRawReport` and `secrets.fullHistoryRawReport` pass.

## 2026-06-19: Ops Readiness Requires Evidence References

Strict operational readiness can no longer be satisfied by names, timestamps,
and boolean environment flags alone. The ops evidence writer now requires a
flat `evidenceRefs` object with reviewable references for each operational
claim:

- `approval`
- `bicepBuild`
- `whatIf`
- `privateNetworking`
- `storage`
- `migrationJob`
- `migrationDeploy`
- `backupConfig`
- `restoreDrill`
- `rollbackRunbook`
- `rollbackDrill`
- `monitoringAlerts`
- `onCall`

Why this matters: a 100k-user production release needs an auditable trail for
platform approvals, Azure build/what-if output, database backup and restore
drills, rollback practice, monitoring coverage, and on-call escalation. A
release artifact that only says these are true is not reviewable evidence.

The release bundle preflight also carries and checks these references with
`BIDSTACK_OPS_EVIDENCE_*` environment variables, so an ops readiness JSON file
does not lose proof when the bundle bridges it into the writer.

Verification:

- `node --check scripts/write-operational-readiness-evidence.mjs`: pass.
- `node --check scripts/verify-deploy-evidence.mjs`: pass.
- `node --check scripts/run-deploy-evidence-bundle.mjs`: pass.
- `pnpm deploy:evidence:ops:selftest`: pass.
- `pnpm deploy:evidence:selftest`: pass, including a poisoned summary-only ops
  fixture.
- `pnpm deploy:evidence:bundle:selftest`: pass.
- `pnpm exec eslint --no-ignore scripts/write-operational-readiness-evidence.mjs scripts/verify-deploy-evidence.mjs scripts/run-deploy-evidence-bundle.mjs`:
  pass.
- `BIDSTACK_DEPLOY_ENV=production pnpm deploy:evidence:ops`: expected block,
  fresh production ops artifact written with 34 missing-proof failures.
- `pnpm deploy:evidence:production`: expected block, 41 pass / 67 fail, now
  including 13 explicit `ops.evidence.*` failures.

## 2026-06-19: Failed Strict Container Preflight Writes Evidence

The container scanner now writes a fresh failing artifact even when strict
container preflight fails before scanning. This prevents a failed command from
leaving an older non-strict container artifact behind.

Strict container evidence with mutable local tags now records
`strictEvidence: true`, `environment`, requested images, `commandExitCode: 1`,
`passed: false`, and `validationFailures`. The release remains blocked until
operators supply immutable registry digest refs and raw Trivy reports for the
actual deploy images.

The strict deploy verifier also rejects `container.findings` when a strict
artifact has zero image reports. A scan with no reports cannot claim zero
blocking findings.

Verification:

- `node --check scripts/run-container-vulnerability-scan.mjs`: pass.
- `node --check scripts/verify-deploy-evidence.mjs`: pass.
- `node scripts/run-container-vulnerability-scan.mjs --selftest`: pass.
- `pnpm deploy:evidence:selftest`: pass, including strict zero-report
  container evidence.
- `pnpm exec eslint --no-ignore scripts/run-container-vulnerability-scan.mjs scripts/verify-deploy-evidence.mjs`:
  pass.
- `BIDSTACK_DEPLOY_ENV=production pnpm deploy:evidence:container`: expected
  block, fresh strict red artifact written for mutable local tags.
- `pnpm deploy:evidence:production`: expected block, 41 pass / 68 fail.

## 2026-06-19: Provider Preflight Writes Fresh Red Evidence

The release bundle now runs provider quality evidence as a safe preflight
diagnostic when operator preflight is blocked. This prevents stale staging
provider JSON from hiding the real launch blocker.

Behavior:

- Normal provider certification still uses `deploy:evidence:providers` and
  must live-refresh Apollo, Seamless.AI, and Tech Intel MCP lanes from a
  non-local release API.
- When the bundle lacks live provider target/token/company-key inputs, the same
  writer fails closed before network calls and writes a fresh production red
  `deploy-evidence/provider-quality-latest.json`.
- The bundle records the provider step as `preflightDiagnostic=true`, and strict
  verification now reports fresh, production-scoped provider proof with concrete
  missing-lane failures.

Verification:

- `node --check scripts/run-deploy-evidence-bundle.mjs`: pass.
- `pnpm deploy:evidence:providers:selftest`: pass.
- `pnpm deploy:evidence:bundle:selftest`: pass.
- `pnpm deploy:evidence:bundle:production`: expected block, now includes
  `providers.failed` and writes fresh provider evidence.
- `pnpm deploy:evidence:production`: expected block, 46 pass / 75 fail.
  `providers.fresh` and `providers.environment` pass; provider lane proof still
  correctly fails until live Apollo, Seamless.AI, and Tech Intel MCP evidence is
  supplied.
