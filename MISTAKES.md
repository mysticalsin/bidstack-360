# MISTAKES — BidStack 360°

Per Tony's `mistakes-protocol.md`:

- Read this BEFORE every task
- Log EVERY mistake immediately (root cause, prevention rule, category)
- Never repeat a logged mistake — if a repeat is detected, HALT and escalate
- After completing a non-trivial fix, write a `docs/solutions/` entry for reuse

---

## Format

```
### [TIMESTAMP] CATEGORY: Short description
- **What went wrong:** ...
- **Root cause:** ...
- **Prevention rule:** ...
- **Files affected:** ...
```

Categories: BUG, ARCHITECTURE, SECURITY, PERFORMANCE, UX, TESTING, INFRA, PROCESS.

---

### 2026-06-29 INFRA: `sed -i` with slashes-in-pattern corrupted all 7 CI workflow files

- **What went wrong:** SHA-pinning GitHub Actions with `sed -i "/uses: ${path}@${tag}.../ s|...|...|"` where `${path}` contained `/` (e.g. `actions/checkout`). The `/` terminated the sed address regex early, so sed mis-parsed the command ("extra characters after command", "unknown option to s") and wrote mangled fragments (`heckout@v4([[:space:]]|$)/ s|...`) into every workflow. Caught immediately (the verify grep showed corruption + the harness flagged the files as modified).
- **Root cause:** Used a `/`-delimited sed address on patterns that themselves contain `/`. No backup before an in-place bulk mutation, and no post-edit validation step built into the command.
- **Prevention rule:** Never `sed -i` across multiple files with a regex that can contain the delimiter char. For literal token replacement use a small Node script (`String.split(from).join(to)`) — no regex, no escaping. ALWAYS back up to scratchpad before a bulk in-place edit, and validate immediately after (YAML parse / typecheck). Recovery here: backup → `git checkout HEAD -- <files>` → diff backup-vs-HEAD to confirm no legit change lost → redo with the Node replacer.
- **Files affected:** `.github/workflows/{ci,e2e,lighthouse,semgrep,dependency-review,gitleaks,tsdoc-coverage}.yml` (all recovered, then correctly SHA-pinned in `b6fc70e5`).

---

### 2026-06-19 PROCESS: Blind `git add <file>` on a tree with pre-existing uncommitted WIP

- **What went wrong:** Intended a 1-line lint fix commit (`userId` → `_userId`) but `git add` of `serum-connector-egress.test.ts` captured all 209 lines of that pre-existing untracked file, misattributing prior-session serum WIP under a "lint fix" message. Caught and reversed with `git reset --mixed HEAD~1`.
- **Root cause:** The `demo` branch carried a large uncommitted wave (~404 files, incl. untracked new files and the F2/F3/F4/F25 audit remediations). `git add <path>` stages the entire file, not just the hunk you authored, so a file already dirty/untracked at HEAD bundles its pre-existing changes into your commit.
- **Prevention rule:** On a dirty WIP tree, before `git add <file>` confirm the file was clean at HEAD (`git diff --numstat HEAD -- <file>` should show only your hunk; check it isn't untracked). If it carries changes you didn't author, do NOT bulk-add — isolate hunks (`git add -p` / patch-apply) or leave it for the tree owner to commit. New files you authored (e.g. a fresh doc) are safe to add alone.
- **Files affected:** apps/worker/src/queues/serum-connector-egress.test.ts (commit reversed; lint fix preserved in working tree).

---

## Ledger

<!-- New entries appended at the top of this section. -->

### 2026-06-28 SECURITY: PII field encryption wrote ciphertext but left lookup/ops paths unsafe

- **What went wrong:** The PII middleware encrypted random-IV email values and populated `emailHash`, but did not rewrite `where.email` equality lookups to the hash column. `User.email` was included despite having no hash column, `Contact.mobilePhone` was listed despite not existing in schema, id-only reads could return `enc:v1:` ciphertext, and KAM consultant PII was missing from backfill/rollback scripts.
- **Root cause:** The security control was reviewed as “write encryption exists” instead of as an end-to-end data contract: write path, read path, equality search, case-insensitive email semantics, schema coverage, and operator migration/rollback all have to move together.
- **Prevention rule:** Field encryption is not complete until every encrypted searchable field has a companion deterministic lookup path, middleware rewrites supported filters, unsupported filters fail loud, backfill and rollback cover the exact PII map, and tests prove write/read/search behavior with the flag on. Never include a model in `PII_MAP` without a schema hash column or a documented non-searchable decision.
- **Files affected:** `packages/db/src/middleware/pii-encryption.ts`, `packages/db/src/middleware/pii-encryption.test.ts`, `packages/shared/src/crypto/pii-field-cipher.ts`, `scripts/encrypt-existing-pii.ts`, `scripts/decrypt-pii-rollback.ts`, `docs/security/pii-field-encryption.md`.

---

### 2026-06-27 TESTING: Repeated stale shared-dist consumer check after schema export

- **What went wrong:** After adding `OrgLocaleSettings` under `packages/shared/src/schemas`, I ran API/web consumer tests before rebuilding `@bidstack/shared`. Fastify route registration saw `OrgLocaleSettings` as `undefined` from stale `packages/shared/dist` and failed with `Cannot read properties of undefined (reading 'isFluentSchema')`.
- **Root cause:** I repeated an already-logged BIDCRM rule: consumer packages resolve `@bidstack/shared` from built `dist`, not directly from source. A shared typecheck is not a dist rebuild.
- **Prevention rule:** For any shared schema/export edit, the immediate next validation command must be `corepack pnpm --filter @bidstack/shared build` to completion. Only then run API/web typecheck, route tests, or browser E2E.
- **Files affected:** `packages/shared/src/schemas/org-locale-settings.ts`, `packages/shared/src/schemas/index.ts`, `apps/api/src/routes/org-settings.ts`, `apps/web/src/components/settings/CurrencyLocaleSection.tsx`.

---

### 2026-06-26 BUG: Code-review remediation introduced two shipped regressions (relocated a value without re-checking the destination contract)

- **What went wrong:** Fixing review findings, two "fixes" shipped new bugs that an adversarial re-review then caught. (1) Moved a seam note out of the `error` column into `result: { note }` on `AnalyticsReportRun` — but `result` is a typed row-array response contract (`z.array(...).optional()` in shared/analytics.ts), so the run-detail/export endpoint 500s on serialization for every worker-created run. (2) Fixed a light-mode contrast miss with `color: var(--info-strong, var(--info))` but defined `--info-strong` only in the light `:root`; CSS `var()` fallback only fires when the token is _undefined_, and a `:root` token cascades into dark mode — so dark rendered the light value (~3.3:1, AA fail) and actually **regressed** a line that previously passed with `--info`.
- **Root cause:** Relocating/replacing a value without verifying the destination's full schema/contract and all consumers; and a CSS misconception (`var(x, fallback)` does not fall back across themes when `x` is globally defined). Both passed local typecheck/lint/tests because the contracts they broke were a response-serializer schema and a runtime theme cascade, neither exercised by the unit tests.
- **Prevention rule:** When a fix moves a value to a different field/column, read that field's Zod/response contract AND its consumers before writing — a `Json?` DB column is not the same as its serialized API contract. For theme tokens, define the token in BOTH `[data-theme='light']` and `[data-theme='dark']`; never rely on `var(--x, fallback)` to cover a missing dark value. Run an adversarial re-review on remediation diffs before they ship — unit green ≠ contract-safe.
- **Files affected:** apps/worker/src/queues/scheduled-reports.ts, apps/web/src/index.css, apps/web/src/styles/cockpit.css (+ SectorViewPage.tsx errored-empty edge + thresholdsFor stale doc, same review). All fixed.

### 2026-06-26 PROCESS: Treated an errored `rg` (exit 2) as "no matches" and reported a finding dismissed

- **What went wrong:** During a code review I ran `rg -n "5173" --glob '!**/node_modules/**' .` to check whether a Vite dev-port change (5173→38081) broke anything. The command exited 2 (error) and printed nothing, so I told the user the port concern was "dismissed — zero references." A review agent then found `5173` hardcoded in `apps/api/src/lib/cors-origins.ts:1` and defaulted in `apps/api/src/env.ts:19`. Re-running with `grep` confirmed the agent: the references were real.
- **Root cause:** `rg` returned exit code 2 (it aborted on unreadable paths — the `.claude/worktrees/agent-*` symlinks), which is distinct from exit 1 (clean, no matches). Empty stdout from an _errored_ search was misread as an authoritative "no matches," producing a false-negative conclusion stated to the user.
- **Prevention rule:** Treat search exit codes explicitly. Exit 0 = matches, 1 = no matches, **2 = error → the result is NOT "empty," it is unknown.** Never conclude "zero references" from a search unless it exited 0/1 cleanly. Prefer the Grep tool (ripgrep with sane defaults) over raw `rg .` over the repo root; when shelling out, scope the path (e.g. `apps packages`) to avoid symlink/permission aborts, and check `$?` before trusting empty output.
- **Files affected:** none (review-only false negative; corrected before any code relied on it). The real divergence was fixed by adding `38081` to `DEV_WEB_PORTS` in `apps/api/src/lib/cors-origins.ts`.

---

### 2026-06-23 UX: Auto-start product tour blocked primary account actions

- **What went wrong:** The onboarding store auto-started the product tour during hydration, so a tour backdrop could intercept first-run clicks such as `New account` on `/accounts`.
- **Root cause:** First-run engagement logic was treated as harmless UI state, but it changed pointer and focus behavior on core CRM pages.
- **Prevention rule:** Tours, coach marks, and walkthroughs must be opt-in from an explicit trigger or scoped to a non-blocking surface. Browser smoke tests must click primary actions with fresh persisted UI state.
- **Files affected:** `apps/web/src/stores/onboarding.ts`, `apps/web/src/stores/onboarding.test.ts`, `docs/solutions/opt-in-product-tour.md`.

### 2026-06-23 UX/PERF: Third-party brand assets caused noisy console and offline brittleness

- **What went wrong:** Dashboard/account screens loaded Google Fonts, Google favicon URLs, and remote logo images at runtime. Blocked networks produced console errors and failed resources on otherwise healthy pages.
- **Root cause:** Decorative brand enrichment was allowed to make third-party browser requests instead of using same-origin/proxied assets or deterministic local fallbacks.
- **Prevention rule:** CRM shell, account cards, tech badges, and cockpit headers must render without third-party runtime asset fetches. Unknown logos should degrade to accessible local initials/monograms, and tests must reject remote favicon synthesis.
- **Files affected:** `apps/web/index.html`, `apps/web/src/index.css`, `apps/web/src/components/company/logoUrlSafety.ts`, `apps/web/src/components/company/CompanyLogo.tsx`, `apps/web/src/components/company/TechLogo.tsx`, `docs/solutions/offline-safe-brand-assets.md`.

### 2026-06-23 INFRA: Web-only dev server made API proxy return dashboard 500s

- **What went wrong:** The Vite web server was running on port 38081, but no API process was listening on the proxy target `localhost:4000`. Dashboard calls through `/api/v1/...` returned Vite proxy 500s, surfacing as "Could not load dashboard" even though the dashboard route tests passed.
- **Root cause:** Local verification used the web dev server without the API dev server. The browser saw same-origin `/api` failures from the proxy layer, not an application route regression.
- **Prevention rule:** When investigating dashboard 500s in local dev, check both halves first: `netstat -ano | findstr ":38081"` and `netstat -ano | findstr ":4000"`, then verify `/api/v1/crm/summary`, `/api/v1/reports/pipeline`, and `/api/v1/crm/dashboard` through the web origin. Prefer root `pnpm dev` or start `pnpm dev:api` alongside `pnpm dev:web`.
- **Files affected:** Runtime process state; no source fix required.

### 2026-06-22 SECURITY: PII field-encryption silently skipped on bulk `createMany` (fail-open)

- **What went wrong:** The Prisma PII-encryption middleware only handled `args.data` as a single object. `createMany` passes `data` as an array, so `extractOrgId` returned null and the middleware silently skipped encryption — email/phone would persist as plaintext (emailHash null) the moment `PII_FIELD_ENCRYPTION` flipped on. Live call sites: notes.service (AI-extracted meeting contacts) + onboarding.service.
- **Root cause:** A security control that FAILS OPEN when its input-shape assumption is violated. The orgId-extraction helper assumed the single-row write shape; the array shape (`createMany`, `updateMany`-with-array) was never handled or guarded.
- **Prevention rule:** Encryption/redaction middleware must FAIL LOUD, never fail open. When a PII-model write carries plaintext PII but no resolvable key, THROW — never pass through. Handle every Prisma write shape (create object, createMany array, upsert create/update, updateMany). Ship a regression test for the bulk path + a fail-loud test.
- **Files affected:** packages/db/src/middleware/pii-encryption.ts (+ .test.ts). Fixed `d818474d`.

### 2026-06-22 PROCESS: Cross-model review caught a cross-tenant IDOR that author tests missed

- **What went wrong:** The newly-wired workflow engine's `create_task` action used `config.oppId` without an org-scoped Opportunity lookup — org A could link a task to org B's opportunity. The implementing agent's own 22 unit tests passed; the IDOR only surfaced under independent adversarial review (Codex = BLOCKER, Claude code-reviewer = MAJOR). The original manual-run path had the same gap; the new trigger path widened it.
- **Root cause:** Author-written tests encode the author's mental model and don't probe the cross-tenant references the author never thought to validate (assignee/owner were validated; oppId was not). Single-perspective verification has blind spots.
- **Prevention rule:** For security/multi-tenant-sensitive changes, run an independent adversarial review (ideally cross-model) before commit, explicitly prompting "validate EVERY record id read from config/JSON against the caller's org" — not just the obvious refs.
- **Files affected:** packages/shared/src/workflow-engine.ts + api/worker effects. Fixed `71f74e04`.

### 2026-06-19 TESTING: Technical stack E2E assumed one account shape

- **What went wrong:** The technical-stack browser spec used broad provider-label text and then assumed a newly staged vendor would always be `Vendor 1 in QA`. The improved launchpad reused provider labels, and seeded accounts can already contain a QA category.
- **Root cause:** The test targeted repeated display text and fixed row order instead of semantic regions, explicit setup, and user-visible values.
- **Prevention rule:** Cockpit E2E specs must scope repeated labels to named regions and verify outcomes by API response, provider ids, accessible controls, and input values rather than fixed category/item positions.
- **Files affected:** `apps/web/e2e/technical-stack.spec.ts`.

### 2026-06-19 SECURITY: HubSpot migration queue carried raw OAuth tokens

- **What went wrong:** HubSpot import chunks placed `accessToken`, `refreshToken`, and `expiresAt` in `MigrationJobPayload.meta`, which BullMQ persists in Redis.
- **Root cause:** The worker needed HubSpot credentials per page, and the original producer forwarded decrypted tokens instead of a non-secret credential reference.
- **Prevention rule:** Queue payloads are not secret stores. Provider jobs must carry credential references only, with shared schema guards rejecting raw secret-looking metadata and workers resolving encrypted credentials just in time.
- **Files affected:** `packages/shared/src/schemas/migration.ts`, `packages/shared/src/schemas/migration.test.ts`, `apps/api/src/routes/migrations-hubspot.routes.ts`, `apps/api/src/routes/migrations-hubspot.routes.test.ts`, `apps/worker/src/queues/migration.ts`, `apps/worker/src/queues/migration.hubspot-credentials.test.ts`, `docs/solutions/hubspot-migration-queue-secret-hygiene.md`.

### 2026-06-19 BUG: HubSpot migration credentials used Salesforce integration type

- **What went wrong:** HubSpot OAuth migration credentials were stored in `IntegrationConfig` as `type='salesforce'` with `name='hubspot-migration'`.
- **Root cause:** The `integration_type` enum did not have a HubSpot value, and the route used Salesforce as a temporary closest-fit provider type.
- **Prevention rule:** Provider credentials must never be stored under a different provider enum. Add the enum/migration/backfill first, then route new writes through typed helper coordinates with a regression test.
- **Files affected:** `packages/db/prisma/schema.prisma`, `packages/db/prisma/migrations/20260619140000_hubspot_integration_type/migration.sql`, `packages/db/prisma/migrations/20260619140500_hubspot_integration_config_backfill/migration.sql`, `apps/api/src/routes/migrations-hubspot.routes.ts`, `apps/api/src/routes/migrations-hubspot.routes.test.ts`, `docs/solutions/hubspot-integration-type-migration.md`.

### 2026-06-19 UX: Empty technical stack started manual-first

- **What went wrong:** Accounts with no saved technical stack showed a passive blank state, so source-backed discovery from Apollo, Seamless.AI, configured Tech Intel MCPs, open data, or other attributed sources was not the obvious first action.
- **Root cause:** The card had a provider refresh contract and a mature add composer, but the zero-state did not route users into that source-backed workflow.
- **Prevention rule:** Enterprise data-entry zero-states must expose the best evidence-gathering path first, plus a clear manual-truth fallback, before asking users to type from scratch.
- **Files affected:** `apps/web/src/components/cockpit/TechStackCard.tsx`, `apps/web/src/components/cockpit/TechStackCard.test.tsx`, `apps/web/src/styles/cockpit.css`, `docs/solutions/technical-stack-provider-source-pull.md`.

### 2026-06-19 TOOLING: Container scan passed local mutable tags as release proof

- **What went wrong:** Strict production evidence accepted a fresh Trivy scan of local mutable image tags such as `bidcrm-api:root-api-user-probe` as if it proved the images that staging or production would deploy.
- **Root cause:** The container scanner recorded requested image coverage and findings, but not release environment or immutable registry digest refs. The strict verifier checked coverage by name only.
- **Prevention rule:** Release container evidence must record strict mode, deploy environment, and immutable image references (`registry/image@sha256:<digest>`). Local tag scans are useful hygiene but must not satisfy staging/production release gates.
- **Files affected:** `scripts/run-container-vulnerability-scan.mjs`, `scripts/verify-deploy-evidence.mjs`, `scripts/run-deploy-evidence-bundle.mjs`, `package.json`, `docs/solutions/container-vulnerability-scan-gate.md`, `docs/solutions/deploy-evidence-hard-gate.md`.

### 2026-06-19 TOOLING: Load certification evidence did not prove deploy environment

- **What went wrong:** Strict deploy evidence checked load profile, target, auth, thresholds, and a few optional metrics, but did not require the load artifact to record and match `BIDSTACK_DEPLOY_ENV`. It also allowed release-shaped artifacts without `strictEvidence: true` or the core k6 metrics block.
- **Root cause:** Browser and provider artifacts were hardened for environment reuse first, while load certification stayed treated as target/profile-only proof.
- **Prevention rule:** Every release evidence artifact with staging/production scope must record environment, strict-mode provenance, and minimum proof metrics, then assert equality with the verifier target in strict mode.
- **Files affected:** `scripts/run-k6-load-test.mjs`, `scripts/verify-deploy-evidence.mjs`, `docs/solutions/deploy-evidence-hard-gate.md`.

### 2026-06-19 SECURITY: MCP server could initialize public routes before production env validation

- **What went wrong:** The MCP server imported `server.ts` at module load, which initialized the Redis client before any production env validation could run. Missing, invalid, loopback, or fail-open Redis configuration could therefore reach the public MCP surface before failing through health or rate-limit behavior.
- **Root cause:** The API and worker had boot contracts, but MCP kept implicit defaults (`redis://localhost:6380`) and trusted runtime health checks instead of validating production dependencies before route exposure.
- **Prevention rule:** Any public tool/API surface with shared auth, database, or rate-limit dependencies must validate production env before importing modules that open connections or register routes. Production rate limiting must not be explicitly fail-open.
- **Files affected:** `apps/mcp-server/src/production-env.ts`, `apps/mcp-server/src/production-env.test.ts`, `apps/mcp-server/src/main.ts`, `scripts/verify-compose-production-policy.mjs`, `docs/solutions/mcp-production-env-fail-fast.md`.

### 2026-06-19 SECURITY: Worker boot accepted malformed production secret/storage config

- **What went wrong:** Production workers only failed fast for missing `DATABASE_URL` and `REDIS_URL`, while queues later decrypted OAuth/provider secrets and read/write object storage using `INTEGRATION_TOKEN_KEY` and storage env.
- **Root cause:** API env validation had the full production contract, but worker boot kept a local minimal check and relied on lazy queue failures for secret/storage misconfiguration.
- **Prevention rule:** Any worker that processes encrypted tenant/provider credentials or uploaded files must have a pure, unit-tested production env contract and call it before opening Redis or starting queue processors.
- **Files affected:** `apps/worker/src/lib/production-env.ts`, `apps/worker/src/lib/production-env.test.ts`, `apps/worker/src/main.ts`, `docs/solutions/worker-production-env-fail-fast.md`.

### 2026-06-19 SECURITY: Production compose omitted encryption key for API and worker

- **What went wrong:** `docker-compose.prod.yml` did not pass `INTEGRATION_TOKEN_KEY` to the API or worker even though production API boot rejects a missing key and workers decrypt stored provider/OAuth credentials.
- **Root cause:** Runtime env validation and Azure secret wiring were hardened, but local production compose was not mechanically checked against the same encryption-key contract.
- **Prevention rule:** Every production deploy descriptor must have a policy verifier tying runtime-required encryption keys to each service that encrypts or decrypts tenant/provider secrets; required interpolation only, no empty defaults.
- **Files affected:** `docker-compose.prod.yml`, `scripts/verify-compose-production-policy.mjs`, `package.json`, `docs/RUNBOOK.md`, `docs/solutions/production-compose-secret-wiring.md`.

### 2026-06-19 SECURITY: Web edge cache locations shadowed hardening headers

- **What went wrong:** The production nginx config had only basic security headers, and locations with their own `add_header Cache-Control` directives would shadow parent security headers unless every header was repeated in those blocks.
- **Root cause:** Cache freshness was hardened separately from browser security posture, but nginx `add_header` inheritance makes those concerns coupled.
- **Prevention rule:** Any nginx location that declares `add_header` must be tested for the full security header set, not just the new header being added. App-shell cache tests must assert HSTS, CSP, COOP/CORP, Permissions-Policy, and the baseline XFO/XCTO/referrer headers together.
- **Files affected:** `apps/web/nginx.conf`, `apps/web/src/lib/nginx-cache-policy.test.ts`, `docs/solutions/web-edge-security-headers.md`.

### 2026-06-19 SECURITY: Integration token rotation could strand encrypted provider tokens

- **What went wrong:** The quarterly rotation script could generate and write a new `INTEGRATION_TOKEN_KEY` even though the token re-encryption tool did not exist, while the operator copy implied `pnpm db:migrate` would handle re-encryption.
- **Root cause:** Format hardening aligned key shape but did not prove the operational rotation workflow had the required old-key-to-new-key migration step before replacement.
- **Prevention rule:** Any secret rotation for data-at-rest encryption must fail closed before generating a replacement key unless the tested re-encryption tool contract exists and ships a local selftest. Cleanup of previous keys must be conditional on completed row re-encryption, not elapsed time.
- **Files affected:** `scripts/ops/rotate-secrets.sh`, `scripts/rotate-integration-tokens.ts`, `scripts/verify-secret-rotation-policy.mjs`, `package.json`, `docs/RUNBOOK.md`, `docs/solutions/agent-provider-credentials-org-secret-routing.md`.

### 2026-06-19 SECURITY: Auth and provider control snapshots persisted like dashboard data

- **What went wrong:** React Query persistence could hydrate `me/capabilities`, roles, users, API key summaries, provider credentials, Dust status, and connector health as ordinary cached data. Role changes could also keep the same session marker, making logout/login look like the only way to refresh permissions or integration state.
- **Root cause:** The cache policy only excluded obvious live SERUM/account-cockpit snapshots and did not classify authorization/admin/provider control-plane queries as fail-closed data. Clerk session fingerprints included user/org but not org role; stub fingerprints ignored the active role.
- **Prevention rule:** Persist only low-risk dashboard snapshots. Auth, RBAC, credentials, provider health, integration setup, and webhook/admin data must refetch from the backend after reload and must clear on user, org, role, or demo identity changes.
- **Files affected:** `apps/web/src/lib/queryCache.ts`, `apps/web/src/lib/queryCache.test.ts`, `apps/web/src/lib/auth.tsx`, `apps/web/src/lib/auth.test.tsx`, `apps/web/e2e/flows/idle-auth-recovery.spec.ts`, `docs/solutions/idle-auth-refresh-and-focus-refetch.md`, `docs/audits/2026-06-16-serum-ux-ui-walteur-report.md`.

### 2026-06-19 UX: Provider evidence was separated from the manual add moment

- **What went wrong:** The Technical Stack add composer could show quick manual suggestions while Apollo, Seamless, or Tech Intel provider matches lived only in the separate source review queue. A user typing a provider-detected vendor could create a manual entry and lose accepted-source provenance.
- **Root cause:** The composer excluded provider suggestions from quick suggestions but did not replace them with an inline source-backed match surface.
- **Prevention rule:** When a manual composer and provider review queue share the same entity type, the composer must promote matching provider evidence inline and preserve provenance on accept.
- **Files affected:** `apps/web/src/components/cockpit/TechStackCard.tsx`, `apps/web/src/components/cockpit/TechStackCard.test.tsx`, `apps/web/src/styles/cockpit.css`, `docs/solutions/technical-stack-provider-source-pull.md`, `docs/audits/2026-06-16-serum-ux-ui-walteur-report.md`.

### 2026-06-19 UX: Mobile stack header copy visually collided

- **What went wrong:** In 390px browser QA, the Technical Stack editor's "Curated stack" title and "Saved as internal verified data" subtitle rendered as one crowded line.
- **Root cause:** The stack-header title/subtitle pair did not explicitly render as block text even though the surrounding mobile layout stacked the header.
- **Prevention rule:** After adding compact mobile workbench UI, capture the exact edited state and inspect title/subtitle pairs, not just overflow and button size metrics.
- **Files affected:** `apps/web/src/styles/cockpit.css`, `docs/audits/2026-06-16-serum-ux-ui-walteur-report.md`.

### 2026-06-18 UX: Provider suggestions made source lanes look unchecked

- **What went wrong:** Opening Technical Stack edit mode from existing Apollo, Seamless, or Tech Intel suggestions could still show provider readiness rows as "not checked" because the UI only trusted the current refresh response for lane status.
- **Root cause:** Source readiness state was modeled as a session-local refresh artifact instead of also deriving review-ready state from the actual pending provider suggestions already in the technical-stack state.
- **Prevention rule:** Any review inbox backed by provider evidence must derive lane readiness from both the latest provider refresh response and the queued evidence itself. Never let reviewable source deltas appear disconnected from their source lane.
- **Files affected:** `apps/web/src/components/cockpit/TechStackCard.tsx`, `apps/web/src/components/cockpit/TechStackCard.test.tsx`, `docs/solutions/technical-stack-provider-source-pull.md`, `docs/audits/2026-06-16-serum-ux-ui-walteur-report.md`.

### 2026-06-18 SECURITY: Production demo mode lacked explicit public-demo acknowledgement

- **What went wrong:** `DEMO_MODE=true` could run in production with `DEMO_SESSION_SECRET` and local storage, creating an intentional public passwordless demo door without a second operator acknowledgement.
- **Root cause:** Demo mode was treated as a valid production deployment kind but had only the feature flag and secret checks; it did not require a separate environment acknowledgement that this was intentionally public demo infrastructure.
- **Prevention rule:** Public/passwordless auth doors in production require a second explicit acknowledgement env separate from the feature flag, with tests proving production fails closed by default.
- **Files affected:** `apps/api/src/env.ts`, `apps/api/src/env.test.ts`, `.env.example`, `docs/solutions/public-demo-mode-production-ack.md`, `docs/audits/2026-06-16-serum-ux-ui-walteur-report.md`.

### 2026-06-18 SECURITY: Sentry request hooks were encapsulated and org tags could stay stale

- **What went wrong:** The Sentry Fastify plugin added request hooks without `fastify-plugin`, so hooks could be scoped to the plugin instead of protecting sibling routes. Sentry also set `orgId` tags only when a user/org was present, leaving a path for stale tenant tags after logout, anonymous requests, or completed responses.
- **Root cause:** Observability context was treated as a local plugin concern instead of process-wide request middleware, and tag clearing was less explicit than user clearing.
- **Prevention rule:** Cross-cutting Fastify hooks for auth, telemetry, security, and error handling must be wrapped with `fastify-plugin` unless encapsulation is intentional and tested. Any request-scoped telemetry tag needs an explicit anonymous/sentinel value on missing auth and after response cleanup.
- **Files affected:** `apps/api/src/plugins/sentry.ts`, `apps/api/src/plugins/sentry-context.test.ts`, `apps/web/src/lib/sentry.ts`, `apps/web/src/lib/sentry.test.ts`, `docs/solutions/sentry-pii-safe-observability.md`, `docs/audits/2026-06-16-serum-ux-ui-walteur-report.md`.

### 2026-06-18 UX: Provider bulk accept only staged visible source rows

- **What went wrong:** The Technical Stack source review queue let users filter by Apollo, Seamless, or Tech Intel, but the bulk accept action only staged the visible eight-card slice when the queue was capped.
- **Root cause:** The dense visual grid limit was reused as the data acceptance boundary, even though the operator intent was the active provider/source filter.
- **Prevention rule:** Review inboxes may cap rendered rows for scanability, but bulk actions must bind to the explicit filter/selection model. Test overflowed provider queues so hidden eligible rows are either included or clearly excluded by product copy.
- **Files affected:** `apps/web/src/components/cockpit/TechStackCard.tsx`, `apps/web/src/components/cockpit/TechStackCard.test.tsx`, `apps/web/src/styles/cockpit.css`, `docs/solutions/technical-stack-provider-source-pull.md`, `docs/audits/2026-06-16-serum-ux-ui-walteur-report.md`.

### 2026-06-18 SECURITY: Production public origin accepted insecure HTTP

- **What went wrong:** Production env validation rejected `PUBLIC_BASE_URL` only when it contained the literal string `localhost`, so `http://crm.example.com` and loopback aliases such as `https://127.0.0.1:5173` could pass boot validation.
- **Root cause:** The production-origin check used substring matching instead of parsing URL protocol and hostname semantics.
- **Prevention rule:** Production public URLs must be parsed and validated by protocol and host class. Require `https:` and reject loopback aliases before CORS or auth origin allowlists are built.
- **Files affected:** `apps/api/src/env.ts`, `apps/api/src/env.test.ts`, `docs/solutions/service-worker-api-bypass-and-streaming-cors.md`, `docs/audits/2026-06-16-serum-ux-ui-walteur-report.md`.

### 2026-06-18 SECURITY: Global top-account curation ignored restricted account scope

- **What went wrong:** A group-scoped user with `accounts:write` could call `PUT /api/v1/accounts/top-list` and replace the org-wide top-account curation, including clearing ranks for accounts outside their visible scope.
- **Root cause:** The route treated `accounts:write` and org membership as sufficient for a global curation mutation, but it did not check whether the caller's account visibility scope was unrestricted before running the global rank-clearing transaction.
- **Prevention rule:** Any account mutation that changes global/org-wide account state must check both permission and access scope. If the mutation can affect accounts outside the requester's visible set, require unrestricted scope before validation or transaction side effects.
- **Files affected:** `apps/api/src/routes/accounts.ts`, `apps/api/src/routes/user-groups.integration.test.ts`, `docs/solutions/account-access-scope-and-dev-proxy-verification.md`, `docs/audits/2026-06-16-serum-ux-ui-walteur-report.md`.

### 2026-06-18 UX: Source pull hid the stack workbench behind a second click

- **What went wrong:** The Technical Stack `Pull sources` action checked Apollo/Seamless/Tech Intel/open-data lanes but left the user in read-only mode unless the pull produced visible suggestions. Structured provider exports such as `technology,category,source` could also be parsed as flat vendor text.
- **Root cause:** The source-refresh path optimized for data refresh before operator review, and the import parser only modeled freeform paste patterns.
- **Prevention rule:** Source-pull actions must land users in the review context when the pull succeeds, even when sources only update readiness/provider state. Stack import parsers must support provider-export headers and test that headers/source columns are never staged as technologies.
- **Files affected:** `apps/web/src/components/cockpit/TechStackCard.tsx`, `apps/web/src/components/cockpit/TechStackCard.test.tsx`, `apps/web/e2e/technical-stack.spec.ts`, `docs/solutions/technical-stack-provider-source-pull.md`, `docs/audits/2026-06-16-serum-ux-ui-walteur-report.md`.

### 2026-06-18 SECURITY: Auth and mail logs exposed email identifiers

- **What went wrong:** SSO domain rejection logged the full rejected email and returned the configured allowlist to the caller; Gmail and Outlook connection logs wrote the external mailbox address.
- **Root cause:** Auth-policy and integration-success logs optimized for operator detail before applying the same PII-minimization rule used for Sentry.
- **Prevention rule:** General app logs must never include full email addresses for auth failures or integration connection success. Log pseudonymous ids plus bounded metadata such as domain/count, and add tests for generic auth-policy responses.
- **Files affected:** `apps/api/src/lib/email-privacy.ts`, `apps/api/src/lib/email-privacy.test.ts`, `apps/api/src/plugins/auth.ts`, `apps/api/src/plugins/auth.test.ts`, `apps/api/src/routes/integrations/gmail.ts`, `apps/api/src/routes/integrations/microsoft-mail.ts`.

### 2026-06-18 INFRA: Expected browser aborts surfaced as API errors

- **What went wrong:** The Technical Stack E2E flow passed, but an aborted dashboard refetch could surface as `premature close` / `stream closed prematurely` at error severity and flow toward Sentry.
- **Root cause:** The central Fastify error handler and dashboard route catch block did not classify expected client disconnects separately from real 5xx backend faults.
- **Prevention rule:** Any browser/E2E-aborted request must be classified before route/error-handler logging and excluded from Sentry capture. Add regression coverage for `premature close`, `ERR_STREAM_PREMATURE_CLOSE`, and closed-request socket resets.
- **Files affected:** `apps/api/src/lib/http-client-abort.ts`, `apps/api/src/lib/http-client-abort.test.ts`, `apps/api/src/plugins/error-handler.ts`, `apps/api/src/plugins/sentry.ts`, `apps/api/src/plugins/sentry-context.test.ts`, `apps/api/src/routes/crm/dashboard.ts`.

### 2026-06-18 INFRA: Realtime Redis connected during HTTP-only QA startup

- **What went wrong:** The Technical Stack browser flow did not use WebSockets, but API startup still emitted `realtime.service` Redis timeout errors when local Redis was absent.
- **Root cause:** Realtime pub/sub and presence Redis clients connected eagerly at module load instead of waiting for publish/subscribe/presence usage.
- **Prevention rule:** Optional realtime infrastructure must lazy-connect for HTTP-only API flows and fail loudly only when the realtime path is invoked.
- **Files affected:** `apps/api/src/services/realtime.service.ts`, `apps/api/src/services/presence.service.ts`, `apps/api/src/plugins/realtime.validateChannel.test.ts`, `apps/web/e2e/technical-stack.spec.ts`.

### 2026-06-18 TESTING: Source readiness map was only component-tested at first

- **What went wrong:** The first verification pass for the Technical Stack source readiness map proved the map in component tests, but the browser E2E still only asserted the broader source-pull/add/save flow.
- **Root cause:** The new UI surface was added after the existing E2E had already covered the workflow, and the page-level assertion was not updated in the same patch.
- **Prevention rule:** Whenever a user-facing surface is added to an existing workflow, update the focused browser E2E to assert that surface by accessible label or role before calling the UX slice verified.
- **Files affected:** `apps/web/e2e/technical-stack.spec.ts`, `apps/web/src/components/cockpit/TechStackCard.tsx`, `apps/web/src/components/cockpit/TechStackCard.test.tsx`, `apps/web/src/styles/cockpit.css`.

### 2026-06-18 UX: Technical stack intake squeezed inside cockpit column

- **What went wrong:** The Technical Stack add path passed page-level overflow checks, but the real account cockpit column squeezed the enabled vendor textarea to about 22px wide. Staged adds also lacked immediate visual proof, and comma-separated quick suggestions went dead after the first token.
- **Root cause:** QA measured the viewport and page shell instead of the live control geometry inside the nested cockpit card. The quick-suggestion search used the whole parsed input instead of the active comma/newline token.
- **Prevention rule:** For cockpit/sidebar cards, browser QA must measure enabled control geometry inside the real region on desktop and mobile. Multi-entry typeahead/search must use the active token, and every add workflow needs immediate status feedback before save.
- **Files affected:** `apps/web/src/components/cockpit/TechStackCard.tsx`, `apps/web/src/components/cockpit/TechStackCard.test.tsx`, `apps/web/src/styles/cockpit.css`, `apps/web/e2e/technical-stack.spec.ts`, `docs/solutions/technical-stack-provider-source-pull.md`.

### 2026-06-18 INFRA: Azure token-key contract drifted from runtime

- **What went wrong:** `infra/azure/main.bicep` still described `integrationTokenKey` as a base64 32-byte value even though the runtime, API boot gate, `.env.example`, and rotation script now require a 64-character hex key from `openssl rand -hex 32`.
- **Root cause:** The secret-format hardening updated app/runtime surfaces first, but the Azure operator-facing IaC contract was not covered by a release policy verifier.
- **Prevention rule:** Any secret format change must update every deployment surface in the same slice and add a policy check for IaC/operator docs when the platform cannot enforce the full shape itself.
- **Files affected:** `infra/azure/main.bicep`, `infra/azure/README.md`, `scripts/verify-azure-infra-policy.mjs`, `scripts/write-release-tool-readiness.mjs`, `package.json`, `docs/solutions/agent-provider-credentials-org-secret-routing.md`, `docs/solutions/deploy-evidence-hard-gate.md`.

### 2026-06-18 DOCKER: Standalone worker runtime parity was unguarded

- **What went wrong:** `apps/worker/Dockerfile` claimed to mirror the root worker target, but its runtime still used an older pnpm version, ran as root, and lacked a container healthcheck.
- **Root cause:** Previous Docker hardening focused on the root multi-target image and OCR package drift. The standalone/Railway-style Dockerfile had no policy test enforcing the same runtime invariants.
- **Prevention rule:** Every standalone service Dockerfile must have a policy test for the deploy invariants it claims to mirror: workspace-pinned package manager, non-root runtime user, owned artifact copy, package-manager pruning, healthcheck, and image probe evidence.
- **Files affected:** `apps/worker/Dockerfile`, `apps/worker/src/lib/worker-dockerfile-policy.test.ts`, `docs/solutions/container-vulnerability-scan-gate.md`.

### 2026-06-18 TOOLING: Source review wave counts double-counted overlaps

- **What went wrong:** The source review plan counted both risk buckets and path groups, so files that matched both could inflate wave totals even though the exact file manifest was unique.
- **Root cause:** The planner used aggregate bucket/path-group counts for `estimatedTouches`, `trackedDirtyCount`, and `untrackedCount` instead of deriving those fields from the de-duplicated wave file manifest.
- **Prevention rule:** Release cleanup plans must compute all operator-facing wave counts from the exact file list they ask reviewers to inspect. Aggregate buckets can guide grouping, but not final counts.
- **Files affected:** `scripts/write-source-review-plan.mjs`, `docs/solutions/deploy-evidence-hard-gate.md`.

### 2026-06-18 TOOLING: Exact source cleanup files were buried in JSON

- **What went wrong:** The cleanup plan had exact files, but reviewers still had to dig through a large JSON artifact to inspect P0/P1 waves.
- **Root cause:** The source plan optimized for machine verification and did not write human review packets with path lists and checklists.
- **Prevention rule:** Any large dirty-source release blocker needs both machine JSON and per-wave human packets: path list, exact checklist, counts, and verification commands.
- **Files affected:** `scripts/write-source-review-plan.mjs`, `docs/solutions/deploy-evidence-hard-gate.md`.

### 2026-06-18 UX: Interactive provider chips kept static chip height

- **What went wrong:** The Technical Stack source-lane chips were converted from static labels into review-filter buttons, but the first CSS pass kept the old compact chip height and failed the 44px mobile touch-target rule.
- **Root cause:** The visual component became an interactive control without immediately re-auditing the component's responsive geometry across enabled and disabled states.
- **Prevention rule:** When turning any visual badge/chip into a button, update min-height/min-width for mobile targets in the same patch and include disabled controls in the browser geometry probe.
- **Files affected:** `apps/web/src/styles/cockpit.css`, `apps/web/src/components/cockpit/TechStackCard.tsx`.

### 2026-06-18 TOOLING: Bundle execution continued after preflight blockers

- **What went wrong:** The release bundle recorded preflight blockers but still entered the evidence command loop by default, so a run with missing live inputs could spend time on tool/source/provider steps before failing.
- **Root cause:** `runBundle()` collected preflight results only for the final artifact; command execution did not fail fast on `preflight.blockingFailures`.
- **Prevention rule:** Release bundles must fail fast on preflight blockers unless `--continue-on-error` is explicitly set for diagnostics. The artifact should show skipped steps with `preflight blockers` and block only on the preflight IDs.
- **Files affected:** `scripts/run-deploy-evidence-bundle.mjs`, `docs/solutions/deploy-evidence-hard-gate.md`.

### 2026-06-18 TOOLING: Release preflight accepted placeholder evidence inputs

- **What went wrong:** Staging preflight could pass with example domains, placeholder tokens, sample security approver emails, and sample approval tickets because the validator only checked presence/non-local shape.
- **Root cause:** The preflight treated "non-empty" as operator-ready and did not reject template values such as `.example` hosts, `<...>` placeholders, `security-owner@example.com`, or `SEC-123`.
- **Prevention rule:** Release preflight must validate both presence and evidence realism. Reject template domains, angle-bracket placeholders, sample tickets/emails, and placeholder token strings in selftests and live preflight probes.
- **Files affected:** `scripts/run-deploy-evidence-bundle.mjs`, `docs/solutions/deploy-evidence-hard-gate.md`.

### 2026-06-18 TOOLING: PowerShell JSON BOM broke disposition preflight

- **What went wrong:** A dummy staging preflight using a PowerShell-created `BIDSTACK_SECRET_DISPOSITION_FILE` failed because the JSON parser rejected the UTF-8 BOM.
- **Root cause:** The bundle preflight and secret evidence writer parsed disposition files with raw `JSON.parse(readFileSync(..., 'utf8'))`, but Windows/PowerShell often writes UTF-8 files with a BOM.
- **Prevention rule:** Release evidence JSON readers that accept operator-authored files must strip a leading UTF-8 BOM before parsing and include a Windows/PowerShell fixture in selftests.
- **Files affected:** `scripts/run-deploy-evidence-bundle.mjs`, `scripts/write-secret-scan-evidence.mjs`, `docs/solutions/deploy-evidence-hard-gate.md`.

### 2026-06-18 PROCESS: Release preflight inputs were scattered

- **What went wrong:** The bundle preflight could report every missing live input, but operators still had to assemble release env variables from multiple evidence docs and script help blocks.
- **Root cause:** Evidence gates were added by family, so the source of truth for load, provider, secret disposition, Sentry, and browser inputs was fragmented.
- **Prevention rule:** Any multi-family release bundle must have one placeholder-only input template that maps directly to preflight requirements. Filled values belong in CI secrets or ignored `deploy-evidence/` files, never source control.
- **Files affected:** `docs/templates/release-evidence.env.example`, `docs/solutions/deploy-evidence-hard-gate.md`.

### 2026-06-18 TOOLING: Release source evidence counted local scratch artifacts

- **What went wrong:** Dirty source evidence counted `.forge/` local run state and generated `apps/web/scripts/_i18n_*` batch files as untracked release source.
- **Root cause:** The source gate correctly trusted Git status, but the ignore rules had not kept up with local WALTEUR/Forge QA artifacts and temporary i18n sweep outputs.
- **Prevention rule:** Any generated agent/run artifact that is not intended source must be ignored before release evidence runs. Keep canonical tools tracked, but ignore their batch outputs and local run logs/screenshots.
- **Files affected:** `.gitignore`, `docs/solutions/deploy-evidence-hard-gate.md`.

### 2026-06-17 TESTING: Provider breakdown helper lost literal id types

- **What went wrong:** The Technical Stack provider review breakdown passed
  focused tests and lint, but web typecheck failed because the helper returned
  `{ id: string }[]` instead of the narrower provider-id union used by the
  component props.
- **Root cause:** TypeScript widened the inline array literal after the counts
  map, and I had not run `tsc` before calling the implementation patch complete.
- **Prevention rule:** For UI summary helpers that feed typed child props, give
  the returned array an explicit domain type before filtering, then run the
  package typecheck immediately after focused tests.
- **Files affected:** `apps/web/src/components/cockpit/TechStackCard.tsx`.

### 2026-06-17 TOOLING: Release readiness probe assumed direct pnpm spawn on Windows

- **What went wrong:** The first release-tool readiness writer failed its live
  probe because `spawnSync('pnpm')` returned `ENOENT` and `spawnSync('pnpm.cmd')`
  returned `EINVAL` on this machine, even though PowerShell could run `pnpm`.
  The same new script also had a `??`/`||` precedence syntax error caught by
  `node --check`.
- **Root cause:** I assumed Windows exposed a `.cmd` pnpm shim and mixed
  nullish coalescing with OR without parentheses in one expression.
- **Prevention rule:** Node-based release tooling that shells out to pnpm on
  Windows must use a dedicated wrapper (`cmd /d /s /c pnpm ...`) and every new
  `.mjs` runner must pass `node --check` before any live probe.
- **Files affected:** `scripts/write-release-tool-readiness.mjs`.

### 2026-06-17 OPS: Secret evidence gate depended on a hidden native Gitleaks install

- **What went wrong:** The deploy secret evidence writer assumed `gitleaks` was
  installed on the release runner, so the gate could fail before producing
  current-commit proof even though Dockerized scanners were already part of the
  release workflow.
- **Root cause:** The secret scanner path was wired differently from Semgrep and
  Trivy, which already use pinned container images for repeatable release
  evidence.
- **Prevention rule:** Release evidence writers must either declare a required
  native binary with a clear preflight or provide a pinned, overrideable
  container fallback. Evidence artifacts must record which runner produced the
  proof.
- **Files affected:** `scripts/write-secret-scan-evidence.mjs`,
  `docs/solutions/deploy-evidence-hard-gate.md`,
  `docs/solutions/security-scan-local-gates.md`.

### 2026-06-17 WEB: Web Sentry entrypoint bypassed privacy helper

- **What went wrong:** `apps/web/src/main.tsx` initialized Sentry directly,
  bypassing the browser `beforeSend` PII scrubber, replay opt-in controls, and
  id-only helper boundary documented in `apps/web/src/lib/sentry.ts`.
- **Root cause:** The production entrypoint and the canonical Sentry helper
  drifted apart, and there was no focused test proving that the app boot path
  uses the helper.
- **Prevention rule:** Web entrypoints must call `initSentry()` from
  `apps/web/src/lib/sentry.ts` and import `Sentry` from that helper for capture
  calls. Keep focused tests for no-DSN behavior, replay opt-in, PII scrubbing,
  and id-only user context before changing browser telemetry.
- **Files affected:** `apps/web/src/main.tsx`,
  `apps/web/src/lib/sentry.ts`, `apps/web/src/lib/sentry.test.ts`.

### 2026-06-17 BUG: Generic tech-stack MCP parser recursed on undefined fields

- **What went wrong:** The first generic Tech Intel MCP parser called its row
  walker recursively for missing optional keys, so a no-signal MCP response
  could hit maximum call stack instead of returning `null`.
- **Root cause:** The walker treated every value as an object candidate and did
  not stop on `undefined`/primitive values before iterating expected provider
  keys.
- **Prevention rule:** Generic external-response walkers must have primitive
  guards before recursive key traversal, and fixtures must include no-signal
  objects such as `{ company: { name } }` so company identity is not mistaken
  for technology evidence.
- **Files affected:** `apps/api/src/providers/company-tech-stack-mcp.ts`,
  `apps/api/src/providers/company-tech-stack-mcp.test.ts`.

### 2026-06-17 TESTING: Account-intel component test reused test ids without cleanup

- **What went wrong:** A new IntelTabs provenance test rendered a solution card
  with the same `data-testid` as a later fallback test, and the later assertion
  failed because both DOM trees were still mounted.
- **Root cause:** The test file did not explicitly clean up between renders, and
  I reused the same fixture id across tests.
- **Prevention rule:** Component test files that render the same component more
  than once with stable test ids must call Testing Library `cleanup()` in
  `afterEach`, or use unique fixture ids per test. Rerun the failed focused
  test before broadening verification.
- **Files affected:** `apps/web/src/components/account-intel/IntelTabs.test.tsx`.

### 2026-06-17 BUG: Technical-stack refresh POST missed its JSON command body

- **What went wrong:** The Technical Stack source pull button could look idle in
  the live app because the refresh POST was sent without a JSON body/content
  type, while the API did not declare an empty command-body contract.
- **Root cause:** Component tests mocked the hook and never exercised the real
  fetch payload shape, so the browser/API path drifted from the intended route
  contract.
- **Prevention rule:** Mutation hooks for write endpoints must send object
  bodies, even `{}` for command POSTs, and must have hook-level regression tests
  for the exact request body. Live browser/API smoke must validate response
  status after button clicks, not only visual state.
- **Files affected:** `apps/web/src/hooks/useCompanyTechnicalStack.ts`,
  `apps/web/src/hooks/apiMutationBodies.test.tsx`,
  `apps/api/src/routes/crm/companies.ts`.

### 2026-06-17 BUG: Open-data refresh passed invalid Wikidata dates to Prisma

- **What went wrong:** A live CI Financial source pull failed with Prisma
  validation because a Wikidata date with unknown month/day precision
  (`+1965-00-00T...`) became an invalid JavaScript `Date`.
- **Root cause:** The external date normalizer matched the date string shape but
  did not reject incomplete calendar precision before persistence.
- **Prevention rule:** External date normalizers must return a valid ISO date or
  `null`. Add fixtures for unknown month/day public data before writing parsed
  provider dates into Prisma `Date` fields.
- **Files affected:** `apps/api/src/providers/company-open-enrichment.ts`,
  `apps/api/src/providers/company-open-enrichment.test.ts`.

### 2026-06-17 TESTING: Package-scoped lint used a repo-relative E2E path

- **What went wrong:** A focused ESLint run under `pnpm --filter @bidstack/web exec` passed `apps/web/e2e/technical-stack.spec.ts`, and ESLint failed because it was already running from `apps/web`.
- **Root cause:** I mixed repo-relative and package-relative paths during a package-scoped command.
- **Prevention rule:** For package-scoped `exec` commands, pass package-relative paths such as `e2e/technical-stack.spec.ts`, or run the command from the repo root with a root-level script. Rerun the failed gate with the corrected path before calling verification green.
- **Files affected:** none.

### 2026-06-17 WEB: Frontend provenance field union lagged API fieldSources

- **What went wrong:** The contract summary provenance change used the `status` field from API `fieldSources`, but the frontend-local `ContractFieldKey` union did not include `status`, so web typecheck failed.
- **Root cause:** The UI duplicated a subset of the API provenance keys instead of deriving or fully mirroring the shared contract field-source surface.
- **Prevention rule:** When rendering field-level provenance from a shared/API `fieldSources` map, update the frontend field-key union and run `pnpm --filter @bidstack/web exec tsc --noEmit --pretty false` before calling the slice green.
- **Files affected:** `apps/web/src/components/account-intel/ContractAgreementsCard.tsx`.

### 2026-06-17 OPS: Deploy checklist could pass without release evidence

- **What went wrong:** The pre-deploy checklist verified code health, but it did not require fresh load, SAST, container, secret-history, or Sentry proof for the actual staging/production release candidate.
- **Root cause:** Deployment readiness was spread across docs and manual notes instead of enforced by a single fail-closed evidence verifier.
- **Prevention rule:** Strict deploy targets must run `pnpm deploy:evidence:staging` or `pnpm deploy:evidence:production` and block when proof artifacts are missing, stale, local-only, or weaker than certification profile.
- **Files affected:** `scripts/verify-deploy-evidence.mjs`, `scripts/ops/deploy-checklist.sh`, `package.json`, `.gitignore`, `docs/solutions/deploy-evidence-hard-gate.md`.

### 2026-06-17 BUG: Enrichment refresh could erase technical-stack provider lanes

- **What went wrong:** Company enrichment refreshes treated provider metadata as
  one replaceable snapshot, so a later open-data refresh could silently drop
  older Apollo, Seamless, or meeting-derived technical stack signals.
- **Root cause:** The upsert path did not preserve provider-owned metadata and
  source-attribution lanes before writing refreshed company enrichment data.
- **Prevention rule:** Provider enrichment writes must merge per-provider
  metadata/source attribution and include multi-provider technical-stack tests
  before adding or changing any source lane.
- **Files affected:** `apps/api/src/services/crm/enrichment.service.ts`,
  `apps/api/src/services/crm/company-enrichment.service.ts`,
  `docs/solutions/technical-stack-provider-source-pull.md`.

### 2026-06-07 BACKEND: Assumed a named integration config constraint existed

- **What went wrong:** The first provider credential live smoke returned `500`
  because the route used `ON CONFLICT ON CONSTRAINT
integration_configs_org_type_name_key`, but the live local DB does not have
  that named constraint. The existing Dust credential route had the same
  fragile assumption.
- **Root cause:** I trusted schema-intent naming without verifying the live
  database constraint inventory before using a named constraint in raw SQL.
- **Prevention rule:** Before using `ON CONFLICT ON CONSTRAINT`, inspect the
  live DB for the constraint or add an additive migration. For compatibility
  credential writes, use transaction-scoped advisory locks plus update-or-insert
  and keep audit writes in the same transaction.
- **Files affected:** `apps/api/src/routes/agent-provider-credentials.routes.ts`,
  `apps/api/src/routes/dust-credentials.routes.ts`.

### 2026-06-07 TESTING: API consumer test ran before shared dist was rebuilt

- **What went wrong:** A focused API helper test failed with an undefined shared schema after `packages/shared` was changed.
- **Root cause:** The API imports shared schemas from the workspace package dist. Running the API consumer test while the shared package build was still in progress meant the consumer saw stale compiled output.
- **Prevention rule:** When shared schemas/types change, complete `pnpm --filter @bidstack/shared build` before running API or web consumer tests.
- **Files affected:** `packages/shared/src/schemas/rfp-agent.schemas.ts`, `apps/api/src/services/agents/agents.helpers.test.ts`.

### 2026-06-07 TESTING: Provider-readiness test assumed Dust env was absent

- **What went wrong:** A provider-readiness test expected Dust to report both missing env keys, but the local machine already had a Dust workspace env value.
- **Root cause:** The test did not own its environment. It relied on developer-machine absence rather than explicitly clearing the env keys relevant to the assertion.
- **Prevention rule:** Tests that assert missing or present env contracts must explicitly set and restore every env key they own.
- **Files affected:** `apps/api/src/services/agents/agents.helpers.test.ts`.

### 2026-06-07 SECURITY: High-only audit gate hid moderate dependency advisories

- **What went wrong:** The high-severity audit gate passed while the dependency graph still contained three moderate advisories: `i18next-http-backend`, `react-router`/`react-router-dom`, and transitive `ws`.
- **Root cause:** The release hygiene check stopped at `--audit-level high`, and the repo's already-dirty manifests/lockfile meant a later `pnpm install` refreshed more lockfile state than the narrow advisory patch alone.
- **Prevention rule:** Enterprise dependency remediation must inspect full `pnpm audit --json`, patch direct deps or compatible overrides surgically, and document any pre-existing lockfile drift before claiming the diff scope.
- **Files affected:** `package.json`, `apps/web/package.json`, `apps/marketing/package.json`, `pnpm-lock.yaml`, `docs/solutions/dependency-audit-zero-advisory-remediation.md`.

### 2026-06-07 TESTING: Opportunity list test assumed first row was a seed fixture

- **What went wrong:** Root `pnpm test` failed because `opportunities.integration.test.ts` expected the first `/api/opportunities?limit=20` item to have an `OP-NNNN` code, but parallel RFP approval tests can create valid `RFP-*` opportunities that sort ahead of seeded records.
- **Root cause:** The test mixed two contracts: tolerant persisted list reads and canonical seed-fixture identity. It relied on `updatedAt` order in a shared test org while API integration files run in parallel.
- **Prevention rule:** List tests in shared test tenants must not infer fixture identity from sorted position. Assert the page item shape separately, then locate the intended fixture by stable DB identity or a scoped search.
- **Files affected:** `apps/api/src/routes/opportunities.integration.test.ts`, `docs/solutions/opportunity-list-tests-must-not-assume-order.md`.

### 2026-06-07 TESTING: Meeting-import tests polluted shared contact baselines

- **What went wrong:** Full web E2E showed contact and responsive visual regressions after earlier meeting-import flows created test contacts in the shared seed organization and left them visible to later screenshots.
- **Root cause:** The account/notes import paths used production-like API flows in tests but did not clean up the generated contacts, notes, tasks, risks, and enrichment rows. Later tests assumed curated seed data but were reading a polluted shared org.
- **Prevention rule:** Any E2E or API test that writes into the shared seed org must clean up its own explicit fingerprints before and after the test. Do not update visual snapshots until shared test-data pollution is ruled out.
- **Files affected:** `apps/web/e2e/fixtures/test-data-cleanup.ts`, `apps/web/e2e/accounts.spec.ts`, `apps/web/e2e/contacts.spec.ts`, `apps/web/e2e/responsive/mobile-iphone-se.spec.ts`, `apps/web/e2e/responsive/mobile-pixel-7.spec.ts`, `apps/web/e2e/responsive/tablet-ipad.spec.ts`, `apps/api/src/routes/notes.test.ts`, `docs/solutions/e2e-meeting-import-test-artifacts.md`.

### 2026-06-07 BUG: Idle cockpit fix missed tab-discard reloads

- **What went wrong:** The account cockpit could still show the fatal "Couldn't load the CRM cockpit" state after a long idle if the browser discarded/reloaded the tab and the next live dashboard request returned a transient 5xx.
- **Root cause:** The first stale-refresh fix protected only React Query's in-memory `data`. A tab discard/reload loses that memory, so the page had no last verified snapshot to render during a transient API/proxy failure.
- **Prevention rule:** Long-lived CRM work surfaces need a tab-scoped, schema-validated fallback for the last verified entity snapshot. Use it only for transient 5xx/network failures, never for 4xx authorization or not-found failures, and clear it on auth cache cleanup.
- **Files affected:** `apps/web/src/pages/DashboardPage.tsx`, `apps/web/src/pages/DashboardPage.test.tsx`, `apps/web/src/lib/queryCache.ts`, `apps/web/src/lib/queryCache.test.ts`, `docs/solutions/account-cockpit-tab-discard-fallback.md`.

### 2026-06-07 BUG: Opportunity reads rejected legacy persisted codes

- **What went wrong:** The full API gate found `GET /api/v1/opportunities?limit=20` could return `500` because response serialization rejected persisted opportunity codes that did not match `OP-NNNN`.
- **Root cause:** The shared read schema reused the write-time canonical code regex, so historical/RFP/test/imported identifiers were treated as invalid at the response boundary.
- **Prevention rule:** Split read and write contracts for identifiers. Reads must tolerate bounded persisted legacy values; writes/imports can enforce the current canonical format.
- **Files affected:** `packages/shared/src/schemas/opportunity.ts`, `packages/shared/src/schemas/opportunity.test.ts`, `docs/solutions/opportunity-code-read-write-contract.md`.

### 2026-06-07 INFRA: Redis health client could stay unhealthy after a transient disconnect

- **What went wrong:** `/readyz` reported `redis:false` and stayed `503` even though Redis was reachable on the configured local port, leaving the API in a degraded state after an idle/startup blip.
- **Root cause:** The shared API Redis client disabled retries/offline queueing for fail-fast commands but had no deliberate reconnect path from ended or closed ioredis states.
- **Prevention rule:** Fail-fast Redis clients still need an explicit readiness/cache reconnect helper. Health checks should call that helper and cache code should reconnect once before falling back to memory.
- **Files affected:** `apps/api/src/redis.ts`, `apps/api/src/lib/redis-cache.ts`, `apps/api/src/routes/health.ts`, `apps/api/src/redis.test.ts`, `docs/solutions/redis-readiness-reconnect.md`.

### 2026-06-07 TESTING: DB probe skipped the app env bootstrap

- **What went wrong:** A direct Prisma/tsx probe failed because `DATABASE_URL` was not loaded in that standalone shell context.
- **Root cause:** I used an ad hoc eval context instead of the package/API test bootstrap that loads the repo's environment configuration.
- **Prevention rule:** When probing database-backed app behavior, use the API route, package tests, or explicitly load the same env bootstrap as the app; do not assume standalone `tsx -` has database config.

### 2026-06-07 BACKEND: Used `$queryRaw` for a void advisory-lock call

- **What went wrong:** The first duplicate-run lock used `tx.$queryRaw` for `SELECT pg_advisory_xact_lock(...)`, and the focused integration test returned a `500` because Prisma could not deserialize the `void` result.
- **Root cause:** I treated every `SELECT` as row-returning instead of matching the raw Prisma method to whether the statement produces data that the application needs.
- **Prevention rule:** Use `$executeRaw` for advisory locks and other side-effect SQL where the result is not consumed; use `$queryRaw` only when the application needs returned rows.
- **Files affected:** `apps/api/src/services/agents/agents.service.ts`, `apps/api/src/routes/agents.integration.test.ts`.

- **Files affected:** none.

### 2026-06-07 TESTING: i18n interpolation was missing in a component test

- **What went wrong:** The full web test gate failed because `CurrencySelector.test.tsx` rendered translated labels without app i18n initialization.
- **Root cause:** The focused test did not import the runtime i18n bootstrap, so interpolation placeholders appeared in assertions.
- **Prevention rule:** Tests that inspect translated/interpolated UI must import `@/i18n` or mock translation with equivalent interpolation behavior.
- **Files affected:** `apps/web/src/components/layout/CurrencySelector.test.tsx`.

### 2026-06-07 TESTING: Full API test gate used too-short timeout

- **What went wrong:** A full API package test run timed out before completion on this machine, then passed with a longer timeout.
- **Root cause:** The command timeout was too low for the current API integration suite size and local database setup.
- **Prevention rule:** Use at least 300 seconds for full API package tests and at least 600 seconds for root `pnpm test`.
- **Files affected:** none.

### 2026-06-06 TOOLING: Forked subagent spawn repeated role-override mistake

- **What went wrong:** I tried to spawn a full-history forked subagent with an explicit `agent_type`, which this tool rejects because forked agents inherit the parent role/model.
- **Root cause:** I repeated an already logged tool constraint instead of using either a non-forked role-specific agent or a forked agent without role overrides.
- **Prevention rule:** For `fork_context: true`, omit `agent_type`, `model`, and `reasoning_effort`; if a specific role is needed, spawn without full-history fork context.
- **Files affected:** none.

### 2026-06-06 TESTING: Root test gate used too-short shell timeout

- **What went wrong:** The first root `pnpm test` run timed out and produced an `EPIPE` artifact even though the later longer run passed.
- **Root cause:** A 240-second command timeout was too short for the full root test gate on this machine.
- **Prevention rule:** Use at least a 600-second timeout for root `pnpm test`, or run targeted package tests before the full gate when iterating.
- **Files affected:** none.

### 2026-06-05 UX: Shared CRM surfaces used automatic glow and shimmer loops

- **What went wrong:** Shared buttons/cards still applied dark-mode pulsing glow or shimmer effects, so routine CRM screens could feel flashy and purple-tinted even after the cursor spotlight animation was removed.
- **Root cause:** The visual system mixed marketing-style ambient motion with enterprise app interaction feedback; shared primitives amplified that pattern across many pages.
- **Prevention rule:** Shared CRM primitives may use tactile hover/press/reveal motion, but must not ship automatic ambient pulse, shimmer, orb, or neon glow loops unless the user explicitly asks for a hero/marketing surface.
- **Files affected:** `apps/web/src/components/ui/Button.tsx`, `apps/web/src/components/ui/Card.tsx`, `apps/web/src/components/ui/GlassCard.tsx`, `apps/web/src/components/layout/RouteProgress.tsx`, `apps/web/src/index.css`.

### 2026-06-05 BUG: Settings admin panels called unbounded backend reads

- **What went wrong:** The Settings page rendered but background requests for lead rot config, email templates, and tags returned 400s from the development query guard.
- **Root cause:** The route handlers used tenant-scoped `findMany` calls without explicit `take` limits. Lead rot then exposed a second bug: synthetic fallback ids were deterministic strings but not valid UUIDs, causing response serialization to return 500.
- **Prevention rule:** Admin/settings reads must be explicitly bounded and must pass the same response schemas as persisted rows; deterministic client placeholders still need valid wire-format ids.
- **Files affected:** `apps/api/src/routes/lead-rot.ts`, `apps/api/src/routes/email-templates.ts`, `apps/api/src/routes/tags.ts`, `apps/api/src/routes/settings-support.integration.test.ts`.

### 2026-06-05 TESTING: Prisma generate raced with API integration tests

- **What went wrong:** I launched Prisma client generation in parallel with an API integration test, so Vitest tried to use the Windows query-engine DLL while generation was replacing it.
- **Root cause:** The generated Prisma client on Windows uses a DLL that can be renamed/replaced during `prisma generate`; tests that import the client must not run at the same time.
- **Prevention rule:** Run `pnpm db:generate` as a sequential preflight before API tests, never in parallel with tests or a live API process that is being verified.
- **Files affected:** generated Prisma client state only.

### 2026-06-05 INFRA: Vite proxy returned API 500s when the API dev server was down

- **What went wrong:** Browser smoke showed the CRM workspace shell but repeated 500s for `/api/v1/...` calls through the Vite dev server.
- **Root cause:** The web dev server was alive on port 5173, but the API process had fallen off port 4000; the Vite proxy surfaced the missing upstream as 500s.
- **Prevention rule:** Local CRM smoke must verify both `/readyz` on the API and page-level network responses; a rendered shell is not enough.
- **Files affected:** runtime dev process state only.

### 2026-06-05 PERFORMANCE: Opportunities list queries timed out without list-view indexes

- **What went wrong:** The opportunities integration test timed out on list and stage-move flows, and logs showed slow `Opportunity.findMany` and `Comment.groupBy` queries.
- **Root cause:** The list route filters by org/deleted status and sorts by updated date, but the database lacked that composite index. Comment count aggregation also filtered deleted comments without a matching composite index.
- **Prevention rule:** Enterprise list views need indexes for the exact filter/order shape used by the API, including soft-delete columns and batch aggregation filters.
- **Files affected:** `packages/db/prisma/schema.prisma`, `packages/db/prisma/migrations/20260605190000_opportunity_list_indexes/migration.sql`.

### 2026-06-05 UX: Dashboard KPI cards overlapped at standard workspace widths

- **What went wrong:** The dashboard KPI cards looked fake and cramped because label, value, and mini-signal content collided at a 1440px workspace viewport.
- **Root cause:** The six-card grid used fixed equal columns, and the compact three-column KPI layout activated too early while the persistent sidebar reduced available content width.
- **Prevention rule:** Dashboard cards with embedded visual signals must use minimum track widths and only switch to inline signal layouts after measuring the real content area, not the raw browser width.
- **Files affected:** `apps/web/src/index.css`, `apps/web/src/styles/org-dashboard.css`.

### 2026-06-05 BUG: Pipeline stage moves confirmed but appeared to snap back

- **What went wrong:** Dragging an opportunity to another pipeline section could show a successful move while the card stayed in the old section or rendered with stale stage data.
- **Root cause:** The frontend optimistic update changed `pipelineStageId` without keeping the human `stage` and populated `pipelineStage` object coherent, so grouped views could still classify the record by stale fields.
- **Prevention rule:** Cache updates for relational status changes must update every field used by grouping, display, and detail views, then reconcile with the server-confirmed response.
- **Files affected:** `apps/web/src/hooks/useStageMutation.ts`, `apps/web/src/hooks/useStageMutation.test.tsx`.

### 2026-06-05 BUG: Direct CRM routes opened the marketing shell in local stub auth

- **What went wrong:** Visiting `/dashboard` or `/pipeline` directly in local dev could show the public landing experience instead of the authenticated CRM workspace.
- **Root cause:** Stub auth initialized as signed out unless a local session key already existed, even though the local API and dev workspace assume a signed-in stub user.
- **Prevention rule:** Local stub auth should default to the authenticated development user and only stay signed out after an explicit stub sign-out flag.
- **Files affected:** `apps/web/src/lib/auth.tsx`, `apps/web/src/lib/auth.test.tsx`.

### 2026-05-31 TESTING: Full E2E timeout produced misleading connection-refused artifacts

- **What went wrong:** I ran the full Playwright suite with a 10-minute shell timeout, which killed the Playwright web server near the end and left failure artifacts showing `ERR_CONNECTION_REFUSED` instead of the real state.
- **Root cause:** The suite takes roughly eight minutes plus build/server startup on this machine, so the shell timeout was too close to the actual gate runtime.
- **Prevention rule:** Full E2E gates need a timeout comfortably above the expected suite duration; if the shell times out, inspect artifacts as timeout fallout before treating connection-refused traces as product bugs.
- **Files affected:** none.

### 2026-05-31 TESTING: Worker Vitest wrapper crashed under package lifecycle on Windows

- **What went wrong:** `pnpm test` failed inside the worker test preflight even though the worker tests passed when run directly from the repo root.
- **Root cause:** The wrapper derived the workspace path from the script URL and then launched Vitest from a package lifecycle cwd; on Windows this combination made the child Vitest process exit before collecting tests.
- **Prevention rule:** Workspace-level helper scripts that may be launched from root or package cwd should discover the repo root from a durable workspace marker such as `pnpm-workspace.yaml`.
- **Files affected:** `scripts/run-worker-tests.mjs`.

### 2026-05-31 BUG: Booking timezone validation rejected slots it had offered

- **What went wrong:** The public booking UI could display an available America/New_York slot, but booking the same wall-clock time could be rejected as unavailable.
- **Root cause:** The timezone conversion path mixed UTC setters with local wall-clock intent and the create route derived the booking date from UTC instead of the visitor/page timezone.
- **Prevention rule:** Calendar availability must centralize IANA timezone conversion and include regression coverage for western timezones where UTC date and local date can differ.
- **Files affected:** `packages/shared/src/calendar/availability.ts`, `packages/shared/src/calendar/availability.test.ts`, `apps/api/src/routes/bookings-public.ts`.

### 2026-05-31 INFRA: Prisma schema drift hid behind generated client success

- **What went wrong:** Proposal-related tests failed earlier because the generated client knew about fields that the local database had not migrated yet.
- **Root cause:** `prisma generate` succeeded, but pending migrations had not been deployed to the active local database.
- **Prevention rule:** When a test fails with a missing database column after typecheck succeeds, check migration status and run migrate deploy against the active test/dev database without printing secrets.
- **Files affected:** database state only.

### 2026-05-30 TESTING: E-signature success locator matched hidden/live copy

- **What went wrong:** After the public signing flow reached confirmation, Playwright still failed because the success locator matched the screen-reader announcement, heading, and body copy at once.
- **Root cause:** The POM used a broad text regex for a terminal state that has multiple valid success strings on the same screen.
- **Prevention rule:** Public flow POMs should assert a unique semantic element for terminal states, usually the visible heading, not broad text that can collide with aria-live or body copy.
- **Files affected:** `apps/web/e2e/pages/PublicSignPage.ts`.

### 2026-05-30 BUG: Internal signing crashed when optional PDF renderer was absent

- **What went wrong:** After the frontend submitted a valid signature, the API returned 500 because `htmlToPdf` treated Puppeteer as optional at startup but threw at runtime with no fallback.
- **Root cause:** The document service had a lazy optional dependency contract without a second renderer path, so the internal provider could not complete in clean installs that lack Puppeteer.
- **Prevention rule:** Optional runtime renderers must have a verified fallback or startup must fail closed before any user can enter the workflow.
- **Files affected:** `apps/api/src/services/documents/document.service.ts`, `apps/api/package.json`, `pnpm-lock.yaml`.

### 2026-05-30 BUG: E-signature submit step lost drawn signature

- **What went wrong:** Full E2E failed because a signer could draw a signature, continue to review, accept terms, and then receive "Signature is missing."
- **Root cause:** The canvas-backed `SignaturePad` unmounted when the flow moved from the sign step to the submit step, so the submit handler could no longer read `padRef.current`.
- **Prevention rule:** Multi-step forms must persist canonical user input before unmounting the step that owns the interactive widget; submit handlers must not depend on refs from previous steps.
- **Files affected:** `apps/web/src/pages/PublicSignPage.tsx`.

### 2026-05-30 TESTING: DB utility script used disallowed console logs

- **What went wrong:** Workspace lint failed because `packages/db/scripts/drop-index.ts` used `console.log`, while the repo lint policy only allows `console.error` and `console.warn`.
- **Root cause:** A utility script used casual status logging instead of the repo-approved output path.
- **Prevention rule:** CLI utility status output should use `process.stdout.write` or the package logger; reserve `console.error/warn` for actual errors and warnings.
- **Files affected:** `packages/db/scripts/drop-index.ts`.

### 2026-05-30 TESTING: Root lint hid the package-level JSX escape error

- **What went wrong:** The root lint gate returned exit code 1 with no useful detail until package-level lint exposed `react/no-unescaped-entities` in the public booking confirmation copy.
- **Root cause:** A JSX apostrophe in user-facing copy was not escaped, and the recursive lint wrapper did not surface package output reliably in this shell.
- **Prevention rule:** When root lint fails without detail, run targeted package lint immediately; JSX copy must escape apostrophes or use string expressions.
- **Files affected:** `apps/web/src/pages/PublicBookingPage.tsx`.

### 2026-05-30 BUG: Booking create recomputed availability without visitor timezone

- **What went wrong:** The public booking UI showed a slot from the timezone-aware availability endpoint, but submitting the same slot could return "That time is no longer available."
- **Root cause:** `POST /booking-pages/:slug/bookings` accepted `tz` but did not pass it into `computeSlots`, so creation validation used UTC while availability used the visitor timezone.
- **Prevention rule:** Reservation-style create endpoints must replay the exact same validation inputs as their preview/availability endpoints.
- **Files affected:** `apps/api/src/routes/bookings-public.ts`, `apps/api/src/routes/bookings.helpers.ts`.

### 2026-05-30 UX: Selected integration tab failed contrast and dashboard chart had invalid ARIA

- **What went wrong:** Axe found a low-contrast selected integration tab eyebrow and an ARIA label on a generic dashboard chart wrapper.
- **Root cause:** The selected tab reused muted text on a tinted background, and the decorative chart container had `aria-label` without an explicit semantic role.
- **Prevention rule:** When adding ARIA labels to non-interactive visual wrappers, provide a valid role or keep them decorative; selected states must use foreground tokens with WCAG AA contrast on tinted surfaces.
- **Files affected:** `apps/web/src/pages/integrations/ConnectionCommandCenter.tsx`, `apps/web/src/components/dashboard/widgets/PipelineCard.tsx`.

### 2026-05-30 TESTING: Core Web Vitals suite self-contended under full parallelism

- **What went wrong:** The expanded E2E cluster reported extreme LCP failures on dashboard, pipeline, leads, and opportunities, but the Web Vitals suite passed when run alone with one worker.
- **Root cause:** The performance file inherited Playwright `fullyParallel`, so multiple lab measurements hit the same preview/API server at once and measured local contention instead of route paint quality.
- **Prevention rule:** Performance-budget specs must opt into serial execution, and the default E2E gate should use one worker unless the harness provisions isolated servers per worker.
- **Files affected:** `apps/web/e2e/performance/core-web-vitals.spec.ts`.

### 2026-05-30 INFRA: Static app-shell cache lookup respected `Vary: Origin`

- **What went wrong:** The service worker served the offline HTML shell, but module scripts such as `index`, `react`, and `react-dom` still failed to load offline.
- **Root cause:** The service worker cached static assets from its own fetch context, while Vite responses include `Vary: Origin`; later page module requests had different request headers, so `cache.match(request)` missed valid cached assets.
- **Prevention rule:** For same-origin hashed static app-shell assets, use `cache.match(request, { ignoreVary: true })`; keep API/data cache lookups strict.
- **Files affected:** `apps/web/public/sw.js`.

### 2026-05-30 TESTING: PWA E2E used a fixed readiness sleep

- **What went wrong:** The offline app-shell test passed in isolation but failed under parallel load because it switched the browser offline after a fixed 1-second delay.
- **Root cause:** The test waited for time instead of waiting for an active service worker controller and verified Cache Storage entries for the app shell.
- **Prevention rule:** PWA tests must wait on browser readiness signals and cached app-shell assets, never arbitrary sleeps, before forcing offline mode.
- **Files affected:** `apps/web/e2e/flows/pwa-offline.spec.ts`.

### 2026-05-30 INFRA: PWA warmup used conditional cache responses

- **What went wrong:** Offline reload still failed because core JS chunks such as `index`, `react`, `router`, and `vendor` were not available from Cache Storage.
- **Root cause:** `cache.add` allowed browser conditional-cache behavior during warmup; trace showed service-worker warmup requests with validators and empty captured bodies.
- **Prevention rule:** PWA warmup for app-shell JS/CSS must fetch with `cache: "reload"` and then `cache.put` the full response explicitly.
- **Files affected:** `apps/web/public/sw.js`, `apps/web/src/main.tsx`.

### 2026-05-30 BUG: Service worker served stale booking availability API data

- **What went wrong:** The public booking UI showed a slot that the booking mutation then rejected as no longer available.
- **Root cause:** The service worker used stale-while-revalidate for all GET API calls, including booking availability where stale data is unsafe.
- **Prevention rule:** Service workers must use network-first for API data and avoid stale responses for reservation, auth, permission, or financial reads.
- **Files affected:** `apps/web/public/sw.js`.

### 2026-05-30 TESTING: Booking confirmation selector matched heading and copy

- **What went wrong:** The full booking E2E succeeded in the UI but failed strict mode because the confirmation locator matched both the heading and supporting copy.
- **Root cause:** The POM used broad page text instead of the stable confirmation heading.
- **Prevention rule:** Success-state POM locators must target a single role or test id, especially when headings and body copy intentionally repeat the same concept.
- **Files affected:** `apps/web/e2e/pages/PublicBookingPage.ts`.

### 2026-05-30 INFRA: PWA page-side cache warming was load-sensitive

- **What went wrong:** The offline app-shell test passed in isolation but failed in a parallel E2E cluster.
- **Root cause:** Page-side cache warming could still be racing with the test's offline switch under load, leaving hashed Vite chunks uncached.
- **Prevention rule:** Service worker install must deterministically cache build-manifest assets; page-side cache warming is only a supplemental fallback.
- **Files affected:** `apps/web/public/sw.js`, `apps/web/src/main.tsx`.

### 2026-05-30 BUG: Public booking availability used unbounded reads

- **What went wrong:** The public booking flow seeded `test-slug`, but availability returned 400 because the query guard rejected unbounded calendar-event and booking lookups.
- **Root cause:** The route scoped by org/page/time range but did not include explicit `take` limits, so the development query guard correctly treated the reads as unsafe.
- **Prevention rule:** Any `findMany` added to request paths must include an explicit, business-justified bound and deterministic order before E2E coverage depends on the route.
- **Files affected:** `apps/api/src/routes/bookings-public.ts`, `apps/api/src/routes/bookings-pages.ts`.

### 2026-05-30 INFRA: Offline app shell missed hashed Vite assets

- **What went wrong:** After the service worker served `/dashboard` offline, the React app still did not render a main landmark.
- **Root cause:** The service worker cached the HTML shell, but the first controlled page did not reliably cache the hashed JS/CSS assets before Playwright switched the browser offline.
- **Prevention rule:** Production PWAs must warm the app-shell cache with the current document's hashed scripts and styles, not only `/` and `/index.html`.
- **Files affected:** `apps/web/src/main.tsx`, `apps/web/public/sw.js`.

### 2026-05-30 TOOLING: Root tsx could not resolve package-local dotenv-flow

- **What went wrong:** I tried to inspect booking data with root `pnpm exec tsx`, but the script imported `dotenv-flow`, which is available to the DB package rather than the root runtime.
- **Root cause:** I used the wrong workspace package context for a package-local inspection.
- **Prevention rule:** Run ad-hoc package inspections with `pnpm --filter <package> exec` or use package-local scripts so dependency resolution matches the code being inspected.
- **Files affected:** none.

### 2026-05-30 BUG: Deferred UI persistence fallback used narrowed window

- **What went wrong:** Web typecheck failed because the `requestIdleCallback` branch narrowed `window` such that `window.setTimeout` was typed as unavailable in the fallback.
- **Root cause:** I used `window.setTimeout` after an `in` guard instead of the safer `globalThis.setTimeout`.
- **Prevention rule:** When feature-detecting optional browser APIs, use `globalThis.setTimeout` or capture fallback functions before narrowing.
- **Files affected:** `apps/web/src/stores/ui.ts`.

### 2026-05-30 TESTING: Full E2E failure summary was hidden by noisy logs

- **What went wrong:** The full Playwright run failed, but the terminal output was dominated by web-server logs and truncated before the actual failure list.
- **Root cause:** I relied on raw command output instead of immediately reading `apps/web/test-results` artifacts after a large run.
- **Prevention rule:** For full E2E runs, inspect Playwright artifacts first after any non-zero exit; use terminal output only as supplemental context.
- **Files affected:** none.

### 2026-05-30 TESTING: Booking availability POM returned before terminal state

- **What went wrong:** `/book/test-slug` showed "Booking page not found", but the POM marked the page available because it checked while the loading heading was visible and before the fetch failure rendered.
- **Root cause:** The availability helper checked for a heading instead of waiting for either a usable booking calendar/time-slot or the not-found error state.
- **Prevention rule:** Public-flow availability helpers must wait for a terminal UI state before deciding to run or skip a flow.
- **Files affected:** `apps/web/e2e/pages/PublicBookingPage.ts`.

### 2026-05-30 TESTING: Workflow POM used an ambiguous creation button

- **What went wrong:** The workflow builder test failed strict mode because the page intentionally renders "New workflow" in both the toolbar and empty state.
- **Root cause:** The POM selected by broad accessible name without scoping to the first primary creation affordance.
- **Prevention rule:** When a page has duplicate empty-state and toolbar actions, POMs must scope to a stable region or intentionally select `.first()` with the UX rationale.
- **Files affected:** `apps/web/e2e/pages/WorkflowBuilderPage.ts`.

### 2026-05-30 INFRA: Service worker did not serve SPA routes offline

- **What went wrong:** Reloading `/dashboard` offline failed with `net::ERR_FAILED` even after the service worker registered.
- **Root cause:** The service worker cached `/` and `/index.html` but did not use an app-shell fallback for navigation requests like `/dashboard`.
- **Prevention rule:** PWA service workers for SPA routes must detect navigation requests and fall back to cached `/index.html` when the network is unavailable.
- **Files affected:** `apps/web/public/sw.js`.

### 2026-05-30 UX: Sales dashboard microcopy failed contrast

- **What went wrong:** Axe reported serious color contrast failures on tiny uppercase product-category labels in the sales dashboard table.
- **Root cause:** The label used tertiary text at 10px on a subtle blue row bar, below WCAG AA for normal text.
- **Prevention rule:** Text below 18px must use a token with proven 4.5:1 contrast, especially on colored or tinted table backgrounds.
- **Files affected:** `apps/web/src/pages/SalesDashboardPage.tsx`.

### 2026-05-30 TESTING: Custom object spec used broad text selector

- **What went wrong:** After the create flow rendered correctly, the spec still failed because `getByText(/objectName/i)` matched both the object label and the generated API key.
- **Root cause:** The assertion used page-wide text instead of the durable list item test id introduced for custom object cards.
- **Prevention rule:** For records that render both human labels and derived keys, assert against the row/card container or a role with a precise accessible name.
- **Files affected:** `apps/web/e2e/flows/custom-objects.spec.ts`.

### 2026-05-30 TESTING: Captured stale GET response after custom object create

- **What went wrong:** I added a post-create list response assertion, but the Playwright response predicate matched an earlier in-flight GET instead of the refetch caused by the create mutation.
- **Root cause:** The response predicate checked only method and URL, not whether the response was causally after the POST or contained the created object from the POST body.
- **Prevention rule:** E2E create-to-list assertions should derive the canonical selector from the mutation response and then assert the rendered item, not infer causality from a broad GET response matcher.
- **Files affected:** `apps/web/e2e/pages/CustomObjectsAdminPage.ts`.

### 2026-05-30 TOOLING: Ran direct Prisma inspection without loading API env

- **What went wrong:** I tried a direct Prisma inspection command from the API package, but `DATABASE_URL` was not loaded in that shell.
- **Root cause:** I assumed the E2E web server environment would carry into a separate `pnpm exec tsx` process.
- **Prevention rule:** Use existing API routes or app test harnesses for DB observations unless the shell explicitly loads the same env contract without printing secrets.
- **Files affected:** none.

### 2026-05-30 TESTING: Custom object create succeeded but list selector stayed stale

- **What went wrong:** After fixing the backend create path, the focused E2E still failed because the admin list did not visibly expose the created object before the assertion.
- **Root cause:** I verified the API mutation before proving the UI list contract and selector contract were aligned after cache invalidation.
- **Prevention rule:** For create-to-list flows, assert all three layers explicitly: mutation response, refetched list payload, and scoped visible list item.
- **Files affected:** `apps/web/e2e/pages/CustomObjectsAdminPage.ts`, `apps/web/src/hooks/useCustomObjects.ts`.

### 2026-05-30 TOOLING: Assumed Playwright artifacts were rooted at workspace

- **What went wrong:** I tried to read a Playwright `test-results` artifact from the repository root after a filtered web E2E run.
- **Root cause:** The filtered package command writes artifacts under `apps/web/test-results`, not the root-level path shown in condensed Playwright output.
- **Prevention rule:** Resolve package-scoped Playwright artifacts from the package directory before opening screenshots, traces, or error contexts.
- **Files affected:** none.

### 2026-05-30 TESTING: Custom object creation did not prove list persistence

- **What went wrong:** The custom object E2E flow clicked create and waited for the object name in the admin list, but the product path did not reliably surface the newly created object.
- **Root cause:** The creation flow returned to a UI state before proving the canonical list had refetched or rendered the new object.
- **Prevention rule:** Creation flows must wait on the API mutation and then render/refetch durable list state with a user-visible success affordance.
- **Files affected:** `apps/api/src/services/custom-object.helpers.ts`, `apps/api/src/services/custom-object.service.ts`, `apps/web/src/hooks/useCustomObjects.ts`, `apps/web/src/pages/CustomObjectsAdminPage.tsx`, `apps/web/e2e/pages/CustomObjectsAdminPage.ts`.

### 2026-05-30 TESTING: E2E helpers raced valid/invalid public states

- **What went wrong:** Focused E2E still failed after product fixes because the signing helper checked invalid-link state before the public request finished, and the lead helper fell through even though the conversion button rendered.
- **Root cause:** The POM contracts were less specific than the product UI: public signing needed to wait for terminal states, and lead conversion needed to target the actual conversion CTA instead of a broad regex that can collide with other controls.
- **Prevention rule:** E2E page objects must wait for a clear terminal state and use stable, scoped selectors for primary business actions.
- **Files affected:** `apps/web/e2e/pages/PublicSignPage.ts`, `apps/web/e2e/flows/lead-management.spec.ts`.

### 2026-05-30 TESTING: Full E2E run exhausted public exchange-rate rate limit

- **What went wrong:** Full `pnpm e2e` produced `/api/v1/exchange-rates` 429 responses that surfaced as page console errors and failed the account cockpit regression.
- **Root cause:** Every app-shell page could independently request exchange rates while the API capped the cached public endpoint at only 30 requests per minute per IP.
- **Prevention rule:** Shared app-shell data must dedupe client requests, keep safe fallbacks on transient failures, and use rate limits sized for multi-page browser sessions.
- **Files affected:** `apps/web/src/stores/currency.ts`, `apps/api/src/routes/exchange-rates.ts`.

### 2026-05-30 TOOLING: Worker root typecheck replayed stale incremental diagnostics

- **What went wrong:** Root `pnpm typecheck` reported missing Dust symbols that were no longer present in the current worker source, while direct worker typecheck passed.
- **Root cause:** The worker package inherited `"incremental": true` from the base TypeScript config, leaving root recursive typecheck vulnerable to stale `.tsbuildinfo` diagnostics after rapid queue-file edits.
- **Prevention rule:** Release-gate typecheck scripts for fragile worker packages should run non-incrementally; builds may stay incremental, but validation must read current source.
- **Files affected:** `apps/worker/package.json`, `docs/solutions/production-gate-noise.md`.

### 2026-05-30 TESTING: RFP extractor helper exported stale Dust API

- **What went wrong:** Root `pnpm typecheck` failed because `rfp-requirement-extract.helpers.ts` referenced `DustClient` without importing it and `rfp-requirement-extract.processor.ts` imported a stale `DUST_AGENT_ID` export.
- **Root cause:** The RFP extractor files were left between the old global Dust-client pattern and the newer org-scoped credential pattern used by section draft, compliance, legal scan, and QA review workers.
- **Prevention rule:** RFP worker Dust migrations must be done by queue family, not one file at a time; helper exports and processor imports need to be verified together under root `pnpm typecheck`.
- **Files affected:** `apps/worker/src/queues/rfp-requirement-extract.helpers.ts`, `apps/worker/src/queues/rfp-requirement-extract.processor.ts`.

### 2026-05-30 TESTING: Root typecheck caught compliance-fill Dust constant drift

- **What went wrong:** Root `pnpm typecheck` failed because `apps/worker/src/queues/rfp-compliance-fill.ts` referenced `DUST_AGENT_ID` without a valid module-level definition.
- **Root cause:** The compliance-fill worker was partially migrated toward org-scoped Dust credentials but still used an old global constant name in the call path.
- **Prevention rule:** When migrating RFP workers to per-org Dust credentials, replace both client creation and agent-id resolution in the same patch, then verify with the root typecheck gate.
- **Files affected:** `apps/worker/src/queues/rfp-compliance-fill.ts`.

### 2026-05-30 TESTING: Worker legal scan lost Dust symbols

- **What went wrong:** `pnpm typecheck` failed because `apps/worker/src/queues/rfp-legal-scan.ts` referenced `getDustClient` and `DUST_AGENT_ID` without importing or defining them.
- **Root cause:** The worker legal-scan implementation depended on Dust integration symbols that were not wired in the module, and the earlier gate pass happened before the dependency sync exposed the current compile state.
- **Prevention rule:** When adding or modifying worker queues, run package-level and root typecheck immediately, and read existing Dust client helper patterns before referencing shared integration symbols.
- **Files affected:** `apps/worker/src/queues/rfp-legal-scan.ts`.

### 2026-05-30 SECURITY: Dependency audit blocked on transitive tmp advisory

- **What went wrong:** `pnpm audit --audit-level high` failed because tooling packages pulled `tmp@0.2.5`, which is affected by GHSA-ph9p-34f9-6g65.
- **Root cause:** Existing pnpm overrides covered several advisories but did not pin the vulnerable `tmp` transitive dependency to the patched release.
- **Prevention rule:** After every dependency-audit fix, rerun the audit and keep security overrides current for transitive tooling dependencies that upstream packages have not yet bumped.
- **Files affected:** `package.json`, `pnpm-lock.yaml`.

### 2026-05-30 TOOLING: Did not strip lifecycle env for worker Vitest

- **What went wrong:** Direct Node/Vitest worked from a normal shell, but the same command failed when launched by `pnpm test` because lifecycle env vars were still inherited.
- **Root cause:** I changed the command path but not the child process environment, so the worker test still ran inside pnpm's lifecycle context.
- **Prevention rule:** For fragile process-pool gates, use a dedicated runner script that spawns the test process with a deliberately filtered environment.
- **Files affected:** `scripts/run-worker-tests.mjs`, `apps/worker/package.json`, `package.json`.

### 2026-05-30 TOOLING: Let pnpm lifecycle launch the fragile worker Vitest binary

- **What went wrong:** The worker test still failed under `pnpm test` even with explicit Vitest flags, while direct `node node_modules/vitest/vitest.mjs ...` passed.
- **Root cause:** The remaining instability was in the package-manager lifecycle wrapper around the Vitest binary, not the assertions or the chosen pool mode.
- **Prevention rule:** For fragile Windows process-pool gates, launch the local tool entrypoint with `node` directly from the package script and keep the exact flags visible.
- **Files affected:** `apps/worker/package.json`.

### 2026-05-30 TOOLING: Assumed Vitest was hoisted at the workspace root

- **What went wrong:** I tried to inspect `node_modules/vitest`, but this pnpm workspace does not expose Vitest at the root path.
- **Root cause:** I forgot pnpm keeps package executables/dependencies linked per workspace package unless explicitly hoisted.
- **Prevention rule:** Inspect `apps/<package>/node_modules` or use `pnpm --dir <package> exec` when resolving package-local tooling.
- **Files affected:** none; inspection command only.

### 2026-05-30 TOOLING: Relied on worker Vitest config for critical pool flags

- **What went wrong:** `pool: 'vmThreads'` in `apps/worker/vitest.config.ts` still produced a blank failing package script, while passing the same pool flags explicitly on the Vitest CLI succeeded.
- **Root cause:** The critical runner settings were hidden behind config-loader behavior; the package script did not make the intended pool mode observable at the command line.
- **Prevention rule:** Put fragile release-gate runner flags directly in the package script, even if they are also represented in config, so root logs show the actual execution mode.
- **Files affected:** `apps/worker/package.json`.

### 2026-05-30 TOOLING: Kept chasing fork-pool mitigations after IPC stayed flaky

- **What went wrong:** Serial fork modes still intermittently failed with Tinypool `ERR_IPC_CHANNEL_CLOSED`; even direct package-directory runs could fail after prior fork failures.
- **Root cause:** The core instability was the child-process fork channel itself, not only pnpm recursion, file parallelism, or test ordering.
- **Prevention rule:** When an error is in the pool transport layer, validate a different transport (`vmThreads`) instead of stacking more mitigations onto the same failing transport.
- **Files affected:** `apps/worker/vitest.config.ts`.

### 2026-05-30 TOOLING: Used pnpm filter run for worker tests

- **What went wrong:** `pnpm --filter @bidstack/worker test` failed with Tinypool `ERR_IPC_CHANNEL_CLOSED`, while `pnpm test` from `apps/worker` passed.
- **Root cause:** `pnpm --filter ... test` still uses pnpm's recursive run wrapper, which is fragile for this worker/Vitest/fork-pool package on Windows.
- **Prevention rule:** For root scripts that need this worker package, invoke it with `pnpm --dir apps/worker test` or direct `exec`, not filtered recursive run.
- **Files affected:** `package.json`.

### 2026-05-30 TOOLING: Left worker Vitest file isolation enabled

- **What went wrong:** The root test gate still hit `ERR_IPC_CHANNEL_CLOSED` after moving worker tests earlier and disabling file parallelism.
- **Root cause:** Vitest was still creating isolated fork workers per file; removing parallelism reduced concurrency but did not remove fork churn.
- **Prevention rule:** For packages with queue/process-pool tests on Windows, stabilize both dimensions: disable file parallelism and disable per-file isolation, then verify with repeated package and root runs.
- **Files affected:** `apps/worker/vitest.config.ts`.

### 2026-05-30 TOOLING: Assumed the i18n module filename

- **What went wrong:** I tried to open `apps/web/src/i18n/i18n.ts`, but the i18n singleton lives in `apps/web/src/i18n/index.ts`.
- **Root cause:** I inferred the module path from the test filename instead of using the search results first.
- **Prevention rule:** When a directory has an `index.ts`, inspect exports/search results before opening a guessed sibling filename.
- **Files affected:** none; inspection command only.

### 2026-05-30 TOOLING: Ran worker tests after API in the same root shell

- **What went wrong:** Even after removing the worker from pnpm recursive streaming, `pnpm test` still failed when the root script launched worker tests after the heavy API suite in the same shell chain.
- **Root cause:** The worker's fork-based Vitest pool is sensitive to inherited process state/resource pressure after the API test suite; the package test is stable when launched before API or as an isolated command.
- **Prevention rule:** Run worker/queue packages that own process pools before heavy API/browser suites in aggregate release scripts, and document ordering as part of the gate contract.
- **Files affected:** `package.json`.

### 2026-05-30 TOOLING: Assumed package-local worker pass solved recursive root runner

- **What went wrong:** After stabilizing `pnpm --filter @bidstack/worker test`, the root `pnpm test` still failed when pnpm launched the worker through the recursive `-r --stream` wrapper after the API package.
- **Root cause:** I fixed Vitest's per-package parallelism but left the more fragile pnpm recursive wrapper path in the release gate.
- **Prevention rule:** When a gate fails only under the aggregate runner, verify both the package script and the aggregate orchestration; isolate fragile packages out of recursive streaming if they own child processes or worker pools.
- **Files affected:** `package.json`, `apps/worker/vitest.config.ts`.

### 2026-05-30 TOOLING: Trusted one worker thread-pool pass before default-script verification

- **What went wrong:** I changed the worker Vitest pool to `threads` after a direct CLI pass, but the default package script then crashed on Windows with exit `3221225477`.
- **Root cause:** I treated one alternate-command pass as enough evidence for a persistent runner config, before verifying the actual package script users and CI run.
- **Prevention rule:** Runner/config changes must be validated through the package's default script before considering them viable; direct override commands are only probes.
- **Files affected:** `apps/worker/vitest.config.ts`, `docs/solutions/production-gate-noise.md`.

### 2026-05-30 INFRA: Worker Vitest fork pool closed IPC channel after passing tests

- **What went wrong:** The worker package tests passed their assertions but the release gate still failed with Tinypool `ERR_IPC_CHANNEL_CLOSED` during process-pool shutdown.
- **Root cause:** The worker Vitest config used the `forks` pool, which is more fragile on this Node/Vitest combination than the thread pool even though document extraction tests spawn their own `worker_threads`.
- **Prevention rule:** Prefer a proven runner mode over a theoretical isolation mode; if a package needs sandbox worker coverage, verify the full package under the chosen Vitest pool and document why.
- **Files affected:** `apps/worker/vitest.config.ts`.

### 2026-05-30 TOOLING: Let fastify-plugin erase typed options

- **What went wrong:** I added a typed cache plugin option but wrapped the inline function with `fp(...)` in a way that TypeScript inferred `Record<never, never>`, breaking `pnpm --filter @bidstack/api typecheck`.
- **Root cause:** I assumed the `FastifyPluginAsync<Options>` annotation on an inline exported const would survive the `fastify-plugin` wrapper inference.
- **Prevention rule:** For Fastify plugins with options, type the implementation function first, then wrap/export it with `fp(...)` so plugin options remain visible to TypeScript.
- **Files affected:** `apps/api/src/plugins/redis-cache.ts`.

### 2026-05-30 TOOLING: Passed Playwright grep through the root script incorrectly

- **What went wrong:** I ran `pnpm e2e --grep @bundle`, which the root script forwarded as `playwright test "--grep"` without the grep value, causing Playwright to fail argument parsing.
- **Root cause:** I forgot that pnpm script argument forwarding around options needs an explicit separator or a direct filtered command.
- **Prevention rule:** For Playwright options, prefer `pnpm --filter @bidstack/web exec playwright test --grep "<tag>"` so option values are preserved.
- **Files affected:** none; verification command only.

### 2026-05-30 TOOLING: PowerShell split an `rg` alternation pattern

- **What went wrong:** A multi-alternation `rg` command for frontend imports was parsed by PowerShell as multiple arguments and paths, producing file/path errors instead of search results.
- **Root cause:** I used shell-sensitive quoting for a complex regex instead of either single-quoting the whole pattern carefully or running smaller searches.
- **Prevention rule:** On Windows, keep `rg` regexes simple or run several narrow searches; avoid mixed quote/pipe patterns that PowerShell can reinterpret.
- **Files affected:** none; inspection command only.

### 2026-05-30 TOOLING: Assumed Vite manifest path existed

- **What went wrong:** I tried to read `apps/web/dist/.vite/manifest.json`, but the current Vite build does not emit a `.vite` manifest.
- **Root cause:** I trusted the optional path mentioned in the bundle-budget test before checking whether `build.manifest` is enabled.
- **Prevention rule:** Check filesystem output before opening optional build artifacts; when absent, use the test's fallback path or inspect `dist/assets`.
- **Files affected:** none; inspection command only.

### 2026-05-30 TOOLING: Assumed logger test filename existed

- **What went wrong:** I tried to read `apps/api/src/lib/logger.test.ts`, but this workspace did not have a logger-specific test file yet.
- **Root cause:** I inferred a natural test filename from the module path instead of discovering existing test coverage with `rg` first.
- **Prevention rule:** Search for existing tests before opening assumed filenames; if no test exists, create one intentionally after inspecting local test conventions.
- **Files affected:** none; inspection command only.

### 2026-05-30 BUG: Cache invalidation happened after mutation responses

- **What went wrong:** A mutation followed immediately by a read could still receive stale cached data because the cache plugin invalidated in `onResponse`, after Fastify had already completed the response lifecycle visible to the caller.
- **Root cause:** I treated `onResponse` as a safe invalidation point for read-after-write behavior instead of using a pre-send hook.
- **Prevention rule:** Cache invalidation that protects read-after-write consistency must happen before the mutation response is released, such as in `onSend`, not in post-response cleanup.
- **Files affected:** `apps/api/src/plugins/redis-cache.ts`, `apps/api/src/plugins/redis-cache.test.ts`.

### 2026-05-30 TESTING: Cache invalidation test assigned auth too late

- **What went wrong:** The cache invalidation regression still failed after the helper fix because the test assigned `req.auth` inside route handlers, while the cache plugin invalidation hook reads auth from the normal pre-handler lifecycle.
- **Root cause:** The test stub did not mirror production auth timing, where the auth plugin decorates the request before protected route handlers run.
- **Prevention rule:** Tests for hooks that inspect request auth must assign auth in `preHandler` or use `buildServer`; assigning auth inside the route only validates handler-local behavior.
- **Files affected:** `apps/api/src/plugins/redis-cache.test.ts`.

### 2026-05-30 BUG: Cache invalidation trusted only the Redis branch

- **What went wrong:** The concurrent-cache test pass exposed that `cacheDel` could leave stale fallback in-memory entries when Redis was considered connectable but the cached value had been written to the fallback map.
- **Root cause:** `cacheDel` returned after the Redis `KEYS/DEL` path and did not always clear the process-local fallback cache.
- **Prevention rule:** Multi-layer cache invalidation must clear every layer every time; optimized external cache paths must not short-circuit local fallback cleanup.
- **Files affected:** `apps/api/src/lib/redis-cache.ts`, `apps/api/src/plugins/redis-cache.test.ts`.

### 2026-05-30 TOOLING: Assumed collaboration test filename existed

- **What went wrong:** I tried to read `apps/api/src/routes/collaboration.test.ts`, but that test file does not exist in this workspace.
- **Root cause:** I inferred a conventional route test filename instead of using `rg` first to discover actual coverage.
- **Prevention rule:** Before opening an assumed test filename, search for the route or endpoint string with `rg` and then read the discovered files.
- **Files affected:** none; inspection command only.

### 2026-05-25 UX: Local CRM was allowed to render while auth mode emitted Clerk-key errors

- **What went wrong:** A bare `vite` local server could show CRM pages while the browser console still recorded `VITE_CLERK_PUBLISHABLE_KEY` auth failures, making the app look functional but poisoning QA signal.
- **Root cause:** The runtime auth guard mixed production fail-closed behavior with local stub fallback, while the real production guarantee already belongs in the Vite production build gate.
- **Prevention rule:** Keep runtime auth mode explicit: `VITE_AUTH_MODE=clerk` requires a Clerk key, while local/stub execution must remain deterministic and quiet. Verify served source and page state when browser console history is sticky.
- **Files affected:** `apps/web/src/lib/auth.tsx`, `apps/web/src/main.tsx`.

### 2026-05-25 TESTING: RFP extraction test over-claimed critical risk

- **What went wrong:** The new worker test expected `must provide SOC 2 Type II evidence` to classify as `critical`, but the implemented classifier correctly treats ordinary mandatory/security evidence as `high` unless it also carries hard-disqualifier, deadline, breach, or privacy language.
- **Root cause:** I wrote the assertion before aligning the test with the risk rubric encoded in `requirementPriority`.
- **Prevention rule:** When adding tests for heuristics, first name the rubric boundaries in the assertion and reserve `critical` for explicit critical signals, not every mandatory requirement.
- **Files affected:** `apps/worker/src/queues/document-extract.test.ts`.

### 2026-05-22 SECURITY: Invoice lines validated product IDs too late

- **What went wrong:** `POST /api/invoices` accepted a line item `productId` from another tenant and only failed when Prisma hit the invoice-line foreign key, returning a generic 400/500-shaped persistence failure instead of a tenant-aware 404.
- **Root cause:** The invoice route trusted nested relation IDs while building `lines.create` and did not reuse the shared tenant-ownership guard before writing.
- **Prevention rule:** Every mutation that accepts related IDs must validate those IDs by `{ id, orgId }` before persistence; nested Prisma writes are never the first tenant boundary.
- **Files affected:** `apps/api/src/routes/invoices.ts`.

### 2026-05-19 TESTING: Ran preview E2E before rebuilding dist

- **What went wrong:** After changing `CommandPalette.tsx`, I reran Playwright preview E2E without rebuilding `apps/web/dist`, so the test executed the stale bundle and repeated the same failure.
- **Root cause:** I forgot this repo's E2E script uses `vite preview`, not the dev server, when `E2E_BASE_URL` is unset.
- **Prevention rule:** After frontend code changes, run `pnpm --filter @bidstack/web build` before preview-backed E2E, or point E2E at an active dev server intentionally.
- **Files affected:** none; verification command only.

### 2026-05-19 TESTING: Passed unsupported Vitest flag

- **What went wrong:** I ran `pnpm --filter @bidstack/web test -- --runInBand`; this Vitest version does not support Jest's `--runInBand` flag, so the test command failed before running tests.
- **Root cause:** I reused a Jest flag instead of the repo's documented `pnpm test`/Vitest command shape.
- **Prevention rule:** For this repo, run `pnpm --filter @bidstack/web test` directly unless a Vitest-supported flag has been confirmed locally.
- **Files affected:** none; verification command only.

### 2026-05-19 TOOLING: MobileNav patch included shell-rendered mojibake

- **What went wrong:** I included the terminal-rendered `BidStackÂ°` line inside a large `apply_patch`, so the patch could not match the actual Unicode source.
- **Root cause:** I repeated the already logged Unicode-console mistake while changing a surrounding block.
- **Prevention rule:** When a file has known mojibake in shell output, keep patches away from those lines unless a byte-safe read has confirmed the exact text.
- **Files affected:** none.

### 2026-05-19 TOOLING: Repeated mojibake patch attempt on DataQualitySection

- **What went wrong:** I tried to patch a terminal-rendered mojibake line in `DataQualitySection.tsx`, repeating the same Unicode-console failure pattern already logged.
- **Root cause:** I acted on the shell rendering instead of first reading the exact file text or bytes around the target line.
- **Prevention rule:** For any file that renders non-ASCII incorrectly in PowerShell, inspect the target line through JSON/byte-safe tooling before `apply_patch`; patch against ASCII-only surrounding structure or replace a bounded helper block.
- **Files affected:** none.

### 2026-05-19 TOOLING: Browser click timed out on New company

- **What went wrong:** The in-app browser timed out while clicking the `New company` button during smoke verification, even though the button was present in the DOM.
- **Root cause:** The browser automation bridge timed out on a CDP evaluation/click path in a motion-heavy app view.
- **Prevention rule:** After one in-app click timeout, stop retrying the same click path; use DOM assertions and the repo Playwright E2E runner for interaction coverage.
- **Files affected:** none; verification tooling only.

### 2026-05-19 TOOLING: Preview server start did not bind on 4184

- **What went wrong:** I launched a hidden Vite preview process on port 4184, but the follow-up probe could not connect.
- **Root cause:** The background process failed or exited before binding, and I did not capture its stderr/stdout.
- **Prevention rule:** When starting a new preview server for verification, either probe an already-running known-good preview after rebuilding `dist` or launch with redirected logs so failures are diagnosable.
- **Files affected:** none; verification tooling only.

### 2026-05-19 TOOLING: Repeated PowerShell chaining after prevention

- **What went wrong:** I used `&&` again immediately after logging that PowerShell command chaining mistake.
- **Root cause:** I reused a shell command pattern from memory instead of applying the just-written prevention rule.
- **Prevention rule:** Do not write compound shell commands manually for the rest of this turn. Use `multi_tool_use.parallel` for independent reads and a single command per shell call for everything else.
- **Files affected:** none; inspection command only.

### 2026-05-19 TOOLING: Repeated Bash-style command chaining in PowerShell

- **What went wrong:** I used `&&` while combining a file read and ripgrep inspection in PowerShell, which this shell context rejects.
- **Root cause:** I rushed an inspection command and repeated an already-logged shell syntax mistake.
- **Prevention rule:** Run dependent PowerShell inspections as separate tool calls or use `multi_tool_use.parallel` for independent reads; do not chain commands with `&&` in this workspace.
- **Files affected:** none; inspection command only.

### 2026-05-19 TOOLING: Mojibake copy patch failed in data quality

- **What went wrong:** A targeted patch for the data-quality empty-state copy failed because the existing message line contains terminal-rendered mojibake punctuation.
- **Root cause:** I repeated the provider-health patch pattern too soon and included rendered non-ASCII punctuation in the expected context.
- **Prevention rule:** For the rest of this session, do not patch copy lines containing mojibake directly; replace a wider ASCII-bounded component block or leave the copy for a later verified encoding pass.
- **Files affected:** none; patch did not apply.

### 2026-05-19 TOOLING: Subagent repeated leading-dash rg search

- **What went wrong:** The Dev Agent reported hitting an already-logged `rg` leading-dash pattern mistake during inspection.
- **Root cause:** The subagent did not apply the existing prevention rule for CSS custom-property searches.
- **Prevention rule:** All agents inspecting CSS variables must use `rg -F -- "--token-name" path` and must keep this rule in their task prompt when CSS/token searches are likely.
- **Files affected:** none; inspection command only.

### 2026-05-19 TOOLING: Mojibake caption patch failed in provider health

- **What went wrong:** A targeted patch for `ProviderHealthSection.tsx` failed because the exact caption lines contain terminal-rendered mojibake characters and did not match the source bytes.
- **Root cause:** I copied rendered text from PowerShell output instead of anchoring the patch only on stable ASCII structure.
- **Prevention rule:** In files with mojibake display text, patch around ASCII-only identifiers or use a small helper insertion plus minimal structural replacement; do not include rendered punctuation in patch context.
- **Files affected:** none; patch did not apply.

### 2026-05-18 TOOLING: Repeated wildcard positional test search

- **What went wrong:** I passed `apps/web/src/**/*.test.ts` and `apps/web/src/**/*.test.tsx` as positional paths to `rg`, which fails on this PowerShell/Windows path shape.
- **Root cause:** I repeated the already-logged wildcard path mistake while quickly checking whether preferences tests existed.
- **Prevention rule:** For the remainder of this session, run `rg` from the repo root with `-g` include globs or concrete directories only; never pass wildcard filesystem paths as positional arguments.
- **Files affected:** none; inspection command only.

### 2026-05-18 TOOLING: CSS variable search parsed as rg flag

- **What went wrong:** I searched for `--border-focus` with `rg -F` but did not pass `--` before the pattern, so ripgrep treated the CSS variable as a command flag.
- **Root cause:** I forgot that leading-dash literals need an end-of-options marker even with fixed-string search.
- **Prevention rule:** When searching for CSS custom properties with `rg`, use `rg -F -- "--token-name" path`.
- **Files affected:** none; inspection command only.

### 2026-05-18 TOOLING: Double-quote literal search failed in PowerShell

- **What went wrong:** I tried a simple literal `rg` search for double-quoted `api(\"/` calls, but the PowerShell command string still parsed with an unterminated quote.
- **Root cause:** I mixed JSON escaping with PowerShell quoting after already deciding to avoid fragile quoted searches.
- **Prevention rule:** Do not search for double-quote code literals with shell quoting in this session; rely on single-quote literal searches, file reads, or TypeScript validation instead.
- **Files affected:** none; inspection command only.

### 2026-05-18 TOOLING: Repeated quoted regex search failed again

- **What went wrong:** I tried to search for non-`/api` API paths with a quoted regex lookahead, and PowerShell parsed the quote incorrectly before `rg` could run.
- **Root cause:** I ignored the freshly logged prevention rule and used another complex regex in PowerShell.
- **Prevention rule:** Do not run any more quoted regex lookahead searches in PowerShell this session; use simple `rg -F`, file-specific reads, or a small Node/Python-free shell-safe inspection only when needed.
- **Files affected:** none; inspection command only.

### 2026-05-18 TOOLING: Repeated complex rg pattern broke in PowerShell

- **What went wrong:** I ran an `rg` alternation containing escaped quotes for motion CSS checks, and the regex parser failed with an unclosed group.
- **Root cause:** I repeated the already-logged habit of packing too many quoted alternatives into one PowerShell search.
- **Prevention rule:** For the rest of this session, use simple literal `rg -F` searches or separate commands for CSS selectors and media queries.
- **Files affected:** none; inspection command only.

### 2026-05-18 TOOLING: Repeated PowerShell wildcard path passed to rg

- **What went wrong:** I ran `rg` with `apps\web\src\*.tsx` as a positional path, which PowerShell/ripgrep treated as an invalid literal path.
- **Root cause:** I repeated an already-logged Windows glob mistake while trying to broaden an API/auth usage search quickly.
- **Prevention rule:** For the rest of this session, run `rg` from the repository root with `-g` include globs only; never pass wildcard filesystem paths as positional arguments in PowerShell.
- **Files affected:** none; inspection command only.

### 2026-05-17 TESTING: Dashboard test treated customer stage as open

- **What went wrong:** The dashboard account-scoping test computed expected open deals from serialized CRM stages and counted `customer` as open, but `customer` is the current serialized label for raw `closed_won`.
- **Root cause:** I used the UI-facing deal stage labels without checking `mapDealStage` semantics.
- **Prevention rule:** When deriving assertions from serialized stage labels, confirm the stage mapping and explicitly classify terminal/customer stages.
- **Files affected:** `apps/api/src/routes/crm/dashboard.test.ts`.

### 2026-05-17 BUG: Cockpit account test exposed exact-name matching drift

- **What went wrong:** The new dashboard account-scoping regression test failed because `buildCockpit` matched opportunities by exact `opp.customer === company.name`, while serialized deals/company ids use normalized names.
- **Root cause:** The route fix correctly passed account id into the service, but the service still depended on fragile display-name equality inside the cockpit builder.
- **Prevention rule:** Account-level dashboard joins must use a shared normalized-company matcher, not raw display-name equality.
- **Files affected:** `apps/api/src/services/crm/dashboard.service.ts`, `apps/api/src/routes/crm/dashboard.test.ts`.

### 2026-05-17 TOOLING: Playwright smoke targeted a stopped dev port

- **What went wrong:** External Playwright tried `http://127.0.0.1:5173/sales/products` and hit `ERR_CONNECTION_REFUSED`.
- **Root cause:** I assumed the previous web server on 5173 was still alive after longer work and in-app browser failures.
- **Prevention rule:** Before browser smoke, probe the candidate dev URLs and use the responding port; start/restart the web server only after confirming no current server is available.
- **Files affected:** none; browser verification only.

### 2026-05-17 TOOLING: In-app browser blocked localhost navigation

- **What went wrong:** Browser QA attempted to open `http://127.0.0.1:5173/sales/products`, but the in-app browser reported `net::ERR_BLOCKED_BY_CLIENT`.
- **Root cause:** I targeted a local URL/port without first confirming which in-app tab URL was currently allowed by the browser profile.
- **Prevention rule:** For in-app browser QA, start from the selected tab/current dev URL when available, or retry once with `localhost`/the active port before falling back to repository Playwright.
- **Files affected:** none; browser verification only.

### 2026-05-17 PROCESS: Repeated broad patching around mojibake table text

- **What went wrong:** After logging that broad patches around mojibake display text are brittle, I repeated the mistake on `SalesOrdersPage.tsx`, and the patch failed.
- **Root cause:** I tried to convert too much table structure in one pass instead of applying the logged prevention rule immediately.
- **Prevention rule:** Halt broad UI table rewrites in mojibake-affected files; only patch imports/actions first, then use tiny ASCII-only row/table tag hunks.
- **Files affected:** none; patch did not apply.

### 2026-05-17 TOOLING: Broad Products page patch matched mojibake text

- **What went wrong:** A multi-hunk patch for `ProductsPage.tsx` failed because one hunk matched table text containing mojibake characters.
- **Root cause:** I included too much surrounding display text in the patch context instead of anchoring on stable ASCII identifiers.
- **Prevention rule:** In files with corrupted/non-ASCII display text, patch imports and structural JSX in smaller ASCII-only hunks.
- **Files affected:** none; patch did not apply.

### 2026-05-17 TOOLING: Assumed a web test setup filename existed

- **What went wrong:** I tried to read `apps/web/src/test/setup.ts`, which does not exist in this workspace.
- **Root cause:** I inferred a conventional Vitest setup path instead of checking `apps/web/vitest.config.ts` first.
- **Prevention rule:** Inspect the package test config before opening assumed setup files.
- **Files affected:** none; inspection command only.

### 2026-05-17 BUG: Quantity parser allowed an undefined whole part

- **What went wrong:** API typecheck failed because `parseQuantityThousandths` destructured `quantity.split('.')` and passed a possibly undefined `whole` value to `BigInt`.
- **Root cause:** I relied on the shared Zod regex invariant but did not encode the invariant for TypeScript's control-flow analysis.
- **Prevention rule:** When converting validated strings to numeric primitives, still provide explicit fallback/default branches so TypeScript and runtime behavior agree.
- **Files affected:** `apps/api/src/routes/sales-orders.ts`.

### 2026-05-17 TOOLING: Guessed a sales page filename during inspection

- **What went wrong:** I tried to read `apps/web/src/pages/SalesPage.tsx`, but the file does not exist in this repo.
- **Root cause:** I inferred a route component filename from the route label instead of listing page files first.
- **Prevention rule:** Use `rg --files apps/web/src/pages` before opening a page file when the filename has not already been confirmed.
- **Files affected:** none; inspection command only.

### 2026-05-17 TOOLING: Bad PowerShell quoting in a broad rg inspection

- **What went wrong:** A broad `rg` command had an unterminated quoted pattern in PowerShell and failed before returning results.
- **Root cause:** I mixed many quoted alternatives into one command instead of splitting independent inspections.
- **Prevention rule:** Keep PowerShell `rg` patterns simple; when searching many CSS selectors, run separate `rg` calls or use a single-quoted pattern.
- **Files affected:** none; inspection command only.

### 2026-05-17 PROCESS: Tried to spawn all enterprise review squads at once

- **What went wrong:** I attempted to launch the orchestrator plus every section squad in one parallel batch, and the collaboration tool rejected most of them because the active agent thread limit was reached.
- **Root cause:** I optimized for the user's requested breadth before checking the platform's concurrency ceiling.
- **Prevention rule:** For large multi-section reviews, spawn the first wave only, wait or close completed agents, then continue section squads in controlled batches.
- **Files affected:** none; orchestration only.

### 2026-05-17 TOOLING: Used Bash-style `&&` in PowerShell

- **What went wrong:** I chained validation commands with `&&`, which PowerShell rejected as an invalid statement separator in this shell context.
- **Root cause:** I slipped into Bash syntax after several validation commands instead of using separate tool calls.
- **Prevention rule:** In this repo's PowerShell shell, run dependent commands as separate tool calls, or use native PowerShell syntax only when a single command truly needs sequencing.
- **Files affected:** none; validation command only.

### 2026-05-17 PROCESS: Used shell write for a one-line JSX replacement

- **What went wrong:** I used PowerShell `Set-Content` for a small Sidebar text replacement instead of `apply_patch`.
- **Root cause:** The patch matcher struggled with a mojibake degree symbol and I reached for a broad shell rewrite too quickly.
- **Prevention rule:** If `apply_patch` cannot match a non-ASCII line, patch a smaller ASCII-only surrounding hunk or leave the harmless text for a later formatting pass; do not use shell writes for manual edits.
- **Files affected:** `apps/web/src/components/layout/Sidebar.tsx`.

### 2026-05-17 TOOLING: Dotenv helper ran from the wrong package context

- **What went wrong:** An inline Prisma inspection script tried to import `dotenv-flow` from the repo root, where that dependency is not resolvable, then Prisma ran without `DATABASE_URL`.
- **Root cause:** I forgot the API loads dotenv from `apps/api` while the monorepo root does not expose `dotenv-flow` as a root dependency.
- **Prevention rule:** For ad-hoc Prisma scripts, run through the API package runtime and explicitly call `dotenvFlow.config({ path: 'D:/BIDCRM', silent: true })` before importing `@bidstack/db`.
- **Files affected:** none; inspection command only.

### 2026-05-17 PROCESS: Forked subagent options conflicted

- **What went wrong:** I tried to spawn a forked subagent while also overriding the agent type, which the tool rejected because full-history forks inherit the parent agent shape.
- **Root cause:** I mixed two valid subagent modes instead of using a self-contained non-forked worker prompt for the requested three-agent lane.
- **Prevention rule:** When using `fork_context: true`, omit `agent_type`, `model`, and `reasoning_effort`; when a specific role is needed, spawn without a full-history fork and provide self-contained task context.
- **Files affected:** none.

### 2026-05-18 SHELL: PowerShell pattern with embedded quotes failed again

- **What went wrong:** I ran `Select-String` with a pattern containing escaped double quotes, and PowerShell parsed it as an unterminated string.
- **Root cause:** I used shell-style escaping reflexively instead of single-quoting the whole PowerShell pattern.
- **Prevention rule:** For `Select-String -Pattern` values that include quotes or punctuation, wrap the entire pattern in single quotes or run separate simple searches.
- **Files affected:** none.

### 2026-05-12 TESTING: Ambiguous close button in meeting-import E2E

- **What went wrong:** The new account E2E clicked `getByRole('button', { name: 'Close' })` inside the meeting import dialog, but Radix also renders an icon-only close button with the same accessible name.
- **Root cause:** I added a dialog assertion without checking for duplicate accessible names in the modal header and footer.
- **Prevention rule:** In dialog E2E tests, close via exact visible text (`getByText('Close', { exact: true })`) or a more specific footer container when the header has an aria-label close control.
- **Files affected:** `apps/web/e2e/accounts.spec.ts`.

### 2026-05-12 TOOLING: External smoke script imported wrong Playwright package

- **What went wrong:** I wrote an inline smoke script with `require('playwright')`, but this workspace exposes Playwright through `@playwright/test`.
- **Root cause:** I used the generic Playwright package name instead of checking the package already used by the repo's E2E tests.
- **Prevention rule:** For ad-hoc browser smoke in this repo, import `chromium` from `@playwright/test` or run the existing `pnpm --filter @bidstack/web e2e` command.
- **Files affected:** none; validation script only.

### 2026-05-12 TOOLING: In-app browser selector timed out after screenshot failures

- **What went wrong:** After repeated screenshot capture timeouts, a normal in-app browser locator for the `New account` button also timed out during selector evaluation.
- **Root cause:** The browser automation bridge was degraded after the CDP screenshot timeouts, even though prior DOM checks had already validated the rendered cockpit.
- **Prevention rule:** If screenshot capture timeouts are followed by selector-evaluation timeouts, stop using the in-app bridge for that pass and switch to the repo Playwright runtime for browser smoke.
- **Files affected:** none; validation tooling only.

### 2026-05-12 TOOLING: Browser visible-screen capture also used timed-out screenshot path

- **What went wrong:** I switched from Playwright screenshot to the browser visible-screen capture path, but it still timed out through the same underlying screenshot command.
- **Root cause:** The available screenshot methods share a CDP capture dependency in this environment.
- **Prevention rule:** When both Playwright and visible-screen capture time out, stop retrying in-app screenshots and use external Playwright CLI or DOM/console validation instead.
- **Files affected:** none; validation artifact capture only.

### 2026-05-12 TOOLING: Viewport screenshot used same timed-out CDP capture path

- **What went wrong:** After the full-page screenshot timeout, I retried with `fullPage: false`, but it still used the same CDP screenshot path and timed out again.
- **Root cause:** I assumed viewport capture would use a lighter transport; in this browser bridge it still depends on `Page.captureScreenshot`.
- **Prevention rule:** If `Page.captureScreenshot` times out once on the dense cockpit, do not retry the Playwright screenshot API in the same smoke pass; use DOM/console checks or the browser visible-screen capture path.
- **Files affected:** none; validation artifact capture only.

### 2026-05-12 TOOLING: Full-page browser screenshot timed out on dense cockpit

- **What went wrong:** I attempted a full-page in-app browser screenshot of the motion-heavy cockpit and the browser bridge timed out on `Page.captureScreenshot`.
- **Root cause:** The page is tall and animation-rich; full-page capture is heavier than needed for a visual smoke artifact.
- **Prevention rule:** For dense animated cockpit QA, capture the visible viewport first; only use full-page screenshots when the viewport artifact is insufficient.
- **Files affected:** none; validation artifact capture only.

### 2026-05-12 TESTING: E2E run skipped after API was stopped for typecheck

- **What went wrong:** I ran `pnpm e2e` immediately after stopping the API for the root Prisma/typecheck gate, so Playwright's API health preflight failed and all tests were skipped.
- **Root cause:** I treated the typecheck stop/restart protocol as complete before actually restarting the API.
- **Prevention rule:** After any validation step that stops the API, restart the API and verify `/health` before running E2E; skipped Playwright tests are never a green gate.
- **Files affected:** none; validation sequencing only.

### 2026-05-12 INFRA: Profile-gated Odoo required env blocked Redis-only compose start

- **What went wrong:** After adding a transient Postgres password, `docker compose up -d redis` still failed because the profile-gated Odoo MCP service has required env placeholders that Compose interpolates before selecting services.
- **Root cause:** The compose file uses required variable expressions inside an optional profile; Compose still validates those expressions during config loading.
- **Prevention rule:** For local Redis-only recovery, either provide all compose-required transient env placeholders or start the Redis image directly with the same port/container name; do not edit `.env*` to bypass it.
- **Files affected:** none; local service startup only.

### 2026-05-12 INFRA: Compose Redis startup missed required env interpolation

- **What went wrong:** I ran `docker compose up -d redis` without a transient `POSTGRES_PASSWORD`, and Compose failed while interpolating the Postgres service environment even though only Redis was targeted.
- **Root cause:** Docker Compose validates required variables for the whole compose file before service selection.
- **Prevention rule:** For targeted Compose service starts in this repo, provide non-secret transient defaults for required variables in the shell invocation when no local `.env` is loaded; never edit or print `.env*`.
- **Files affected:** none; local service startup only.

### 2026-05-12 TOOLING: PowerShell wildcard paths passed directly to rg

- **What went wrong:** I passed `docker-compose*` and `compose*` as positional paths to `rg` in PowerShell, which treated them as invalid literal path patterns and exited nonzero even though it still found Redis references.
- **Root cause:** I mixed shell-style glob habits with ripgrep path arguments on Windows.
- **Prevention rule:** In PowerShell, use `rg` from the repository root with `-g` include globs only, or resolve paths with `Get-ChildItem` before passing them as explicit files.
- **Files affected:** none; inspection command only.

### 2026-05-12 TOOLING: Reused browser script binding while saving QA screenshot

- **What went wrong:** I declared `const fs` in the persistent browser automation runtime even though that binding already existed from earlier QA work, so the screenshot-save script failed before writing the file.
- **Root cause:** I forgot that browser automation variables persist across cells and reused a common binding name.
- **Prevention rule:** In persistent browser scripts, use unique binding names or `globalThis` properties for one-off helpers; never redeclare common names like `fs`, `path`, or `screenshot`.
- **Files affected:** none; validation scripting only.

### 2026-05-12 BUG: Smart intake derived fields with setState effects

- **What went wrong:** I derived the company domain and website by calling `setState` synchronously inside effects, and the React hooks lint gate rejected it.
- **Root cause:** I treated derived form defaults as synchronization work instead of handling them directly in the user input handlers.
- **Prevention rule:** For form autofill/defaulting, derive values in the event handler or render path; reserve effects for external synchronization and async subscriptions.
- **Files affected:** `apps/web/src/components/company/SmartCompanyDialog.tsx`.

### 2026-05-12 TOOLING: Skill archive read as text

- **What went wrong:** I read downloaded `.skill` package files directly as text, which produced ZIP binary output instead of the skill instructions.
- **Root cause:** I assumed the `.skill` extension was a plain markdown skill file rather than a packaged archive.
- **Prevention rule:** Inspect package entries first and extract the embedded `SKILL.md` before reading or applying a downloaded skill.
- **Files affected:** none.

### 2026-05-11 UX: Broad stat span selector broke animated metrics

- **What went wrong:** `.account-source-stat span` applied `display: block` to nested spans inside `AnimatedMetric`, causing currency values to stack vertically.
- **Root cause:** The old CSS selector targeted all descendant spans instead of only the direct label span.
- **Prevention rule:** For stat/card typography selectors, prefer direct-child selectors before introducing nested animated/text components.
- **Files affected:** `apps/web/src/index.css`.

### 2026-05-11 UX: Animated currency metric wrapped mid-value

- **What went wrong:** The new animated metric split currency prefix, number, and suffix into separate inline nodes, so a narrow KPI tile could wrap `€6.33M` across multiple lines.
- **Root cause:** I animated the numeric portion without wrapping the assembled metric in a no-wrap container.
- **Prevention rule:** Any animated metric that separates prefix/number/suffix must render inside a single `white-space: nowrap` wrapper.
- **Files affected:** `apps/web/src/components/motion/AnimatedMetric.tsx`, `apps/web/src/index.css`.

### 2026-05-11 TOOLING: In-app browser click bridge timed out on dense page

- **What went wrong:** The in-app browser locator found account cockpit links, but the click operation timed out inside the browser automation bridge on the motion-heavy dashboard.
- **Root cause:** I relied on the in-app click path for a dense animated page instead of using direct route navigation once link presence had already been verified.
- **Prevention rule:** For browser QA on dense local pages, verify link presence in the in-app browser, then use direct route navigation or external Playwright for click-through/error collection.
- **Files affected:** none; validation harness only.

### 2026-05-11 TOOLING: Reused persistent browser variable name

- **What went wrong:** I declared `const links` in a Node-backed browser session where that identifier already existed from a prior verification call.
- **Root cause:** I forgot that the browser automation kernel persists top-level bindings across calls.
- **Prevention rule:** In persistent browser sessions, use unique verification variable names or assign to `globalThis` once; avoid redeclaring generic names like `links`.
- **Files affected:** none; validation harness only.

### 2026-05-11 BUG: Motion rail used wrong provider health field

- **What went wrong:** I mapped dashboard provider health with `provider.name`, but the shared API contract exposes the display field as `provider.provider`.
- **Root cause:** I inferred the object shape from nearby UI copy instead of checking the shared schema/typecheck before wiring the rail.
- **Prevention rule:** When consuming dashboard health/provider objects, use the schema field names (`provider`, `status`, `latencyMs`, `lastCheckedAt`, `message`) rather than guessed display names.
- **Files affected:** `apps/web/src/pages/AccountsPage.tsx`.

### 2026-05-11 BUG: Animated metric assumed array index narrowing

- **What went wrong:** `AnimatedMetric` checked that `matches.length === 1` but TypeScript still treated `matches[0]` as possibly undefined.
- **Root cause:** I relied on array length narrowing that TypeScript does not guarantee for indexed reads.
- **Prevention rule:** After collecting regex matches, assign `const match = matches[0]` and guard it explicitly before using capture groups or indexes.
- **Files affected:** `apps/web/src/components/motion/AnimatedMetric.tsx`.

### 2026-05-11 TOOLING: Large patch anchored on mojibake text

- **What went wrong:** I tried to patch `AccountsPage.tsx` with a large context block that included existing mojibake copy, so `apply_patch` could not find the expected lines.
- **Root cause:** I relied on copied terminal output containing replacement characters instead of anchoring on stable ASCII structure.
- **Prevention rule:** For files with known encoding artifacts, patch in small chunks around ASCII-only anchors or replace a clearly bounded function wholesale.
- **Files affected:** none; failed patch only.

### 2026-05-11 TOOLING: In-app browser API called without Playwright namespace

- **What went wrong:** I called `tab.getByRole(...)` while validating the running app, but the in-app browser surface exposes locators through `tab.playwright.getByRole(...)`.
- **Root cause:** I mixed external Playwright page APIs with the Browser plugin's wrapped tab API during a quick smoke check.
- **Prevention rule:** In the in-app browser runtime, all locator/screenshot/load-state calls must go through `tab.playwright.*`; reserve bare `page.*` calls for standalone Playwright scripts only.
- **Files affected:** none; validation harness only.

### 2026-05-11 UX: Tech stack icon CDN returned brand 404s

- **What went wrong:** The cockpit tech-stack pills used Simple Icons slugs that now return 404 for several common enterprise brands, creating browser console errors on account detail pages.
- **Root cause:** I assumed old Simple Icons slugs for Microsoft, AWS, CrowdStrike, and others would remain stable instead of validating the current CDN behavior.
- **Prevention rule:** For decorative tech logos, prefer a resilient domain favicon path with initials fallback, or validate icon CDN slugs in tests before shipping them.
- **Files affected:** `apps/web/src/components/company/TechLogo.tsx`.

### 2026-05-11 UX: Logo fallback produced browser console noise

- **What went wrong:** Account dashboard QA surfaced direct `/favicon.ico` fallbacks that logged failed resource errors, plus a React warning for the `fetchPriority` image prop in the current React/Vite runtime.
- **Root cause:** The logo component treated direct favicons as a harmless fallback, but failed image fetches still pollute browser diagnostics; React 18 also warns on that camelCase image hint.
- **Prevention rule:** Company logos should prefer stored/provider URLs and a resilient favicon service fallback before any direct favicon URL, and avoid image props that the current React runtime does not recognize.
- **Files affected:** `apps/web/src/components/company/CompanyLogo.tsx`.

### 2026-05-11 BUG: Health score render used mutable cursor

- **What went wrong:** The new health donut built its conic-gradient stops by mutating a local `cursor` during render, and TypeScript also flagged indexed health counts as possibly undefined.
- **Root cause:** I wrote the render calculation imperatively instead of using an immutable accumulator and explicit `?? 0` fallbacks for record access.
- **Prevention rule:** Derived render data in React components should be built with pure `map`/`reduce` objects and guarded record reads, especially when eslint immutability rules are active.
- **Files affected:** `apps/web/src/components/cockpit/HealthScoreCard.tsx`.

### 2026-05-11 BUG: Tooltip index narrowed visually but not for TypeScript

- **What went wrong:** I added a chart tooltip under a `tooltip ? ... : null` branch but continued indexing arrays with `hover`, which TypeScript still treated as `number | null`.
- **Root cause:** I assumed the derived `tooltip` object would narrow the original state variable, but TypeScript does not connect those conditions.
- **Prevention rule:** For nullable UI indexes, create a non-null derived object that carries both the index and the point data, then render from that object instead of reusing the nullable state.
- **Files affected:** `apps/web/src/components/sales/MonthlySalesChart.tsx`.

### 2026-05-11 TOOLING: Playwright package name mismatch

- **What went wrong:** After moving the smoke script into the web workspace, I still imported `playwright` directly even though this package exposes the runtime through `@playwright/test`.
- **Root cause:** I assumed the transitive Playwright package name was directly resolvable from pnpm's isolated workspace layout.
- **Prevention rule:** In this repo, ad hoc browser smoke scripts should import from `@playwright/test` unless `playwright` is explicitly listed as a direct dependency.
- **Files affected:** none; validation tooling only.

### 2026-05-11 TOOLING: Root Playwright require failed

- **What went wrong:** I ran a root-level Node smoke script with `require('playwright')`, but the browser dependency is available through the web workspace tooling, not root module resolution.
- **Root cause:** I switched fallback strategies quickly after in-app screenshot timeouts and did not verify package resolution from the current working directory.
- **Prevention rule:** Browser smoke scripts should run through `pnpm --filter @bidstack/web exec ...` or from `apps/web` so Playwright dependencies resolve predictably.
- **Files affected:** none; validation tooling only.

### 2026-05-11 TOOLING: Browser screenshot path timed out

- **What went wrong:** The Playwright screenshot call timed out during visual QA of the sales dashboard.
- **Root cause:** I used the heavier screenshot path first instead of the in-app browser's visible capture path after a motion-heavy page update.
- **Prevention rule:** For quick visual QA in the Codex in-app browser, try `cua.get_visible_screenshot()` first; fall back to Playwright screenshots only when a full-page capture is necessary.
- **Files affected:** none; validation tooling only.

### 2026-05-11 TOOLING: Browser wait used unsupported `networkidle`

- **What went wrong:** I called the in-app browser wait helper with `networkidle`, and the runtime rejected that state.
- **Root cause:** I trusted the skill API reference over the runtime's narrower implementation.
- **Prevention rule:** For this browser runtime, use `load` or `domcontentloaded` waits unless `networkidle` support has been confirmed in the current session.
- **Files affected:** none; validation sequencing only.

### 2026-05-11 PROCESS: Partial Browser skill read

- **What went wrong:** I read only the first chunk of the Browser skill file even though the skill explicitly requires reading the entire `SKILL.md` before browser work.
- **Root cause:** I used a quick `Select-Object -First` habit for context minimization on a file whose instructions overrode that shortcut.
- **Prevention rule:** When a skill says to read the entire file, use one full-file read before any related tool action, even if the first section appears sufficient.
- **Files affected:** none; process log only.

### 2026-05-11 BUG: Mantu official favicon attributed as generic favicon

- **What went wrong:** The enrichment helper picked the favicon fallback source before the Mantu official-website override, so Mantu's official favicon was serialized as `favicon` instead of `official_website`.
- **Root cause:** I changed logo source precedence while extracting a shared enrichment helper and did not preserve the Mantu-specific attribution rule.
- **Prevention rule:** For canonical seed accounts with locked attribution, assert both logo URL and logo source after any enrichment refactor.
- **Files affected:** `apps/api/src/routes/crm.ts`.

### 2026-05-11 PROCESS: Repeated stale shared dist validation sequence

- **What went wrong:** I ran API/web typechecks in parallel with `@bidstack/shared` build after adding a shared CRM contract, so consumers saw stale dist output and failed to import `CompanyAutopopulateResponse`.
- **Root cause:** I treated "shared build is included in the same parallel batch" as equivalent to "shared build completed before consumers start", which repeated an existing stale-dist failure mode.
- **Prevention rule:** Shared contract edits require a completed serial `pnpm --filter @bidstack/shared build` before any consumer package validation starts. Do not parallelize that first build.
- **Files affected:** none; validation sequencing only.

### 2026-05-11 BUG: New shared schema consumed before dist build completed

- **What went wrong:** API route registration and consumer typechecks saw an undefined/missing `CompanyAutopopulateResponse` because consumer checks started before the rebuilt shared dist was available.
- **Root cause:** I diagnosed it as a missing export before confirming the source barrel and dist output; the true issue was validation order.
- **Prevention rule:** For shared contract edits, verify source export and completed dist output before starting API/web route tests.
- **Files affected:** `packages/shared/src/schemas/crm.ts`, `packages/shared/src/index.ts`, `apps/api/src/routes/crm.ts`, `apps/web/src/hooks/useAutopopulateSalesCompanies.ts`.

### 2026-05-11 TOOLING: Browser smoke used unsupported networkidle state

- **What went wrong:** The in-app browser runtime rejected `waitForLoadState({ state: "networkidle" })` during the sales page smoke.
- **Root cause:** I followed generic Playwright habit instead of verifying the local browser runtime's supported load-state behavior.
- **Prevention rule:** For this browser plugin, prefer `domcontentloaded` or a concrete DOM/screenshot check after reload unless `networkidle` has already been proven supported in the current runtime.
- **Files affected:** none; browser smoke only.

### 2026-05-11 BUG: Open enrichment metadata was too wide for Prisma JSON

- **What went wrong:** The API route stored open-provider metadata typed as `Record<string, unknown>`, which TypeScript correctly rejected as wider than Prisma's JSON input contract.
- **Root cause:** I used Zod/shared metadata types directly at the Prisma write boundary instead of narrowing them to `Prisma.InputJsonValue`.
- **Prevention rule:** Before assigning provider metadata to Prisma JSON fields, cast only at the final write boundary or build the object as a `Prisma.InputJsonObject` with JSON-compatible values.
- **Files affected:** `apps/api/src/routes/crm.ts`.

### 2026-05-11 TOOLING: Prettier was not run before checking formatting

- **What went wrong:** `pnpm format:check` failed on the new open enrichment provider and CRM route.
- **Root cause:** I added multi-line TypeScript objects and ran the check before formatting the touched files.
- **Prevention rule:** After adding a new TypeScript file or large object literal, run `pnpm format -- <files>` or Prettier on the touched files before `format:check`.
- **Files affected:** `apps/api/src/providers/company-open-enrichment.ts`, `apps/api/src/routes/crm.ts`.

### 2026-05-11 TOOLING: Patch context copied mojibake instead of source text

- **What went wrong:** My first `CompanyLogo` patch failed because I copied the terminal-rendered mojibake form of an em dash instead of the actual source line.
- **Root cause:** I trusted `Get-Content` rendering for a line containing non-ASCII punctuation.
- **Prevention rule:** When a patch misses on a displayed non-ASCII line, re-read the exact line with `Select-String` or patch around ASCII-only anchors.
- **Files affected:** none; the failed patch did not mutate files.

### 2026-05-11 TOOLING: Browser smoke reused a persistent const name

- **What went wrong:** My first in-app browser smoke cell redeclared `snapshot`, which already existed in the persistent browser session, so the check failed before running.
- **Root cause:** I forgot the browser execution context keeps top-level bindings between calls.
- **Prevention rule:** Use unique names for browser smoke variables or a short scratch block when values do not need to persist.
- **Files affected:** none.

### 2026-05-11 TOOLING: Inline TSX probe used wrong package context

- **What went wrong:** I tried to run an inline `tsx` probe from the repo root and then through a filtered package command, which first failed to resolve `tsx` and then imported the API server from the wrong working directory.
- **Root cause:** I mixed root-relative imports with pnpm's package-scoped execution context instead of using the existing Vitest/route tests as the debugging surface.
- **Prevention rule:** For BIDCRM route debugging, prefer focused Vitest tests or `server.inject` inside an existing test file. If an inline probe is unavoidable, run it from the target package directory with package-relative imports and a short timeout.
- **Files affected:** none.

### 2026-05-11 BUG: Malformed Apollo queue patch left duplicate code

- **What went wrong:** My first Apollo job-signing patch left a duplicate tail block in `apps/api/src/queues/company-enrich-apollo.ts` and enqueued the unsigned job instead of the signed payload.
- **Root cause:** I edited the enqueue block too broadly and did not immediately re-read the changed file before continuing.
- **Prevention rule:** After any security-boundary patch that changes control flow, re-open the exact edited file before moving on and verify the payload variable is the value actually passed across the boundary.
- **Files affected:** `apps/api/src/queues/company-enrich-apollo.ts`.

### 2026-05-11 TOOLING: Repeated Prisma generate while API server locked Windows DLL

- **What went wrong:** I reran the root `pnpm typecheck` while the local API dev server was live, so `prisma generate` again failed to rename `query_engine-windows.dll.node`.
- **Root cause:** I parallelized validation after restarting the API for browser QA and did not re-check for DB-client-owning Node processes before the root gate.
- **Prevention rule:** Any root gate containing `pnpm db:generate` must be preceded by a BIDCRM API/worker process check and stop step, even if the API was started only minutes earlier for QA.
- **Files affected:** none; validation sequencing only.

### 2026-05-11 TESTING: Odoo autocomplete response source widened to string

- **What went wrong:** I returned an Odoo autocomplete `source` through a nested ternary without annotating it, so TypeScript widened the literal union to `string` and the Fastify Zod response type rejected the route handler.
- **Root cause:** I trusted value inference inside a returned object instead of typing the public response discriminator.
- **Prevention rule:** For route response discriminators, assign the value to a `z.infer<typeof ResponseSchema>['field']` variable before returning it.
- **Files affected:** `apps/api/src/routes/odoo-integration.ts`.

### 2026-05-11 TOOLING: Prisma generate while API server locked Windows DLL

- **What went wrong:** I ran the root `pnpm typecheck` while the local API dev server was still running, so `prisma generate` failed to rename `query_engine-windows.dll.node`.
- **Root cause:** I forgot the Windows-specific Prisma client file lock before invoking a gate that runs `db:generate`.
- **Prevention rule:** Before any root gate that calls `pnpm db:generate`, stop BIDCRM API/worker Node processes that may have loaded `@bidstack/db`.
- **Files affected:** none; validation order only.

### 2026-05-11 TOOLING: Repeated web typecheck against stale shared dist

- **What went wrong:** I ran `pnpm --filter @bidstack/web typecheck` immediately after adding shared CRM exports, so the web package resolved stale `@bidstack/shared` dist output and reported missing `CrmConnector`/`OpenDataSignal` exports.
- **Root cause:** I remembered the stale-dist issue for full gates but still ran a targeted sibling typecheck before rebuilding shared.
- **Prevention rule:** After any `packages/shared/src/**` contract edit, the very next validation command must be `pnpm --filter @bidstack/shared build` or a root script that performs that build first.
- **Files affected:** none; validation order only.

### 2026-05-11 SHELL: Repeated Bash separator in PowerShell

- **What went wrong:** I ran a PowerShell command containing `&&`, which this shell mode rejects.
- **Root cause:** I bundled a format command and lint command out of habit instead of keeping PowerShell tool calls single-purpose.
- **Prevention rule:** In this workspace, run sequential commands as separate shell tool calls unless using explicit PowerShell control flow.
- **Files affected:** none.

### 2026-05-11 TOOLING: Repeated targeted Prettier unsupported-file mistake

- **What went wrong:** I included `.prettierignore` in another targeted `prettier --write` command, so Prettier formatted the source files but exited nonzero because no parser applies to the ignore file.
- **Root cause:** I used a manual file list after patching the ignore file instead of trusting `pnpm format:check` to validate it.
- **Prevention rule:** Never pass `.prettierignore`, `.gitignore`, Prisma schema, or other tool metadata to targeted Prettier commands unless `--ignore-unknown` is included. Use `pnpm format:check` as the gate for ignore-file changes.
- **Files affected:** none beyond successfully formatted source files.

### 2026-05-11 TOOLING: API tests consumed stale shared dist contracts

- **What went wrong:** The API route schema imported new shared Zod contracts, but `@bidstack/shared` resolves from `dist`, so `pnpm --filter @bidstack/api test` saw stale exports until the shared package was rebuilt.
- **Root cause:** The root `test` script ran workspace tests without first building shared package artifacts consumed by sibling packages.
- **Prevention rule:** Build `@bidstack/shared` before recursive test runs whenever API/MCP/frontend packages import shared contracts from package exports.
- **Files affected:** `package.json`.

### 2026-05-10 BUG: Audit-injected auth abstraction violated Rules of Hooks

- **What went wrong:** `apps/web/src/lib/auth.tsx` from the audit pipeline shipped three `useAuth/useUser/useSignOut` hooks that called Clerk's hooks **after** an early return for stub mode (`if (stub.user?.id === 'stub-user-1') return …; const clerk = useClerkAuth();`). React's hook order is per-component-instance, not per-app — so any component using these hooks could trigger "Rendered fewer hooks than expected" if it ever switched providers, and Clerk's hooks throw at runtime when there's no `<ClerkProvider>` ancestor (stub mode). ESLint's `react-hooks/rules-of-hooks` flagged it correctly.
- **Root cause:** The author assumed the app would only ever be in one mode per session, then used a runtime conditional to skip Clerk's hooks in stub mode. Both assumptions are right _operationally_ but wrong _for React_. Hooks are unconditional contracts.
- **Prevention rule:** When integrating an SDK whose hooks throw without their provider, never call those hooks conditionally. Instead: gate the _provider tree_ (mount one of two non-overlapping subtrees in `AuthProvider`) and have each subtree expose the same shared `Context`. Consumers always read the shared context — same hooks, same order, every render. The `ClerkAuthBridge` pattern.
- **Files affected:** `apps/web/src/lib/auth.tsx` (refactored).

### 2026-05-10 BUG: Audit used `require()` in a Vite ESM module

- **What went wrong:** `apps/web/src/App.tsx` had `const { SignIn } = require('@clerk/clerk-react')` to "lazy-load" Clerk's SignIn component. Vite's ESM build doesn't have CommonJS `require` at runtime; it would have failed in the browser. ESLint's `@typescript-eslint/no-require-imports` caught it.
- **Root cause:** Pattern carried over from a Node CJS context. In a Vite project, the lazy-load idiom is `React.lazy(() => import(...))`.
- **Prevention rule:** In Vite/ESM apps, `require()` is always wrong. The lint rule already enforces this — keep `@typescript-eslint/no-require-imports: error` on. For genuine lazy loading of named exports use `lazy(() => import(pkg).then(m => ({ default: m.Named })))`.
- **Files affected:** `apps/web/src/App.tsx`.

### 2026-05-10 PROCESS: Audit ran in parallel without a contract for which workspace owns lint

- **What went wrong:** A separate audit pipeline modified ~13 files between my commits, partially applying a 10-phase remediation. Some changes left the workspace in a half-broken state (typecheck fails, tests fail) and contradicted earlier work (Industry enum widening invalidated my fixture-guard test for industry; CI workflow rewritten without the bundle-size guard or 3-job split).
- **Root cause:** No coordination protocol between the audit pipeline and the active session — both wrote to the same tree without locking or branching.
- **Prevention rule:** When two automation pipelines could run in parallel, they MUST work on separate branches (or worktrees) and converge via PR. Never let a long-running audit write directly into the same branch a session is editing. If it happens anyway: pause, run `pnpm -r typecheck && pnpm -r lint && pnpm -r test`, and adopt-or-revert per file before continuing.
- **Files affected:** ~13 audit-modified files across `apps/`, `packages/`, `handoff/`.

### 2026-05-10 TESTING: Industry Zod enum was narrower than seed data

- **What went wrong:** Integration test `POST /opportunities` returned 500 because the `Industry` Zod enum was missing `insurance` (MAPFRE seed) and `transportation` (Logistec seed). The seed wrote those rows directly via Prisma, but the API rejected anything containing the same values on read serialization.
- **Root cause:** I built the Zod schema and the SQL seed in separate sittings and never reconciled them. Closed enums lie in two places and drift if the source of truth isn't enforced.
- **Prevention rule:** When extending a closed enum that constrains an external boundary (HTTP/GraphQL/MCP input), grep every fixture, seed, and migration for literal values of that enum and add a parse-the-fixtures unit test so the build fails on drift. Treat the enum and the seed as one change.
- **Files affected:** `packages/shared/src/schemas/opportunity.ts`, `packages/db/src/seed.ts`, `apps/api/src/routes/opportunities.integration.test.ts`.

### 2026-05-10 PROCESS: Master prompt assumed React 19 + Twenty fork as base

- **What went wrong:** Initial framing assumed Twenty CRM uses React 19 and has a stable `ApplicationRegistration` marketplace contract; both turned out to be wrong (React 18.2.39, marketplace WIP, registry path 404).
- **Root cause:** Trusted prose specs without verifying against upstream code.
- **Prevention rule:** Before committing to a fork/extension architecture, spawn an Explore agent to verify the actual upstream tech stack and extension-point contracts. Treat any prose claim about an upstream's internals as a hypothesis until grepped.
- **Files affected:** SPEC.md (architecture decision documented as standalone-first, Twenty overlay preserved for future).

### 2026-05-18 TOOLING: Forked agent spawn included explicit roles

- **What went wrong:** I attempted to spawn three forked agents with explicit `agent_type` values. The tool rejected the calls because full-history forked agents inherit the parent agent type, model, and reasoning effort.
- **Root cause:** I mixed the full-history fork option with role override parameters without checking this session's spawn constraint.
- **Prevention rule:** When using `fork_context: true`, omit `agent_type`, `model`, and `reasoning_effort`; only set explicit roles when spawning without full-history fork context.
- **Files affected:** none.

### 2026-05-18 TOOLING: Browser skill was read partially first

- **What went wrong:** I opened the Browser skill with `-TotalCount 160` even though its instructions require reading the full `SKILL.md` in one read before browser work.
- **Root cause:** I used my normal quick-inspection habit for a skill file that explicitly disallows partial reads before use.
- **Prevention rule:** For skills, always read the full `SKILL.md` first unless the skill instructions themselves permit partial loading.
- **Files affected:** none.

### 2026-05-18 TOOLING: Patched shell-rendered mojibake instead of exact file text

- **What went wrong:** I tried to patch sidebar copy using the mojibake shown by one shell read (`Â·`, `â€¦`), but the actual file text was valid Unicode and the patch failed.
- **Root cause:** I trusted one console rendering of UTF-8 text instead of confirming with a targeted match before editing.
- **Prevention rule:** When text appears corrupted in terminal output, confirm the exact source line with a targeted read before patching; do not patch rendered mojibake.
- **Files affected:** none.

### 2026-05-18 SHELL: Repeated quote-heavy Select-String failed

- **What went wrong:** I ran another `Select-String` pattern containing embedded quotes and alternation, and PowerShell split it into a bad positional argument.
- **Root cause:** I tried to combine several checks into one quoted pattern instead of using simple single-purpose searches.
- **Prevention rule:** For PowerShell `Select-String`, avoid combined quote-heavy patterns; run separate simple searches or single-quote the full literal pattern.
- **Files affected:** none.

### 2026-05-18 TOOLING: In-app browser screenshot capture timed out

- **What went wrong:** After successful DOM/console route smoke, `Page.captureScreenshot` timed out for the in-app browser tab.
- **Root cause:** The screenshot command can be slower or blocked on complex animated pages; I attempted it after validation instead of treating it as optional evidence.
- **Prevention rule:** For route smoke, collect DOM and console assertions first. Use screenshots as supplementary evidence only, and if capture times out, report that directly instead of retrying in a loop.
- **Files affected:** none.

### 2026-05-18 SHELL: Combined rg pattern treated Windows path escapes as regex

- **What went wrong:** I combined multiple Lead checks into one `rg` command, and the Windows path/backslashes became part of the regex parse failure.
- **Root cause:** I packed verification and target path into a quote-sensitive regex instead of using fixed-string checks.
- **Prevention rule:** Use `rg -F` with one literal pattern per command for Windows path verification, especially when patterns contain quotes or backslashes.
- **Files affected:** none.

### 2026-05-18 TESTING: Targeted Playwright command used wrong binary path and flag

- **What went wrong:** I ran `pnpm --filter @bidstack/web exec playwright ... --screenshot=off`, which failed before executing tests because the recursive exec path did not expose `playwright` and this Playwright version rejected `--screenshot=off`.
- **Root cause:** I copied the intended E2E shape without checking the package's script entry point and supported Playwright CLI flags.
- **Prevention rule:** Prefer the package script (`pnpm --filter @bidstack/web e2e -- ...`) for web E2E, and only pass flags confirmed by the installed Playwright version.
- **Files affected:** none.

### 2026-05-18 TESTING: Playwright package script failed before collecting tests

- **What went wrong:** The corrected web E2E package script failed with `@playwright/test does not provide an export named 'test'` and then reported no tests found.
- **Root cause:** The local Playwright runtime/module resolution is not in a working state for the package-script path, independent of the UI changes under test.
- **Prevention rule:** Treat package-level E2E infrastructure failures separately from browser smoke. Inspect package resolution before claiming E2E coverage, and report route smoke as manual/browser validation when Playwright collection is broken.
- **Files affected:** none.

### 2026-05-18 SHELL: Repeated combined rg pattern failed while checking dashboard animation

- **What went wrong:** I used one combined `rg` pattern with quotes and alternation while searching for dashboard glow classes, and the regex parser rejected it.
- **Root cause:** I repeated a known bad pattern instead of using the documented fixed-string approach from the earlier mistake entry.
- **Prevention rule:** For class/name searches in this repo, default to `rg -F` with one pattern per command. Do not combine alternation and escaped quotes in PowerShell.
- **Files affected:** none.

### 2026-05-20 SHELL: Used reserved `$PID` as a loop variable

- **What went wrong:** I used `$pid` as a PowerShell loop variable while trying to restart the local preview server. PowerShell treats `$PID` as a read-only automatic variable, so the cleanup command errored before it could stop the process.
- **Root cause:** I wrote a quick process loop without checking automatic variable names.
- **Prevention rule:** In PowerShell process loops, use names like `$ownerPid` or `$processIdValue`, never `$pid`/`$PID`.
- **Files affected:** none.

### 2026-05-20 TESTING: Playwright link selector matched multiple account nav items

- **What went wrong:** The mobile account E2E clicked `getByRole('link', { name: 'Accounts' })`, which also matched `Key Accounts` and `Top Accounts` in strict mode.
- **Root cause:** I used a substring role-name selector in a navigation menu with related labels.
- **Prevention rule:** For navigation labels that are substrings of other labels, use exact role matching: `{ name: 'Accounts', exact: true }`.
- **Files affected:** `apps/web/e2e/account-detail.spec.ts`.

### 2026-05-20 LINT: OCR wrapper dropped caught error context

- **What went wrong:** The first OCR helper lint run failed because a thrown extraction error did not preserve the original caught error as `cause`.
- **Root cause:** I optimized the user-facing error message before checking the repo's `preserve-caught-error` lint rule.
- **Prevention rule:** When translating parser/OCR failures into domain errors, always attach the caught error via `{ cause: err }`.
- **Files affected:** `apps/api/src/lib/extract-text.ts`.

### 2026-05-20 TESTING: Intake E2E matched extraction text too broadly

- **What went wrong:** The first focused intake E2E rerun still matched multiple elements because the next-step control's accessible name included the substring `Extract`, and the preview initially served an old bundle.
- **Root cause:** I relied on a visible-label substring in a screen with related extraction copy, then reran before rebuilding the preview bundle.
- **Prevention rule:** Give step-navigation controls precise accessible names and rebuild the Vite preview bundle before rerunning focused Playwright checks.
- **Files affected:** `apps/web/src/pages/IntakePage.tsx`.

### 2026-05-20 BUILD: Cross-package typecheck ran before rebuilding shared exports

- **What went wrong:** API and web typecheck initially reported missing shared exports for the new RFP agent schemas because the consumers resolve `@bidstack/shared` through built output.
- **Root cause:** I added shared source exports and immediately typechecked downstream packages before running the shared package build.
- **Prevention rule:** After adding new exports to `packages/shared`, run `pnpm --filter @bidstack/shared build` before downstream package typechecks.
- **Files affected:** `packages/shared/src/schemas/rfp-agent.ts`, `packages/shared/src/schemas/index.ts`.

### 2026-05-20 TESTING: Opportunities page test leaked DOM between cases

- **What went wrong:** The focused Opportunities page test found two matching `Opportunities` headings because prior renders were still mounted.
- **Root cause:** The test file did not call Testing Library `cleanup()` after each case.
- **Prevention rule:** Component tests without a global cleanup setup must call `cleanup()` in `afterEach`, especially when multiple cases render the same page shell.
- **Files affected:** `apps/web/src/pages/OpportunitiesPage.test.tsx`.

### 2026-05-20 SECURITY: Inspected Claude settings before secret scanning

- **What went wrong:** I read `.claude/settings.json` directly and surfaced a hardcoded API-key-looking value in tool output before replacing it with an environment-variable placeholder.
- **Root cause:** I inspected command configuration before running a targeted secret-safe check.
- **Prevention rule:** Before reading local tool settings, search for key names and redact/patch hardcoded secrets before displaying config contents.
- **Files affected:** `.claude/settings.json`.

### 2026-05-20 SHELL: Recursive Claude directory listing timed out

- **What went wrong:** I recursively listed `.claude`, which traversed large worktrees and `node_modules` until the command timed out.
- **Root cause:** I used broad recursion instead of limiting inspection to the top-level command/config folders.
- **Prevention rule:** For `.claude` and `.codex`, inspect only known shallow paths first: settings, commands, agents, hooks, and rules. Exclude `worktrees`.
- **Files affected:** none.

### 2026-05-25 TESTING: Async webhook fan-out still ran inside query guard context

- **What went wrong:** Route tests failed after successful mutations because fire-and-forget webhook fan-out executed unbounded `findMany` calls inside the same guarded async context.
- **Root cause:** I focused on the foreground mutation path first and missed background work launched by the route.
- **Prevention rule:** Any database query reachable from a request, including queued or fire-and-forget fan-out, must use explicit pagination or bounded `take` values before running integration tests.
- **Files affected:** `apps/api/src/queues/webhook-delivery.ts`.

### 2026-05-25 BUILD: Shared schema changes require built dist refresh

- **What went wrong:** The API kept using stale shared package output until the shared package was rebuilt.
- **Root cause:** Consumer packages resolve `@bidstack/shared` through `dist`, not directly from source.
- **Prevention rule:** After changing shared schemas or exports, run `pnpm --filter @bidstack/shared build` before downstream typecheck/test gates.
- **Files affected:** `packages/shared/src/schemas/opportunity.ts`, `packages/shared/dist/*`.

### 2026-05-25 AUDIT: Transitive mobile advisories blocked root high audit

- **What went wrong:** High-severity advisories from transitive Expo mobile dependencies kept `pnpm audit --audit-level high` failing even though the CRM app code did not import those packages directly.
- **Root cause:** I treated the audit as an app-only gate at first instead of the root workspace dependency graph.
- **Prevention rule:** For root audit failures in transitive packages, prefer targeted `pnpm.overrides` plus a lockfile refresh, then rerun the root audit gate.
- **Files affected:** `package.json`, `pnpm-lock.yaml`.

### 2026-06-06 TESTING: Root tests used stale DB dist

- **What went wrong:** API tests still failed with compound Prisma selector errors after the source middleware fix because `@bidstack/db` resolves through `packages/db/dist`, and the root test script did not rebuild the DB package.
- **Root cause:** I patched DB source and immediately ran consumer tests without refreshing the exported workspace package output.
- **Prevention rule:** When changing any package consumed through `dist`, rebuild that package before downstream tests. The root `pnpm test` gate now builds `@bidstack/db` before running worker/API/MCP/web tests.
- **Files affected:** `package.json`, `packages/db/src/middleware/soft-delete.ts`.

### 2026-06-06 BACKEND: Soft-delete middleware broke compound unique lookups

- **What went wrong:** The middleware converted `findUnique({ where: { orgId_kind: ... } })` to `findFirst` but kept the compound unique alias, causing Prisma validation errors in dashboard widgets, company enrichment, and meeting-notes import.
- **Root cause:** The action rewrite changed the required Prisma argument shape, but the middleware did not normalize compound unique selectors into field filters.
- **Prevention rule:** Any Prisma middleware that rewrites actions must include argument-shape regression tests for scalar unique and compound unique selectors.
- **Files affected:** `packages/db/src/middleware/soft-delete.ts`, `packages/db/src/middleware/soft-delete.test.ts`.

### 2026-06-06 SHELL: Used `&&` in PowerShell verification

- **What went wrong:** I tried to chain two verification commands with `&&`, which this PowerShell runtime rejected before any tests ran.
- **Root cause:** I assumed a newer shell separator behavior instead of using one PowerShell command per verification.
- **Prevention rule:** Run verification commands separately in PowerShell unless the separator is already known to work in this environment.
- **Files affected:** none.

### 2026-06-06 TESTING: Generic signal row extractor missed article payloads

- **What went wrong:** The first Apollo public-news cross-check test failed because `rowsFromUnknown()` did not recognize `articles` as a collection key, so GDELT article results were ignored.
- **Root cause:** I reused a generic row extractor built around CRM/provider list names without adding the new public-news response shape.
- **Prevention rule:** When adding a provider response source, add a focused mapping test for its exact list key before assuming the shared extractor covers it.
- **Files affected:** `apps/worker/src/queues/company-enrich-apollo.ts`, `apps/worker/src/queues/company-enrich-apollo.test.ts`.

### 2026-06-06 SHELL: Reused reserved `$PID` while restarting local servers

- **What went wrong:** I used `$pid` as a loop variable while stopping the local API/Vite listeners. PowerShell treats `$PID` as a read-only automatic variable, so the cleanup did not stop the old listeners and new starts collided with them.
- **Root cause:** I repeated a known PowerShell variable-name trap.
- **Prevention rule:** Use `$procId`, `$ownerPid`, or `$processIdValue` for process loops. Never use `$pid` or `$PID`.
- **Files affected:** none.

### 2026-06-06 FRONTEND: Pipeline cards regressed to draggable anchors

- **What went wrong:** The pipeline card was rendered as a draggable React Router `Link`, reintroducing a previously documented bug where browser link-drag behavior can override the intended opportunity-id payload and make moves appear successful while the card stays put.
- **Root cause:** The split `PipelineCard` component drifted from `docs/solutions/drag-drop-not-on-anchor.md`, and the existing E2E only checked that drag did not throw instead of verifying board placement plus persisted API state.
- **Prevention rule:** Draggable CRM records must not be anchors. Add stable `data-testid`/stage attributes and reversible E2E that verifies both UI placement and backend persistence after a move.
- **Files affected:** `apps/web/src/pages/pipelineBoard/PipelineCard.tsx`, `StageColumn.tsx`, `apps/web/e2e/flows/pipeline.spec.ts`.

### 2026-06-06 TESTING: Page tests leaked exchange-rate fetches

- **What went wrong:** Web tests passed but printed happy-dom `AbortError` stacks after teardown.
- **Root cause:** Page tests for Territories and Opportunities mocked CRM data hooks but rendered `useFormatMoney`, which starts `fetchRates()` on mount. Because the tests did not stub that exchange-rate fetch, happy-dom aborted pending real fetch tasks during teardown.
- **Prevention rule:** Any test rendering a component that calls `useFormatMoney` or `useDisplayMoney` must either preload cached rates or stub `/api/v1/exchange-rates` with a settled response.
- **Files affected:** `apps/web/src/pages/TerritoriesPage.test.tsx`, `apps/web/src/pages/OpportunitiesPage.test.tsx`.

### 2026-06-06 TYPESCRIPT: Env helper used an overly strict ProcessEnv Pick

- **What went wrong:** The first MCP fail-closed rate-limit patch failed typecheck because the helper accepted `Pick<NodeJS.ProcessEnv, ...>`, which required optional process env keys to be present.
- **Root cause:** I used a narrow mapped type against `ProcessEnv` instead of a purpose-built object shape with optional keys.
- **Prevention rule:** Env helper seams should accept a small explicit interface such as `{ NODE_ENV?: string }`, not `Pick<ProcessEnv, ...>`.
- **Files affected:** `apps/mcp-server/src/plugins/hourly-rate-limit.ts`.

### 2026-06-06 SHELL: Assumed a test helper file existed

- **What went wrong:** I tried to read `apps/api/src/routes/opportunities.test-helpers.ts`, which does not exist.
- **Root cause:** I guessed the helper filename instead of listing matching route test files first.
- **Prevention rule:** When looking for test helpers, run `rg --files` or `Get-ChildItem` for the pattern before reading a specific path.
- **Files affected:** none.

### 2026-06-06 BACKEND: Reused contact filters for notes

- **What went wrong:** The first grounded opportunity-brief route returned 400 because it queried `Note` with `{ customer: ... }`, but notes use legacy `accountId`.
- **Root cause:** I reused an OR filter across models with different account field names, and TypeScript did not catch the loose Prisma filter shape.
- **Prevention rule:** Keep per-model account filters separate (`Contact.customer`, `Note.accountId`, optional shared `companyId`) and add route tests for generated brief endpoints, not just pure builder tests.
- **Files affected:** `apps/api/src/routes/opportunities.transitions.ts`, `apps/api/src/routes/opportunities.integration.test.ts`.

### 2026-06-06 SHELL: Passed ESLint flags through pnpm incorrectly

- **What went wrong:** I ran `pnpm --filter <pkg> lint -- --quiet`, which caused the package script `eslint .` to receive `--` and `--quiet` as file patterns instead of a flag.
- **Root cause:** I treated `pnpm run` argument forwarding like direct `eslint` execution.
- **Prevention rule:** For package lint flags, use `pnpm --filter <pkg> exec eslint . --quiet` or run the package lint script without extra flags.
- **Files affected:** none.

### 2026-06-06 TESTING: Parallel verification raced Prisma engine availability

- **What went wrong:** A worker Vitest run passed all tests but ended with an unhandled Prisma query-engine initialization error after Prisma client regeneration.
- **Root cause:** I ran multiple verification commands in parallel immediately after regenerating the Prisma client on Windows, where the query engine DLL is frequently renamed/recreated by the local workaround.
- **Prevention rule:** After `pnpm db:generate` on Windows, confirm `packages/db/generated/client/query_engine-windows.dll.node` exists and run Prisma-dependent tests serially before parallelizing other gates.
- **Files affected:** none.

### 2026-06-06 TESTING: Root API tests ran against an unmigrated local DB

- **What went wrong:** Root `pnpm test` reached API integration tests but failed with missing-column errors for `crews.standard_key` and `review_issues.proposal_id`.
- **Root cause:** The Prisma schema/client and migration files had the new additive columns, but the local `DATABASE_URL` database was still behind those migrations.
- **Prevention rule:** When a root test failure is a missing DB column/table, check the masked `DATABASE_URL` target, apply non-destructive pending migrations with `pnpm db:migrate:deploy`, then rerun the focused suites before broad gates.
- **Files affected:** local database only.

### 2026-06-06 SHELL: Probed workspace env with the wrong package context

- **What went wrong:** I tried to import `dotenv-flow` from root-level `node`/`pnpm exec node`, but `dotenv-flow` is installed in workspace packages, not at the root.
- **Root cause:** I ignored pnpm's package-scoped dependency boundary for a one-off diagnostic command.
- **Prevention rule:** For package-owned dependencies, run one-off diagnostics through `pnpm --filter <package> exec ...` from that package context.
- **Files affected:** none.

### 2026-06-06 TESTING: Nested worker-thread tests crashed Vitest on Windows

- **What went wrong:** The worker preflight exited with native code `3221225477` after `extract-text-sandbox.test.ts` assertions passed.
- **Root cause:** The sandbox worker's pdf-parse v2 path did not call `PDFParse.destroy()`, and the parent also terminated the worker immediately after a normal message. Even after cleanup, pdf-parse in `worker_threads` remained unstable on Windows; the same parser in a plain child process exited cleanly.
- **Prevention rule:** Run the worker suite through the repo wrapper with `--pool=forks`, call parser cleanup methods in `finally`, reserve `worker.terminate()` for timeout/crash paths, and route PDFs through a process sandbox rather than a thread sandbox.
- **Files affected:** `scripts/run-worker-tests.mjs`, `apps/worker/src/lib/extract-text-process-worker.ts`, `apps/worker/src/lib/extract-text-worker.ts`, `apps/worker/src/lib/extract-text-sandbox.ts`, `docs/solutions/worker-vitest-wrapper-windows.md`.

### 2026-06-07 TESTING: Assumed a shared audit-log schema test existed

- **What went wrong:** I ran `pnpm --filter @bidstack/shared test -- --run src/schemas/audit-log.test.ts`, which failed because no such test file exists.
- **Root cause:** I assumed schema tests existed before checking the package's test files.
- **Prevention rule:** Before focused test commands, verify the test path with `rg --files`; for schema-only export changes, prefer `pnpm --filter @bidstack/shared build` and `typecheck` unless a real test file exists.
- **Files affected:** none.

### 2026-06-07 SHELL: Parsed API-owned XLSX from the wrong package context

- **What went wrong:** A live audit XLSX smoke downloaded the file successfully but the parsing command failed because root-level `node` could not resolve `@e965/xlsx`.
- **Root cause:** `@e965/xlsx` is owned by the API package, not the root workspace context.
- **Prevention rule:** One-off diagnostics that import package-owned dependencies must run through `pnpm --filter <package> exec ...`.
- **Files affected:** none.

### 2026-06-07 SHELL: Over-escaped a simple rg search in PowerShell

- **What went wrong:** I tried to count `lucide-react` imports with a quote-heavy escaped command and PowerShell rejected it before `rg` ran.
- **Root cause:** I used shell-escaped regex syntax for a simple literal search.
- **Prevention rule:** For simple literal searches in PowerShell, use `rg -n 'literal' path` and avoid quote-heavy regexes unless they are actually needed.
- **Files affected:** none.

### 2026-06-07 BACKEND: Generic mutation audit was too broad at first

- **What went wrong:** The first mutation-audit safety-net version wrote a generic audit row for every authenticated successful mutation, including routes that already create rich domain audit rows.
- **Root cause:** I optimized for "everything is tracked" without first separating unaudited route families from already-audited hot paths.
- **Prevention rule:** Request-level mutation audit must be a safety net for unaudited route families, not a duplicate audit row on rich domain routes. Verify with full API tests, not only focused plugin tests.
- **Files affected:** `apps/api/src/plugins/mutation-audit.ts`, `apps/api/src/plugins/mutation-audit.test.ts`, `docs/solutions/mutation-audit-safety-net.md`.

### 2026-06-07 SHELL: Fumbled one-off API route inventory commands

- **What went wrong:** The first Fastify route inventory probes failed because I mixed top-level await in `tsx -e`, missed `dotenv-flow` loading, used the wrong import context, and waited on server shutdown handles longer than needed.
- **Root cause:** I treated a package-scoped diagnostic like a generic root shell snippet instead of constructing the command around the API package runtime.
- **Prevention rule:** For API route inventory diagnostics, run through `pnpm --filter @bidstack/api exec tsx`, import `dotenv-flow/config`, use an async IIFE or explicit `process.exit(0)` after printing, and keep the import path rooted to the current command context.
- **Files affected:** none.

### 2026-06-07 TESTING: Let Redis-backed rate limits leak between API test runs

- **What went wrong:** Full API tests started returning 429 for CRM company enrichment routes after repeated runs.
- **Root cause:** The API registered `@fastify/rate-limit` with Redis in `NODE_ENV=test`, so route-specific counters persisted across independent Vitest invocations.
- **Prevention rule:** Test-mode API servers should keep rate-limit counters process-local unless a test explicitly verifies Redis-backed limiting. Production/dev may use Redis; tests need isolation.
- **Files affected:** `apps/api/src/server.ts`.

### 2026-06-07 TESTING: Used random four-digit opportunity codes in persistent DB fixtures

- **What went wrong:** Penetration tests failed on rerun with a unique constraint collision on `(org_id, code)`.
- **Root cause:** The fixture used `OP-1000..9999`, which is not collision-proof when old test rows survive or tests run repeatedly.
- **Prevention rule:** Persistent DB fixtures with unique constraints need UUID-backed values, not small random ranges.
- **Files affected:** `apps/api/src/security/penetration.test-helpers.ts`.

### 2026-06-07 BACKEND: Audit export limit could under-report truncation

- **What went wrong:** XLSX export metadata could say `Truncated by limit: no` when the export hit its row limit inside an already-fetched batch.
- **Root cause:** The truncation check only looked for another database page after the batch cursor and did not remember that unprocessed matching rows could still exist later in the current batch.
- **Prevention rule:** Export collectors must set truncation as soon as the limit is reached before the fetched batch is fully inspected, then preserve that flag through later checks.
- **Files affected:** `apps/api/src/routes/audit-logs.ts`, `apps/api/src/routes/audit-logs.test.ts`, `docs/solutions/audit-log-server-side-xlsx-export.md`.

### 2026-06-07 SHELL: Used a malformed regex while checking the Prisma schema

- **What went wrong:** A schema search command failed with an unopened-regex-group error.
- **Root cause:** I tried to combine two patterns and a path in one `rg` expression instead of using a simple literal search or separate `rg` calls.
- **Prevention rule:** For schema location checks, prefer `rg -n 'model Name' path` and then read nearby lines; avoid compound regexes unless they are tested.
- **Files affected:** none.

### 2026-06-07 TESTING: Sent nullable parentId to a non-nullable create contract

- **What went wrong:** The new company CRUD audit integration test failed with `400` on create because the payload sent `parentId: null`.
- **Root cause:** `CompanyCreate` makes `parentId` optional, not nullable, while `CompanyPatch` allows nullable parent clearing.
- **Prevention rule:** Before writing route tests, inspect the exact shared create/patch schemas and match their optional-vs-nullable contract.
- **Files affected:** `apps/api/src/routes/companies.test.ts`.

### 2026-06-07 BROWSER: Used DOM constructors in the in-app browser read-only scope

- **What went wrong:** A browser inspection script used `instanceof HTMLAnchorElement` and failed because the in-app browser's restricted evaluate scope did not expose that constructor.
- **Root cause:** I assumed normal browser globals were available inside the Codex browser runtime's read-only evaluation wrapper.
- **Prevention rule:** In in-app browser `evaluate` checks, prefer plain `tagName` and attribute reads instead of `instanceof` or constructor-based DOM checks.
- **Files affected:** none.

### 2026-06-13 TESTING: Normalized green Vitest runs with teardown fetch noise

- **What went wrong:** Full web tests passed but still printed happy-dom `DOMException [AbortError]` during teardown because incidental money-format hook renders started unmanaged exchange-rate fetches.
- **Root cause:** Page/component tests mocked their business data hooks but did not own mount-time `useFormatMoney()` / `useDisplayMoney()` exchange-rate side effects.
- **Prevention rule:** Do not accept noisy green gates. Component tests that render money formatting must either stub/cache rates or rely on the test-mode hook auto-fetch guard; direct currency-store tests should call `fetchRates()` explicitly with an owned fetch stub.
- **Files affected:** `apps/web/src/hooks/useFormatMoney.ts`, `apps/web/src/hooks/useDisplayMoney.ts`, `docs/solutions/test-owned-exchange-rate-fetches.md`.

### 2026-06-14 FRONTEND: Trusted React Query freshness while browser HTTP cache stayed stale

- **What went wrong:** The pipeline stale-data regression first looked like a React Query invalidation gap, but a manual browser run proved `GET /api/opportunities?limit=50` could be served from browser HTTP cache after an API-created record.
- **Root cause:** JSON API fetches did not set `cache: 'no-store'`; React Query was refetching, but the browser was allowed to satisfy that refetch from HTTP cache.
- **Prevention rule:** Authenticated API clients must set `cache: 'no-store'` at the fetch layer, and stale-data E2E tests should create data through the API after warming a page.
- **Files affected:** `apps/web/src/lib/api.ts`, `apps/web/src/hooks/useOpportunities.ts`, `apps/web/e2e/flows/pipeline.spec.ts`, `docs/solutions/browser-http-cache-and-api-freshness.md`.

### 2026-06-14 PWA: Let the service worker touch API/auth/export traffic

- **What went wrong:** The app shell service worker could synthesize stale or misleading responses for endpoints that must always hit the network.
- **Root cause:** The worker cached too broadly and treated API-like failures as offline app-shell concerns.
- **Prevention rule:** Service workers may cache static shell assets, but must bypass `/api`, auth, export, data, and cross-origin requests.
- **Files affected:** `apps/web/public/sw.js`, `apps/web/src/main.tsx`, `docs/solutions/service-worker-api-bypass-and-streaming-cors.md`.

### 2026-06-14 BACKEND: Streamed exports outside Fastify's reply path

- **What went wrong:** Opportunity CSV export downloaded, but raw stream handling could bypass Fastify header/CORS/security behavior.
- **Root cause:** The route wrote directly to `reply.raw` instead of sending a stream through Fastify.
- **Prevention rule:** Export routes should set headers on `reply` and `reply.send(stream)` so platform hooks remain attached.
- **Files affected:** `apps/api/src/routes/opportunities.export.ts`, `docs/solutions/service-worker-api-bypass-and-streaming-cors.md`.

### 2026-06-14 BACKEND: Allocated opportunity codes by lexicographic order

- **What went wrong:** Code allocation could choose the wrong next `OP-` code once suffixes crossed digit-width boundaries.
- **Root cause:** String ordering treats `OP-9999` as greater than `OP-10000`.
- **Prevention rule:** Code allocators must parse and compare numeric suffixes, with integration coverage around digit-width transitions.
- **Files affected:** `apps/api/src/routes/opportunities.helpers.ts`, `apps/api/src/routes/opportunities.mutations.ts`, `apps/api/src/routes/opportunities.integration.test.ts`, `docs/solutions/numeric-opportunity-code-allocation.md`.

### 2026-06-16 AUTH: Gated SERUM status with the wrong permission

- **What went wrong:** The first SERUM status route used `agents:read`, which blocked the admin settings/control-plane read during stub-auth QA.
- **Root cause:** I treated SERUM as an agent surface instead of the settings-owned control-plane status it powers in this slice.
- **Prevention rule:** For read-only admin settings and control-plane health endpoints, map the permission to the visible owner surface first, then verify with a rendered stub-admin request before wiring the UI.
- **Files affected:** `apps/api/src/routes/serum.ts`, `docs/solutions/serum-control-plane-safe-foundation.md`.

### 2026-06-16 FRONTEND: Mixed Radix Dialog parts with Framer in a brittle mobile drawer path

- **What went wrong:** A first attempt to remove the mobile nav ref warning left the drawer translated off-canvas, so the close button was visible to the locator but outside the viewport.
- **Root cause:** The Framer/Radix bridge did not animate the Radix content back to `translateX(0)` in the live mobile smoke test.
- **Prevention rule:** For Radix dialog shell animation, prefer Radix parts plus CSS `data-state` keyframes unless a rendered mobile smoke proves the Framer bridge is clickable and warning-free.
- **Files affected:** `apps/web/src/components/layout/MobileNav.tsx`, `apps/web/src/index.css`, `docs/solutions/serum-control-plane-safe-foundation.md`.

### 2026-06-16 SHELL: Reused PowerShell's reserved `$PID` variable in cleanup loop

- **What went wrong:** A QA server cleanup command failed before stopping local dev processes because the loop variable was named `$pid`.
- **Root cause:** PowerShell variable names are case-insensitive, and `$PID` is a read-only automatic variable.
- **Prevention rule:** In PowerShell process loops, use names like `$processId` or `$targetProcessId`; never use `$pid` as an assignment target.
- **Files affected:** none.

### 2026-06-16 FRONTEND: Mode switch used tab semantics for route navigation

- **What went wrong:** Critical controls Playwright could not find the board switch as a button because the opportunities list/board switch used `role=tab` without real tab panels.
- **Root cause:** A route-level segmented control had been modeled as tabs, blending navigation and tab semantics.
- **Prevention rule:** Use segmented buttons with `aria-pressed` for route/view switches; reserve `role=tablist` for tab panels that remain on the same screen.
- **Files affected:** `apps/web/src/components/opportunity/PipelineViewSwitch.tsx`, `docs/solutions/serum-control-plane-safe-foundation.md`.

### 2026-06-16 FRONTEND: Sent account overrides with a display id instead of the backend lookup key

- **What went wrong:** Account field overrides could be saved from the cockpit but fail to reappear for enriched/verified accounts because the UI sent `cockpit.company.id`.
- **Root cause:** The backend stores and reads field overrides by normalized company name, while the component assumed the display/id field was the durable lookup key.
- **Prevention rule:** When an API route accepts a free-form `:key`, trace the write path and read path before wiring UI mutations; component tests must assert the exact mutation URL for key identity.
- **Files affected:** `apps/web/src/components/cockpit/KpiRow.tsx`, `apps/web/src/components/cockpit/KpiRow.test.tsx`.

### 2026-06-16 A11Y: Nested hidden file input inside a custom dropzone

- **What went wrong:** The real account cockpit axe scan reported a critical unlabeled file input and a serious nested-interactive violation in the upload dropzone.
- **Root cause:** A visually hidden `<input type="file">` lived inside a clickable `role="button"` dropzone and had no accessible name.
- **Prevention rule:** Hidden file inputs need an explicit label or `aria-label` and should sit beside custom dropzones, not inside another interactive control; run axe against composed routes that include shared widgets.
- **Files affected:** `apps/web/src/components/files/FilesPanel.tsx`.

### 2026-06-16 TESTING: Used jest-dom matchers in a Vitest file without jest-dom setup

- **What went wrong:** New cockpit component tests failed with `Invalid Chai property: toBeInTheDocument`.
- **Root cause:** I copied a common Testing Library assertion style into a test package that does not load jest-dom matchers globally.
- **Prevention rule:** Before using matcher extensions in this repo, inspect nearby tests or use plain truthy/null assertions unless the setup file explicitly loads the matcher library.
- **Files affected:** `apps/web/src/components/cockpit/BusinessSnapshotCard.test.tsx`, `apps/web/src/components/cockpit/TechStackCard.test.tsx`.

### 2026-06-16 TESTING: Partially mocked Framer without AnimatedNumber dependencies

- **What went wrong:** `BusinessSnapshotCard.test.tsx` crashed in `AnimatedNumber` because the `framer-motion` mock omitted `useMotionValue`.
- **Root cause:** The card indirectly renders `AnimatedMetric`, which depends on `AnimatedNumber`; the first mock only covered `motion.*` and `useReducedMotion`.
- **Prevention rule:** When a component renders `AnimatedMetric` or `AnimatedNumber`, copy the complete local Framer test mock shape: `motion`, `animate`, `useMotionValue`, and `useReducedMotion`.
- **Files affected:** `apps/web/src/components/cockpit/BusinessSnapshotCard.test.tsx`.

### 2026-06-16 QA: Tested new routes against stale dev servers

- **What went wrong:** Browser QA initially reported `PUT /technical-stack` as missing even though the route was implemented.
- **Root cause:** The already-running `4000/5173` local servers had not picked up the new API route, so the browser was testing stale runtime code.
- **Prevention rule:** Before live QA for new routes, restart or start a fresh API/web pair and verify the browser target is pointed at that pair.
- **Files affected:** none.

### 2026-06-16 QA: Repeated stale-server false negative on SERUM status

- **What went wrong:** Browser QA reproduced `SERUM status is unavailable` on the existing `5173/4000` target after the stale-server prevention rule was already logged.
- **Root cause:** I trusted an already-running local process before probing whether the exact backend target had the current route table; the `4000` API process had started on 2026-06-15 and returned 404 for `/api/v1/serum/status`.
- **Prevention rule:** Before claiming a browser failure is product behavior, run a direct HTTP probe against the exact browser proxy target and the backing API, record process start time, and switch to a fresh server pair if the process predates the current slice.
- **Files affected:** none.

### 2026-06-16 FRONTEND: Empty async API state erased visible fallback data

- **What went wrong:** The first technical-stack hook integration could render an empty stack after the async technical-stack API returned an unsaved empty state, hiding the provider/default stack already visible in the cockpit snapshot.
- **Root cause:** The UI treated "API loaded but no override exists" the same as "user saved an empty curated stack."
- **Prevention rule:** Distinguish unsaved empty server state from explicit saved empty overrides with a durable marker such as `updatedAt`; component tests must cover the async fallback path.
- **Files affected:** `apps/web/src/components/cockpit/TechStackCard.tsx`, `apps/web/src/components/cockpit/TechStackCard.test.tsx`.

### 2026-06-16 QA: Forced browser API requests cross-origin during local verification

- **What went wrong:** The first SERUM/account browser smoke used `VITE_API_URL=http://127.0.0.1:4001`, so the browser fetched the API directly and hit expected dev CORS blocks instead of testing the normal same-origin Vite proxy path.
- **Root cause:** I used the production-style client API base to reach a fresh local API, instead of giving the dev server proxy its own server-only override.
- **Prevention rule:** For local browser QA on shifted ports, keep `VITE_API_URL` empty and set `BIDSTACK_DEV_API_URL` for the Vite proxy; verify served `api.ts` before trusting browser results.
- **Files affected:** `apps/web/vite.config.ts`, `docs/solutions/account-access-scope-and-dev-proxy-verification.md`.

### 2026-06-16 E2E: Asserted component fallbacks instead of localized UI copy

- **What went wrong:** The new Top Accounts E2E expected the fallback heading `Account Ranking`, but the loaded English locale renders `Top accounts`.
- **Root cause:** I read the component fallback string and did not verify the actual runtime locale before writing the Playwright assertion.
- **Prevention rule:** For UI E2E assertions, prefer the rendered accessibility snapshot or locale JSON over component fallback text; fallback strings are not the product copy when translations are loaded.
- **Files affected:** `apps/web/e2e/serum-account-experience.spec.ts`.

### 2026-06-16 E2E: Used an ambiguous heading locator on SERUM settings

- **What went wrong:** The new SERUM settings E2E failed because `SERUM Control Plane` appeared as two legitimate headings on the page.
- **Root cause:** I used a strict `getByRole('heading', { name })` without scoping or selecting the first matching landmark.
- **Prevention rule:** When a page intentionally repeats section labels, scope Playwright locators to a region or use `.first()` only after verifying both matches are valid visible UI, not duplicates caused by a render bug.
- **Files affected:** `apps/web/e2e/serum-account-experience.spec.ts`.

### 2026-06-16 TESTING: Bundle budget mislabeled lazy route payload as initial payload

- **What went wrong:** The bundle budget spec claimed to measure initial JavaScript but summed every JavaScript file in `dist/assets`, including lazy route chunks.
- **Root cause:** The test ignored the Vite manifest entry/import graph and treated build output storage location as load order.
- **Prevention rule:** Initial payload budgets must derive from the Vite manifest entrypoint and static imports; keep lazy-route growth covered by a separate per-chunk or route-level budget.
- **Files affected:** `apps/web/e2e/performance/bundle-size-budget.spec.ts`, `docs/solutions/e2e-type-and-performance-budget-gates.md`.

### 2026-06-16 PERF: Animated dense shell layout properties hurt INP

- **What went wrong:** Sidebar collapse motion animated grid/layout properties in the primary CRM shell, adding avoidable reflow during interaction timing probes.
- **Root cause:** Decorative motion was allowed on structural layout properties inside a dense, always-mounted application shell.
- **Prevention rule:** For app-shell navigation in data-heavy CRM screens, avoid animating grid tracks, widths, padding, or other layout-driving properties; reserve motion for opacity/transform and verify with the Core Web Vitals suite.
- **Files affected:** `apps/web/src/index.css`, `apps/web/e2e/performance/core-web-vitals.spec.ts`, `docs/solutions/e2e-type-and-performance-budget-gates.md`.

### 2026-06-16 QA: API route tests skipped the worker lane for contract extraction

- **What went wrong:** Contract approval coverage proved API guards but the extraction-start test intentionally skipped the worker in test mode, leaving the real stored-document-to-draft path unproven.
- **Root cause:** The production contract processor was only reachable through BullMQ, so tests had to choose between queue timing and no worker execution.
- **Prevention rule:** Queue processors that own launch-critical transformations need a direct processor seam plus an integration test that runs the same code path against real persisted input; route tests alone do not prove worker behavior when queues are skipped.
- **Files affected:** `apps/worker/src/queues/document-extract.ts`, `apps/worker/src/queues/document-extract.contract.test.ts`, `docs/solutions/contract-extraction-review-gates.md`.

### 2026-06-16 E2E: Spawned a worker from a Playwright spec with raw Windows env

- **What went wrong:** The first browser/API/worker contract proof failed with `spawn EINVAL` when the Playwright spec tried to launch the document worker directly.
- **Root cause:** The test mixed Windows child-process environment semantics with product assertions and put service lifecycle inside the spec instead of the Playwright service layer.
- **Prevention rule:** For local service dependencies in Playwright, prefer `webServer` with a health URL and explicit env. If a Windows spawn is unavoidable, sanitize hidden `=X:` env keys and keep process lifecycle outside assertions.
- **Files affected:** `apps/web/e2e/serum-account-experience.spec.ts`, `apps/web/playwright.config.ts`.

### 2026-06-16 E2E: Focused worker harness missed dotenv bootstrap

- **What went wrong:** The Playwright-managed document worker started but failed DB health because `DATABASE_URL` was not loaded.
- **Root cause:** The standalone E2E worker harness did not mirror `apps/worker/src/main.ts` env bootstrap before importing Prisma-backed code.
- **Prevention rule:** Any standalone worker harness that imports Prisma or queue processors must bootstrap env from the repo root before DB health checks or job execution.
- **Files affected:** `apps/worker/src/e2e/document-extract-worker.ts`.

### 2026-06-16 QA: Used Bash heredoc syntax in PowerShell

- **What went wrong:** A PDF fixture assertion failed before running because I used `python - <<'PY'` in a PowerShell shell.
- **Root cause:** I carried over Bash heredoc muscle memory even though this workspace runs commands through PowerShell.
- **Prevention rule:** In PowerShell sessions, pipe a single-quoted here-string into the interpreter: `@' ... '@ | python -`.
- **Files affected:** none.

### 2026-06-16 E2E: Tried to prove current source by mounting it into a stale worker image

- **What went wrong:** A Dockerized OCR worker proof failed on package export/dependency resolution after mounting current `dist` into an older `bidcrm-worker:latest` image.
- **Root cause:** The image's package metadata and pnpm symlink topology predated the current source, so the runtime was no longer a coherent build artifact.
- **Prevention rule:** For OCR-capable browser E2E, rebuild the worker image from the current worktree or run the local source worker with native OCR installed; do not mix current `dist` with stale workspace metadata.
- **Files affected:** `apps/web/playwright.config.ts`, `docs/solutions/contract-extraction-review-gates.md`.

### 2026-06-16 DOCKER: Standalone worker image drifted from workspace manifests

- **What went wrong:** The standalone worker Dockerfile claimed to mirror the root worker target but did not copy every active workspace package manifest and used a non-frozen install.
- **Root cause:** The monorepo workspace grew (`apps/marketing`, `packages/integrations`) while the standalone Dockerfile was not updated with the root Dockerfile.
- **Prevention rule:** Any service-specific Dockerfile in a pnpm workspace must copy the same active workspace package manifests as the root install stage and use the lockfile with a pnpm cache mount.
- **Files affected:** `apps/worker/Dockerfile`.

### 2026-06-16 OCR: Alpine worker missed Tesseract OSD data

- **What went wrong:** OCRmyPDF failed scanned-PDF extraction with `Error opening data file /usr/share/tessdata/osd.traineddata` in the freshly built standalone worker image.
- **Root cause:** The Alpine worker installed English trained data but not Tesseract orientation/script detection data, which OCRmyPDF can require even when `BIDSTACK_OCR_LANGUAGES=eng`.
- **Prevention rule:** Alpine OCR worker images must install `tesseract-ocr-data-eng` and `tesseract-ocr-data-osd`; smoke tests must run actual `extractTextFromBuffer` against an image-only PDF, not only version checks.
- **Files affected:** `apps/worker/Dockerfile`, `docs/solutions/contract-extraction-review-gates.md`.

### 2026-06-16 E2E: Dockerized health endpoint bound container loopback

- **What went wrong:** The focused document worker health server bound `127.0.0.1`, which is fine for a local Playwright-managed process but not for a Dockerized external worker exposed with port publishing.
- **Root cause:** The E2E harness hard-coded the listen host instead of making the bind address configurable per runtime.
- **Prevention rule:** Any harness that can run both as a local process and in Docker needs a host env override; keep local loopback as the default and use `0.0.0.0` only for container health exposure.
- **Files affected:** `apps/worker/src/e2e/document-extract-worker.ts`, `docs/solutions/contract-extraction-review-gates.md`.

### 2026-06-16 API: File finalize used brittle interactive transaction

- **What went wrong:** Browser drag/drop upload intermittently failed at `/api/v1/files/finalize` with Prisma `P2028` because the interactive transaction exceeded the default 5s timeout under local DB IO pressure.
- **Root cause:** The endpoint used an interactive transaction for two deterministic writes even though a pre-generated file UUID allows a batch transaction.
- **Prevention rule:** For simple atomic multi-write API endpoints, prefer batch transactions with pre-generated IDs over interactive Prisma transactions; browser E2E must cover upload-url, local upload, finalize, cleanup, and slow local DB conditions.
- **Files affected:** `apps/api/src/routes/files.ts`, `apps/web/e2e/serum-account-experience.spec.ts`.

### 2026-06-16 DOCKER: Timed-out Docker commands left orphaned CLI clients

- **What went wrong:** Long `docker build` / `docker run` calls timed out from the shell but left `docker` and `docker-buildx` client processes running, after which new `docker run` calls hung even for small images.
- **Root cause:** The command wrapper killed its wait, not every spawned Docker client process, and the heavy image workflow stressed Docker Desktop.
- **Prevention rule:** After Docker command timeouts on Windows, inspect `Get-Process docker,docker-buildx` and stop only orphaned CLI clients before retrying; do not restart Docker Desktop without explicit coordination because unrelated containers may be running.
- **Files affected:** none.

### 2026-06-16 DOCKER: Treated an existing image tag as a fresh OCR artifact

- **What went wrong:** A tagged worker image existed after a timed-out build, but probing the runtime showed only `eng` Tesseract data and not `osd`.
- **Root cause:** I checked for tag existence before proving the artifact contents, and the timed-out build left ambiguity about whether the current Dockerfile reached the runtime layer.
- **Prevention rule:** For native/OCR packaging gates, verify the image contents directly (`tesseract --list-langs`, required binaries, and scanned-fixture extraction) before calling the Docker artifact green.
- **Files affected:** `apps/worker/Dockerfile`, `docs/solutions/contract-extraction-review-gates.md`.

### 2026-06-16 MEMORY: PowerShell double-quoted here-string corrupted baton Markdown

- **What went wrong:** A shared-memory baton update containing Markdown backticks was appended through a double-quoted PowerShell here-string, turning sequences such as `` `t ``, `` `0 ``, and `` `r `` into tab, NUL, and carriage-return control characters.
- **Root cause:** PowerShell treats backticks as escape characters in double-quoted strings and here-strings.
- **Prevention rule:** When appending Markdown from PowerShell, use single-quoted here-strings (`@' ... '@`) or `apply_patch`; never write Markdown with backticks through a double-quoted here-string.
- **Files affected:** `E:\Full Knowledge\Home Server\_relay\BATON.md`.

### 2026-06-16 DOCKER: Generated Prisma engines bloated build context to 8.78 GB

- **What went wrong:** The standalone worker Docker build looked hung because `COPY . .` was sending an 8.78 GB context into Docker.
- **Root cause:** `.dockerignore` allowed `packages/db/generated`, which had accumulated stale Windows Prisma query-engine `.old` files; Docker runs `pnpm db:generate` anyway, so these generated files were unnecessary source context.
- **Prevention rule:** Exclude generated DB clients, stale engine backups, local tool caches, coverage, screenshots, and QA artifacts from Docker context. Verify context size in Docker output when a build feels slow.
- **Files affected:** `.dockerignore`, `packages/db/generated`.

### 2026-06-16 DOCKER: Root worker target depended on full-product builder

- **What went wrong:** The root `Dockerfile --target worker` path could not be certified locally because it dragged the full web/API/MCP builder path into a worker-only image build before hitting the heavier Debian runtime layers.
- **Root cause:** The root Dockerfile had one monolithic `builder` stage shared by every deploy target, so a worker deploy inherited unrelated build work.
- **Prevention rule:** Multi-target Dockerfiles need target-specific builder stages for expensive deployables; worker-only images should build only worker dependencies/artifacts, then probe the exact final image.
- **Files affected:** `Dockerfile`.

### 2026-06-17 DOCKER: Recursive runtime chown made deploy images look hung

- **What went wrong:** Root Docker image targets timed out or took many extra minutes while exporting runtime layers that ran `chown -R /app` over pnpm workspace installs, generated Prisma engines, and built artifacts.
- **Root cause:** Ownership was rewritten after copying large dependency trees, creating a huge extra layer instead of assigning ownership during copy.
- **Prevention rule:** In Docker runtime stages, create the non-root user before artifact copies and use `COPY --chown` for built outputs; avoid recursive ownership rewrites over `/app` unless the copied tree is known small.
- **Files affected:** `Dockerfile`, `docs/solutions/contract-extraction-review-gates.md`.

### 2026-06-17 DOCKER: Repeated stage patterns made a patch hit the wrong target

- **What went wrong:** A narrow deletion meant for the worker target briefly removed the API target's user-creation step because the same `RUN addgroup ... && chown -R` pattern appeared in multiple Dockerfile stages.
- **Root cause:** I patched an instruction by repeated text instead of anchoring the edit to the stage and then checked the diff after the fact.
- **Prevention rule:** For multi-stage Dockerfiles, inspect all repeated instructions with `Select-String` before and after line-level patches; verify each touched target builds and runs with `id` when changing non-root user setup.
- **Files affected:** `Dockerfile`.

### 2026-06-17 TEST: Page unit test passed while background queries hit the API

- **What went wrong:** `OpportunitiesPage.test.tsx` mocked `useOpportunities` but still mounted real `usePipelineStages` and `useTerritorySegments` queries, so Vitest passed while printing six `ECONNRESET` socket errors after the assertions.
- **Root cause:** The test mocked the page's primary data hook but not the supporting query hooks introduced by the premium industry/pipeline experience.
- **Prevention rule:** When unit-testing a React Query page, mock every mounted query hook or provide a deliberate test API layer; rerun the full suite and treat clean stderr as part of the pass condition.
- **Files affected:** `apps/web/src/pages/OpportunitiesPage.test.tsx`.

### 2026-06-17 TEST: Auth E2E used URL shape instead of app-shell semantics

- **What went wrong:** The new WebKit cross-browser gate failed the stub-auth smoke test even though the authenticated app shell was visible, because the page object only treated `/dashboard` or `/pipeline` URLs as proof of stub mode.
- **Root cause:** The test encoded an incidental redirect path rather than the user-visible contract of "authenticated app shell, no login form."
- **Prevention rule:** Auth and shell E2E helpers must assert semantic landmarks and controls (`main`, primary navigation, login-form absence) instead of depending on browser-specific redirect URL shape.
- **Files affected:** `apps/web/e2e/pages/LoginPage.ts`, `apps/web/playwright.config.ts`, `docs/solutions/cross-browser-e2e-core-gate.md`.

### 2026-06-17 TEST: Browser RBAC test waited on incidental page data

- **What went wrong:** The first real browser RBAC spec waited for `/me/capabilities` after navigating to Settings, but that screen did not make the request in the tested path, so Chromium burned the full 60s timeout despite the role override working.
- **Root cause:** The test relied on an incidental page composition detail instead of directly exercising the authorization contract it needed to prove.
- **Prevention rule:** Browser RBAC specs should explicitly fetch the capability manifest from browser origin with the tested role header, then separately assert visible route/control behavior.
- **Files affected:** `apps/web/e2e/flows/rbac.spec.ts`, `docs/solutions/cross-browser-e2e-core-gate.md`.

### 2026-06-17 TEST: RFP load gate drifted from schema and queue contract

- **What went wrong:** `pnpm load-test:rfp` could not certify the RFP upload path: the root script depended on undeclared packages, initialized Prisma before env loading, created stale `FileAttachment` data, reused one `rfpRequestId` across concurrent uploads, and only cleaned file rows.
- **Root cause:** The load harness lived at the repo root but imported package-local runtime dependencies and encoded old schema/queue assumptions. The upload route also created document rows before the unique orchestration guard, so duplicate submissions could leave partial records.
- **Prevention rule:** Root certification scripts must declare direct root dependencies, load env before importing DB clients, generate unique business IDs for concurrent load, and clean every artifact they create. Backend writes that depend on a uniqueness guard must be in one DB transaction.
- **Files affected:** `scripts/load-test-rfp.ts`, `apps/api/src/routes/rfp-pipeline.ts`, `apps/api/src/routes/rfp-pipeline.upload.integration.test.ts`, `docs/solutions/rfp-upload-load-gate-harness.md`.

### 2026-06-17 TEST: Root k6 gate depended on local tools and skipped CRM auth paths

- **What went wrong:** `pnpm load-test` required a locally installed `k6` binary, skipped authenticated CRM routes when no token was provided, and treated intentional search `429` back pressure as a failed infrastructure response.
- **Root cause:** The gate did not model the local dev-stub auth mode or the per-user search rate limit, and it relied on developer workstation state instead of owning its runner.
- **Prevention rule:** Root load gates must own their runtime path with a pinned Docker fallback, exercise authenticated routes under local stubs by default, threshold endpoint checks explicitly, and encode expected rate-limit behavior per endpoint.
- **Files affected:** `package.json`, `scripts/run-k6-load-test.mjs`, `scripts/load-test.js`, `docs/solutions/k6-load-gate-docker-fallback.md`.

### 2026-06-17 OPS: PowerShell cleanup used reserved variable and optimistic success output

- **What went wrong:** Temporary API cleanup used `$pid` as a loop variable, which conflicts with PowerShell's read-only `$PID`, then a log cleanup loop printed `removed ...` even though `Remove-Item` failed because the parent `tsx watch` process still held the handles.
- **Root cause:** The cleanup command did not use a safe variable name or `-ErrorAction Stop` before printing success.
- **Prevention rule:** In PowerShell process cleanup, avoid reserved automatic variables (`$PID`, `$Host`, `$Error`, etc.) and emit success only after a command succeeds with `-ErrorAction Stop`.
- **Files affected:** none.

### 2026-06-17 SECURITY: Observability override broke the API test runtime

- **What went wrong:** The first dependency remediation attempted to force `@opentelemetry/core` onto a patched line without upgrading the Sentry/OpenTelemetry packages that consume it, and API tests failed during tracing bootstrap.
- **Root cause:** The dependency graph was treated as individual vulnerable packages instead of a compatibility family.
- **Prevention rule:** For observability/security SDKs, upgrade the compatible package set together and run package-level tests before calling the audit fix complete.
- **Files affected:** `apps/api/package.json`, `apps/worker/package.json`, `package.json`, `docs/solutions/dependency-audit-zero-advisory-remediation.md`.

### 2026-06-17 TEST: Worker Vitest isolation was disabled and leaked mocks

- **What went wrong:** The worker test runner used `--isolate=false`, so a mocked Prisma test polluted a later org-LLM test and made it hit the real Prisma path with fixture IDs.
- **Root cause:** The runner optimized for process reuse before proving every worker test file was global-state safe.
- **Prevention rule:** Keep Vitest isolation enabled for worker suites unless each file has an explicit mock cleanup contract and the full suite is proven both ways.
- **Files affected:** `scripts/run-worker-tests.mjs`.

### 2026-06-17 OPS: Secret scanner shell script had CRLF line endings

- **What went wrong:** `bash scripts/check-secrets.sh --full` failed on Windows with `set: -\r invalid option`.
- **Root cause:** The shell script had CRLF line endings, so Bash parsed carriage returns as option text.
- **Prevention rule:** Shell scripts must remain LF-only. After editing a `.sh` file on Windows, run it with Bash before treating any security gate as green.
- **Files affected:** `scripts/check-secrets.sh`.

### 2026-06-17 OPS: Broad Dockerized SAST scans timed out and left scanner processes

- **What went wrong:** Broad Dockerized Semgrep and `gitleaks --no-git` scans over the local checkout timed out and left scanner containers or Docker client processes running.
- **Root cause:** The scans were not bounded tightly enough for a large dirty workspace with generated/local artifacts.
- **Prevention rule:** Scope local SAST to shipped source/config or use CI-tuned scanner config. After any timeout, inspect and stop scanner containers/client processes before starting the next gate.
- **Files affected:** `docs/solutions/security-scan-local-gates.md`.

### 2026-06-17 SECURITY: Printed a tracked settings secret while classifying gitleaks

- **What went wrong:** While classifying a gitleaks finding, I printed `.claude/settings.json` raw before sanitizing the MCP `API_KEY` value.
- **Root cause:** I inspected the config file directly instead of using a redacting projection first.
- **Prevention rule:** Secret-hit triage must never print raw config files. Use redacted field projections, then patch the file to a placeholder and require rotation for any exposed credential.
- **Files affected:** `.claude/settings.json`, `docs/solutions/security-scan-local-gates.md`.

### 2026-06-17 OPS: PowerShell expanded POSIX command substitution in a Docker probe

- **What went wrong:** A Docker Alpine probe used `$(id -u bidstack)` inside a PowerShell double-quoted command, so PowerShell evaluated the subexpression before the shell inside the container saw it.
- **Root cause:** I mixed POSIX shell syntax into a PowerShell string without single-quote isolation.
- **Prevention rule:** When passing POSIX shell fragments through PowerShell, wrap the container command in single quotes or escape `$`; verify the command reaches the intended shell before interpreting its failure.
- **Files affected:** none.

### 2026-06-17 SECURITY: Broad Semgrep scans needed a temporary source mirror

- **What went wrong:** Directly mounting the repo into Dockerized Semgrep kept timing out even after path excludes, because local worktrees/generated state still made the scan too broad.
- **Root cause:** The scanner target was the developer checkout rather than a controlled set of shipped source/config files.
- **Prevention rule:** SAST gates in a dirty monorepo should build an explicit temporary mirror from `git ls-files --cached --others --exclude-standard`, then scan that mirror with pinned tool versions and documented severity policy.
- **Files affected:** `scripts/run-semgrep-sast.mjs`, `package.json`, `docs/solutions/security-scan-local-gates.md`.

### 2026-06-17 SECURITY: AES-GCM decryptors omitted explicit auth tag length

- **What went wrong:** Several AES-256-GCM decryptors stored and validated 16-byte tags by layout but did not pass `authTagLength` to Node's crypto API.
- **Root cause:** The envelope format encoded the tag size implicitly, and tests proved tamper rejection but did not assert the runtime API contract that SAST expects.
- **Prevention rule:** Every GCM `createCipheriv` and `createDecipheriv` call must pass the expected `authTagLength`, and tests that replicate the envelope should do the same.
- **Files affected:** `apps/api/src/services/yjs-persistence.service.ts`, `apps/api/src/services/yjs-merge.service.ts`, `apps/api/src/services/yjs-persistence.service.test.ts`, `apps/worker/src/queues/yjs-compaction.ts`, `packages/shared/src/crypto/pii-field-cipher.ts`, `packages/shared/src/crypto/token-cipher.ts`, `packages/shared/src/utils/crypto.ts`.

### 2026-06-17 DOCKER: Migrate image depended on full product builder

- **What went wrong:** The root Docker `migrate` target timed out locally because it copied Prisma assets from the full `builder` stage, forcing web/API/worker builds before producing a schema-only migration image.
- **Root cause:** The migration target reused app artifact patterns instead of reasoning from `prisma migrate deploy` requirements.
- **Prevention rule:** One-shot migration images should copy only schema/migrations and run Prisma directly. Do not depend on compiled app artifacts unless the migration command imports them.
- **Files affected:** `Dockerfile`, `docs/solutions/docker-migrate-image-fast-nonroot.md`.

### 2026-06-17 DOCKER: Runtime pnpm command triggered Corepack in migrate image

- **What went wrong:** After the migrate image became non-root, running `pnpm --filter @bidstack/db migrate:deploy` inside the container printed a Corepack download notice at runtime.
- **Root cause:** The container `CMD` used the package manager as a launcher even though the Prisma CLI binary was already installed under the package workspace.
- **Prevention rule:** Production one-shot images should execute the runtime binary directly, e.g. `packages/db/node_modules/.bin/prisma`, and avoid package-manager/network bootstrap in `CMD`.
- **Files affected:** `Dockerfile`, `docs/solutions/docker-migrate-image-fast-nonroot.md`.

### 2026-06-17 DOCKER: Assumed Prisma binary lived at root node_modules

- **What went wrong:** The first direct Prisma `CMD` used `/app/node_modules/.bin/prisma`, but pnpm exposed the package-local binary at `/app/packages/db/node_modules/.bin/prisma`.
- **Root cause:** I assumed npm-style root binary layout in a pnpm workspace.
- **Prevention rule:** Probe actual `node_modules/.bin` paths inside the built image before hardcoding runtime command paths.
- **Files affected:** `Dockerfile`.

### 2026-06-17 SECURITY: Clean workspace audit missed container runtime CVEs

- **What went wrong:** `pnpm audit` and SAST were clean, but Trivy found HIGH vulnerabilities in built deploy images.
- **Root cause:** The audit covered workspace dependencies, not base-image OS packages or global Node package-manager trees shipped inside containers.
- **Prevention rule:** Run `pnpm container:scan` against every deploy image before calling a release security gate green. Include web/static-serving images, not only app services.
- **Files affected:** `scripts/run-container-vulnerability-scan.mjs`, `Dockerfile`, `package.json`, `docs/solutions/container-vulnerability-scan-gate.md`.

### 2026-06-17 DOCKER: Runtime images shipped unused npm/Corepack package trees

- **What went wrong:** Node runtime images carried vulnerable packages from `/usr/local/lib/node_modules/npm` even though runtime commands did not need npm or Corepack.
- **Root cause:** The final images inherited package managers from `node:alpine` and left install-time tooling in runtime layers.
- **Prevention rule:** After production installs, remove global npm/Corepack/pnpm trees and shims from final Node images unless runtime explicitly needs a package manager.
- **Files affected:** `Dockerfile`.

### 2026-06-17 DOCKER: Web image package freshness was not part of the gate

- **What went wrong:** The nginx web image had HIGH Alpine package findings in OpenSSL/libxml2 while Node service images were clean.
- **Root cause:** The deploy-image default scan initially omitted web, and the web stage relied on the base image package snapshot without upgrading fixed packages during build.
- **Prevention rule:** Treat static web containers as production deploy images. Scan them by default and refresh OS packages or pin a fixed base digest before release.
- **Files affected:** `Dockerfile`, `scripts/run-container-vulnerability-scan.mjs`.

### 2026-06-17 DOCKER: Static nginx image failed when API DNS was absent

- **What went wrong:** After switching the web target to unprivileged nginx, the container could fail before serving static assets because nginx resolved the literal `api:4000` upstream during startup.
- **Root cause:** A static web image still had eager proxy upstream DNS resolution baked into nginx config.
- **Prevention rule:** For optional backend proxy paths in static nginx containers, use a variable upstream with an explicit resolver and bounded proxy timeouts, then prove the image serves `/health` and `/` without the backend DNS name present.
- **Files affected:** `apps/web/nginx.conf`.

### 2026-06-17 DOCKER: Container healthcheck used ambiguous localhost

- **What went wrong:** The unprivileged nginx image served `127.0.0.1:8080/health`, but BusyBox `wget` against `localhost:8080` could hit a refused path during container-local probes.
- **Root cause:** `localhost` resolution inside minimal images is not always the same path as the listener used by nginx.
- **Prevention rule:** Container healthchecks should target the exact loopback address and port that was runtime-probed, for example `http://127.0.0.1:8080/health`.
- **Files affected:** `Dockerfile`.

### 2026-06-17 TESTING: Shared schema build raced downstream typechecks

- **What went wrong:** I launched `@bidstack/shared build`, API typecheck, and web typecheck in parallel after adding a shared response field. API/web typechecks briefly saw stale `@bidstack/shared/dist` declarations and reported false missing-export/missing-field errors.
- **Root cause:** API/web TypeScript and Fastify response validation resolve `@bidstack/shared` through package `dist`; a concurrent build is not an atomic dependency for downstream checks.
- **Prevention rule:** After changing shared schemas, run `pnpm --filter @bidstack/shared build` to completion before API/web typechecks, API tests, or live browser QA.
- **Files affected:** `packages/shared/src/schemas/contract-agreement.ts`, `apps/api/src/routes/contract-agreements.ts`, `apps/web/src/components/account-intel/ContractAgreementsCard.tsx`.

### 2026-06-17 UX: Cursor-paginated account API was flattened in the hook

- **What went wrong:** The Key Accounts API returned `{ items, nextCursor }` and supported server-side industry filtering, but the web hook exposed only `items`; the page filtered industry locally on the first page.
- **Root cause:** The UI treated a paginated operational list like a complete snapshot and dropped the backend pagination contract.
- **Prevention rule:** Hooks for cursor-paginated endpoints must preserve `nextCursor`, send `limit`/`cursor`, and use shared pager controls. Push supported filters to the server instead of filtering only the current client slice.
- **Files affected:** `apps/web/src/hooks/useKeyAccounts.ts`, `apps/web/src/pages/KeyAccountsPage.tsx`, `apps/web/src/hooks/useKeyAccounts.pagination.test.tsx`.

### 2026-06-17 UX: Extracted account-intel cards hid exact confidence

- **What went wrong:** Account Intelligence solution/product cards showed a plain `From:` line only when a document was linked, and a binary high-confidence badge only above 70%.
- **Root cause:** The display treated provenance as secondary copy instead of a first-class decision signal.
- **Prevention rule:** Extracted account-intel surfaces must show source and exact confidence for every row, including manual/no-document fallbacks, using the shared cockpit source badge pattern.
- **Files affected:** `apps/web/src/components/account-intel/IntelTabs.tsx`, `apps/web/src/components/account-intel/IntelTabs.test.tsx`.

### 2026-06-17 TESTING: E2E personas shared a derived Clerk identity

- **What went wrong:** The new `viewer` RBAC test failed with a unique `clerk_user` conflict because `viewer` and `read-only` both mapped to `Read-Only` and the stub auth derived `clerkUser` from the shared system role name.
- **Root cause:** QA persona identity was coupled to authorization role name.
- **Prevention rule:** E2E persona fixtures must define explicit stable identity keys when multiple personas can share the same product role.
- **Files affected:** `apps/api/src/plugins/auth.ts`, `apps/api/src/routes/users.roles.integration.test.ts`, `apps/web/e2e/flows/rbac.spec.ts`.

### 2026-06-17 UX: Account coverage was a percentage without action

- **What went wrong:** Account cards showed signal coverage as a percentage/bar, but did not tell the user why the score was weak or what to fix first.
- **Root cause:** The UI treated coverage as a passive status metric instead of an operational coaching surface.
- **Prevention rule:** Any CRM score shown in account/industry workflows must expose a reason and next action in the same visual context as the score.
- **Files affected:** `apps/web/src/pages/accountsPage/accountUtils.ts`, `apps/web/src/pages/accountsPage/AccountCard.tsx`, `apps/web/src/pages/accountsPage/AccountCard.test.tsx`, `apps/web/src/index.css`.

### 2026-06-17 UX: Strategic account views explained sectors but not account action

- **What went wrong:** Key Accounts, Top Accounts, and Sector View showed strategic counts, ranks, and coverage percentages without consistently explaining the first recovery action.
- **Root cause:** The strategic views reused dashboard-style metrics after the account card had already moved to action-oriented signal coaching.
- **Prevention rule:** Account and industry views must share deterministic signal explainability; a score/rank/coverage bar is incomplete unless the same row or card names the reason and next action.
- **Files affected:** `apps/web/src/pages/accountsPage/strategicSignals.ts`, `apps/web/src/pages/accountsPage/StrategicSignalInsight.tsx`, `apps/web/src/pages/KeyAccountsPage.tsx`, `apps/web/src/pages/TopAccountsPage.tsx`, `apps/web/src/pages/SectorViewPage.tsx`, `apps/web/src/index.css`.

### 2026-06-17 TESTING: Core Web Vitals passed without durable measured evidence

- **What went wrong:** The Core Web Vitals suite passed locally, but successful runs did not leave route-level metric values for launch review.
- **Root cause:** The spec only annotated budget misses or missing lab signals, so a green run was not independently auditable.
- **Prevention rule:** Performance gates must persist successful metric evidence as ignored report artifacts, including value, unit, budget, route, status, and timestamp.
- **Files affected:** `apps/web/e2e/performance/core-web-vitals.spec.ts`, `docs/solutions/e2e-type-and-performance-budget-gates.md`, `docs/solutions/sidebar-collapse-inp-headroom.md`.

### 2026-06-17 UX: Sidebar collapse used non-urgent rendering for an urgent click

- **What went wrong:** The dashboard synthetic INP click measured 144ms on the sidebar collapse control: green against the 200ms launch budget, but above the 100ms premium headroom target.
- **Root cause:** Sidebar collapse state was routed through `startTransition`, the app shell subscribed to that state just to update grid width, and the collapse path still animated layout-affecting properties.
- **Prevention rule:** Urgent shell controls should update visual state immediately, drive global layout from CSS/data flags when possible, and avoid animating padding, gap, width, max-width, max-height, or grid tracks on dense CRM pages.
- **Files affected:** `apps/web/src/stores/ui.ts`, `apps/web/src/stores/ui.test.ts`, `apps/web/src/components/layout/AppShell.tsx`, `apps/web/src/index.css`.

### 2026-06-17 TESTING: Auth-mode E2E gate was silently forced to stub

- **What went wrong:** The first idle-auth browser proof was launched with `E2E_AUTH_MODE=demo`, but the built app still rendered the stub user because the web package `build` script hardcoded `VITE_AUTH_MODE=stub`.
- **Root cause:** Playwright exposed an auth-mode switch while the managed web server reused a package script with a different hardcoded auth mode.
- **Prevention rule:** Auth-variant E2E gates must build the app with the selected auth environment and include evidence from the rendered session or request headers that the intended provider path was actually used. After changing the E2E web server command, rerun a default stub-auth smoke.
- **Files affected:** `apps/web/playwright.config.ts`, `apps/web/e2e/flows/idle-auth-recovery.spec.ts`.

### 2026-06-17 TESTING: k6 summary thresholds were parsed as pass/fail booleans

- **What went wrong:** The first compact load-test artifact marked a passing k6 run as failed because the wrapper treated raw `thresholds` boolean fields in `--summary-export` as direct pass/fail results.
- **Root cause:** k6's JSON export stores rate metrics under `value` and threshold entries are not a stable enough pass/fail contract for our artifact parser.
- **Prevention rule:** Certification artifacts must compute threshold verdicts from exported metric values (`value`, `p(95)`, etc.) and compare them to the expression, then verify the artifact verdict against the terminal run before documenting it.
- **Files affected:** `scripts/run-k6-load-test.mjs`.

### 2026-06-17 DB: Prisma migrate dev hung during SERUM config migration

- **What went wrong:** `prisma migrate dev` and `--create-only` hung while creating the SERUM config migration in the local Windows workspace.
- **Root cause:** The local migration command path was not reliable enough under the active workspace/database state, and the generated diff also surfaced unrelated local drift on `notification_prefs.updated_at`.
- **Prevention rule:** When `migrate dev` hangs, generate SQL with `prisma migrate diff`, inspect for unrelated drift, keep only the intended DDL in the migration, then apply with package-local `prisma migrate deploy`.
- **Files affected:** `packages/db/prisma/schema.prisma`, `packages/db/prisma/migrations/20260617123000_serum_config_versions/migration.sql`.

### 2026-06-17 API: Zod JSON records were passed directly to Prisma JSON writes

- **What went wrong:** The SERUM draft/rollback route passed `Record<string, unknown>` to a Prisma `Json` column and failed API typecheck.
- **Root cause:** Prisma write inputs require `Prisma.InputJsonObject`; Zod's JSON object shape is runtime-valid but not assignable to Prisma's stricter input type.
- **Prevention rule:** Convert or cast validated JSON objects at the API boundary with a small helper before Prisma writes, and keep runtime validation before the conversion.
- **Files affected:** `apps/api/src/routes/serum.ts`.

### 2026-06-17 UX: SERUM settings editor reset text from an effect

- **What went wrong:** The first SERUM config editor draft synchronized backend versions into textarea state with `setState` in `useEffect`, which the React lint gate rejected.
- **Root cause:** The editor state lived in the parent and tried to copy query data into local mutable text after render.
- **Prevention rule:** For settings editors, let the editor component own unsaved text state and key it by backend version id. Remount on version change instead of resetting user-editable state from an effect.
- **Files affected:** `apps/web/src/components/settings/SerumControlPlaneSection.tsx`.

### 2026-06-17 TESTING: SERUM E2E asserted stale section heading copy

- **What went wrong:** After the SERUM settings UI changed from a single General editor to a 24-section workbench, the focused Playwright spec still asserted the old `General deployment policy` heading and failed even though the product behavior was healthy.
- **Root cause:** The test overfit to presentation copy instead of the stable section selection behavior and config snapshot contract.
- **Prevention rule:** When changing settings information architecture, update E2E to assert endpoint responses, selected section labels, and functional controls rather than stale heading prose.
- **Files affected:** `apps/web/e2e/serum-account-experience.spec.ts`, `apps/web/src/components/settings/SerumControlPlaneSection.tsx`.

### 2026-06-17 TESTING: SERUM E2E used broad text for repeated readiness labels

- **What went wrong:** The first browser proof for the SERUM config Test result used `getByText('Human approval')`; Playwright strict mode found the phrase in the section summary, the checklist label, and the checklist detail.
- **Root cause:** The assertion did not scope to the result checklist or use exact matching after adding repeated operator language to the page.
- **Prevention rule:** For dense settings pages, assert backend responses first, then scope visible assertions to the specific panel or use exact text for repeated checklist labels.
- **Files affected:** `apps/web/e2e/serum-account-experience.spec.ts`.

### 2026-06-17 TESTING: SERUM typed controls repeated checklist labels again

- **What went wrong:** After adding typed high-risk controls, the focused SERUM E2E again asserted `Human approval` globally; the new switch label and the test-result checklist label both matched.
- **Root cause:** The previous prevention rule was applied with exact text but not with a stable panel boundary once the UI gained operator controls.
- **Prevention rule:** Dense settings result panels need accessible region labels, and E2E must scope repeated readiness labels to those regions before asserting row text.
- **Files affected:** `apps/web/src/components/settings/SerumControlPlaneSection.tsx`, `apps/web/e2e/serum-account-experience.spec.ts`.

### 2026-06-17 API: SERUM publish reused a type guard boolean as typed evidence

- **What went wrong:** The first high-risk approval publish implementation failed API typecheck because `draft.configType` was still a Prisma `string` when passed into `testSerumConfig`.
- **Root cause:** The code stored `configRequiresApproval(draft.configType)` as a boolean, which lost the type predicate narrowing before the deterministic test call.
- **Prevention rule:** When a persisted string must feed a shared enum-typed function, parse it once with the shared Zod enum and carry the parsed value forward. Do not rely on a detached boolean as type evidence.
- **Files affected:** `apps/api/src/routes/serum.ts`.

### 2026-06-17 API: SERUM approval state was validated before the lock

- **What went wrong:** The first dual-control pass validated request, approve, and publish state from a row read before acquiring the advisory lock.
- **Root cause:** The lock protected the write, but the decision used stale pre-lock state. Under concurrent approval requests, a second transaction could wait on the lock and then overwrite the original requester evidence.
- **Prevention rule:** For stateful approval/change-control routes, acquire the row's logical advisory lock, re-read under that lock, and only then validate and mutate. Add a fail-closed regression for inconsistent stored approval evidence.
- **Files affected:** `apps/api/src/routes/serum.ts`, `apps/api/src/routes/serum.integration.test.ts`.

### 2026-06-17 API: Runtime tool scope map was typed as a closed literal

- **What went wrong:** The first SERUM runtime-policy helper failed API typecheck because a dynamic request `toolName` indexed a literal object without a string index signature.
- **Root cause:** The map was declared with `satisfies Record<string, ToolScope>`, which validates values but keeps the inferred key union closed.
- **Prevention rule:** Runtime registries indexed by request input need an explicit `Record<string, Scope>` type, and unknown entries should fail closed.
- **Files affected:** `apps/api/src/lib/serum-runtime-policy.ts`.

### 2026-06-17 API: SERUM retry approval body broke no-body clients

- **What went wrong:** Adding `approvalConfirmed` to crew-run retry made the existing no-payload retry integration return 400 instead of 202.
- **Root cause:** The Fastify/Zod route body schema rejected requests before handler defaults could apply.
- **Prevention rule:** When adding optional governance fields to existing endpoints, preserve no-body clients by validating `req.body ?? {}` inside the handler or proving the framework accepts an absent body.
- **Files affected:** `apps/api/src/routes/crews.ts`, `apps/api/src/routes/crews.integration.test.ts`.

### 2026-06-17 TESTING: SERUM denial assertion used raw serialized JSON

- **What went wrong:** A correct 409 denial response failed the test because the assertion searched the raw JSON string and did not account for escaped quotes.
- **Root cause:** The test asserted transport serialization instead of the parsed error message contract.
- **Prevention rule:** API error assertions should parse JSON and assert semantic fields such as `message` unless the serialization format itself is the behavior under test.
- **Files affected:** `apps/api/src/routes/crews.integration.test.ts`.

### 2026-06-17 WORKER: Direct LLM fallback could bypass SERUM model routing

- **What went wrong:** The shared RFP LLM wrapper could select a direct provider, fail that provider, and then fall through to Dust without a runtime Model Router decision for the fallback path.
- **Root cause:** The old resilience contract treated provider fallback as harmless availability behavior, but SERUM turns model route selection into a governance boundary.
- **Prevention rule:** Once a direct model route is selected, check SERUM immediately before execution and do not fall through to another model system unless that system has its own explicit runtime policy allowance.
- **Files affected:** `apps/worker/src/lib/rfp-llm.ts`, `apps/worker/src/lib/rfp-llm.test.ts`.

### 2026-06-17 API/WORKER: Dust clients bypassed SERUM gateway runtime policy

- **What went wrong:** Dust execution was spread across worker RFP jobs, document extraction, Dust polling, API assistant services, integration status, and CRM-to-Dust push helpers. Some paths used `getOrgDust`, while others constructed `new DustClient(...)` directly, so a future Dust/MCP Gateway policy would not have covered all network calls.
- **Root cause:** Dust was treated as an integration utility instead of an external model/tool gateway with runtime governance requirements. Caller-level checks would have been easy to miss.
- **Prevention rule:** Guard the API/worker Dust client factories and grep for direct `new DustClient(...)` construction on every SERUM gateway change. Only admin credential-validation probes may construct Dust directly before credentials/policy exist.
- **Files affected:** `packages/shared/src/schemas/serum.ts`, `packages/db/src/serum-runtime-policy.ts`, `apps/api/src/lib/dust-credentials.ts`, `apps/api/src/lib/dust-push.ts`, `apps/api/src/routes/dust-integration.ts`, `apps/api/src/routes/dust-integration.helpers.ts`, `apps/worker/src/lib/dust-credentials.ts`, `apps/worker/src/lib/dust-credentials.test.ts`, `apps/worker/src/crew/dust-executor.ts`.

### 2026-06-17 WEB: API base prefixes can make live SERUM endpoints look down

- **What went wrong:** A deployed frontend configured with an API base ending in `/api` or `/api/v1` could join paths into duplicated URLs such as `/api/api/v1/serum/status`, making the live SERUM control plane appear unavailable even when the backend route was healthy.
- **Root cause:** Path normalization lived in call sites instead of the shared API boundary, and the SERUM unavailable copy collapsed routing, auth, permission, backend, and network failures into one generic message.
- **Prevention rule:** Normalize configured API bases once in `apps/web/src/lib/api.ts`; keep hook paths canonical; add regression coverage for `/api` and `/api/v1` bases; bump app-shell cache names after API-boundary fixes; show status-specific recovery copy.
- **Files affected:** `apps/web/src/lib/api.ts`, `apps/web/src/lib/api.test.ts`, `apps/web/src/hooks/useSerumStatus.ts`, `apps/web/src/components/serum/SerumGlass.tsx`, `apps/web/src/main.tsx`, `apps/web/public/sw.js`.

### 2026-06-17 MCP/WORKER: SERUM Retrieval config had no execution guard

- **What went wrong:** The SERUM workbench exposed Retrieval as a governable section, but MCP semantic search and worker embedding queues could still call Cohere without checking a published Retrieval runtime policy.
- **Root cause:** Retrieval was treated as background infrastructure while SERUM UI/config work focused first on high-risk model, agent, tool, and Dust gateway paths.
- **Prevention rule:** Every SERUM section promoted to UI/config must have a matching `checkSerum*RuntimePolicy` helper and at least one execution-call-site regression proving the external provider call is skipped when policy denies.
- **Files affected:** `packages/shared/src/schemas/serum.ts`, `packages/db/src/serum-runtime-policy.ts`, `apps/api/src/routes/serum.ts`, `apps/mcp-server/src/lib/reference-search.ts`, `apps/mcp-server/src/lib/reference-search.test.ts`, `apps/worker/src/queues/rfp-embed-requirement.ts`, `apps/worker/src/queues/rfp-embed-reference.ts`.

### 2026-06-17 API/WORKER: SERUM Prompt Library config had no runtime prompt gate

- **What went wrong:** Prompt Library existed as a SERUM settings/config section, but RFP model prompts could still reach direct providers or Dust through the shared worker wrapper, requirement extraction, and legacy API Dust helpers without proving the active Prompt Library policy allowed that prompt set.
- **Root cause:** Prompt governance was treated as config validation instead of a runtime boundary immediately before model execution.
- **Prevention rule:** Any model/prompt execution path must call `checkSerumPromptLibraryRuntimePolicy` with a named prompt set before the provider call, and tests must prove SERUM denial skips direct providers and does not fall through to Dust.
- **Files affected:** `packages/shared/src/schemas/serum.ts`, `packages/db/src/serum-runtime-policy.ts`, `apps/api/src/routes/serum.ts`, `apps/api/src/routes/serum.integration.test.ts`, `apps/api/src/services/ai/dust-agent.service.ts`, `apps/worker/src/lib/rfp-llm.ts`, `apps/worker/src/lib/rfp-llm.test.ts`, `apps/worker/src/queues/rfp-requirement-extract.processor.ts`.

### 2026-06-17 API: SERUM eval config was not release-runtime evidence

- **What went wrong:** Evals Quality Gates existed as a SERUM settings/config section, but the RFP eval runner could produce release evidence without asking runtime policy whether the suite and result were allowed.
- **Root cause:** Eval governance was treated as draft preflight instead of a release-time boundary around the runner and its final pass/fail result.
- **Prevention rule:** Every release eval runner must call `checkSerumEvalsQualityGateRuntimePolicy` with suite, pass rate, and failure count; model-backed/full evals must preflight org-scoped policy before provider-backed judging starts.
- **Files affected:** `packages/shared/src/schemas/serum.ts`, `packages/db/src/serum-runtime-policy.ts`, `apps/api/src/routes/serum.ts`, `apps/api/src/routes/serum.integration.test.ts`, `apps/api/src/evals/run-evals.ts`, `apps/api/src/evals/serum-eval-policy.ts`, `apps/api/src/evals/serum-eval-policy.test.ts`.

### 2026-06-17 API/WORKER: SERUM Connector config did not guard egress

- **What went wrong:** Connector existed as a SERUM settings/config section, but ERP/Odoo MCP routes and Microsoft Graph calendar sync could still call external systems without a runtime connector decision.
- **Root cause:** Connector governance was treated as publish-time configuration hygiene instead of a network-egress boundary immediately before external SaaS/ERP calls.
- **Prevention rule:** Every external connector egress path must call `checkSerumConnectorRuntimePolicy` before the fetch/client call, and regression tests must prove SERUM denial prevents network egress.
- **Files affected:** `packages/shared/src/schemas/serum.ts`, `packages/db/src/serum-runtime-policy.ts`, `apps/api/src/routes/serum.ts`, `apps/api/src/routes/serum.integration.test.ts`, `apps/api/src/routes/erp-integration.ts`, `apps/api/src/routes/erp-integration.test.ts`, `apps/worker/src/queues/calendar-sync-microsoft.ts`, `apps/worker/src/queues/calendar-sync-microsoft.test.ts`.

### 2026-06-17 API/WORKER: SERUM Loops config had no runtime guard

- **What went wrong:** Loops existed as a SERUM settings/config section, but Crew and RFP loop launch paths could still start without a first-class Loop runtime decision.
- **Root cause:** Durable-event, replay, approval, and retry checks lived in config validation instead of the producer/worker execution boundary.
- **Prevention rule:** Every SERUM section that names runtime loop behavior must ship a matching `checkSerumLoopRuntimePolicy` call at queue producers and worker backstops, plus regressions proving denied loops do not enqueue or continue side effects.
- **Files affected:** `packages/shared/src/schemas/serum.ts`, `packages/db/src/serum-runtime-policy.ts`, `apps/api/src/routes/serum.ts`, `apps/api/src/routes/serum.integration.test.ts`, `apps/api/src/queues/rfp-orchestrator.ts`, `apps/api/src/queues/rfp-orchestrator.test.ts`, `apps/api/src/routes/rfp-pipeline.ts`, `apps/api/src/routes/crews.ts`, `apps/api/src/routes/crews.integration.test.ts`, `apps/worker/src/queues/rfp-orchestrator.ts`, `apps/worker/src/queues/__tests__/rfp-orchestrator.test.ts`, `apps/worker/src/queues/crew-run.ts`.

### 2026-06-17 API/WORKER: Connector policy coverage stopped after first families

- **What went wrong:** The first Connector runtime pass guarded ERP/Odoo and Microsoft calendar sync, but Slack, Twilio, Gmail, Google Workspace, HubSpot migration, Microsoft mail, and webhook delivery still had external egress paths.
- **Root cause:** The audit followed the initial visible failures instead of enumerating every active connector-family fetch/client call across API and worker packages.
- **Prevention rule:** For connector governance work, grep all active API/worker egress paths by provider name and by generic `fetch(`, then add denial-path tests that assert provider calls and credential lookups are skipped before calling the slice complete.
- **Files affected:** `apps/api/src/lib/serum-connector-policy.ts`, `apps/api/src/services/slack.service.ts`, `apps/api/src/services/twilio-sms.service.ts`, `apps/api/src/services/email-integration.service.ts`, `apps/api/src/services/microsoft-graph.service.ts`, `apps/api/src/routes/migrations-hubspot.routes.ts`, `apps/api/src/routes/webhook-subscriptions.ts`, `apps/api/src/services/serum-connector-egress.test.ts`, `apps/worker/src/lib/serum-connector-policy.ts`, `apps/worker/src/queues/calendar-sync-google.ts`, `apps/worker/src/queues/calendar-sync.ts`, `apps/worker/src/queues/migration.ts`, `apps/worker/src/queues/webhook-delivery.ts`, `apps/worker/src/queues/serum-connector-egress.test.ts`.

### 2026-06-17 DB/API: Runtime-policy tests imported stale package dist

- **What went wrong:** After adding the connector connection-test evidence ledger, focused API integration tests still denied a valid policy because the API test process imported the previously built `@bidstack/db` dist output.
- **Root cause:** The migration/source changes were applied, but the shared workspace package had not been rebuilt before dependent API tests ran.
- **Prevention rule:** After changing `packages/db` runtime-policy source or Prisma schema, run `pnpm --filter @bidstack/db build` before dependent API/worker integration tests. If behavior looks impossible, inspect whether the dependent package is importing stale dist.
- **Files affected:** `packages/db/src/serum-runtime-policy.ts`, `apps/api/src/routes/serum.integration.test.ts`.

### 2026-06-17 WEB: Premium compact controls missed touch-target size

- **What went wrong:** The Technical Stack Overview source/add UX looked polished, but compact icon actions and category preset buttons were below the 44px target expected for enterprise touch and accessibility.
- **Root cause:** Visual density was checked before touch-target geometry, so the control felt premium on desktop while being less reliable on touch devices.
- **Prevention rule:** Any compact/icon-first cockpit control must get a CSS geometry check for min 44px width/height, focus ring, disabled state, and mobile wrapping before the UX slice is called complete.
- **Files affected:** `apps/web/src/styles/cockpit.css`, `apps/web/src/components/cockpit/TechStackCard.tsx`.

### 2026-06-17 API/WEB: Provider lanes must match real transport paths

- **What went wrong:** Technical Stack Overview source pulls risked presenting provider trust too optimistically if Seamless was shown beside Apollo without an actual MCP execution path.
- **Root cause:** The UX source-rail concept moved faster than the backend transport audit; Apollo had an MCP-first queue path, while Seamless still needed an explicit MCP-first provider implementation and API fallback semantics.
- **Prevention rule:** Before adding a provider lane to enterprise source-pull UI, prove the transport path in code and tests, expose disabled/unavailable states when credentials are missing, and only label `mcp` when the runtime can actually call an MCP endpoint.
- **Files affected:** `apps/api/src/providers/company-seamless-enrichment.ts`, `apps/api/src/routes/crm/companies.ts`, `apps/web/src/components/cockpit/TechStackCard.tsx`.

### 2026-06-17 WEB: Browser QA text entry can be tool-limited

- **What went wrong:** In-app browser QA could click and inspect the Technical Stack editor, but `fill`/`type` failed because the virtual clipboard bridge was not installed in the browser automation environment.
- **Root cause:** Browser-plugin input automation depends on host-side virtual clipboard support; that failure does not prove the app input is broken.
- **Prevention rule:** When browser text entry fails for tooling reasons, verify persistence with Playwright E2E and use browser QA for live visual geometry, labels, overflow, and click-state inspection.
- **Files affected:** `apps/web/e2e/technical-stack.spec.ts`, `apps/web/src/components/cockpit/TechStackCard.tsx`.

### 2026-06-17 WEB: Source-review batch action followed the visible slice

- **What went wrong:** The Technical Stack source review queue rendered a bounded set of provider suggestions, and the `Accept all` action used that same visible slice instead of the full eligible suggestion set. Category-prefixed paste also lost user intent by flattening structured lines into the selected composer category.
- **Root cause:** The UI optimized display density before separating intake semantics from rendered-card limits.
- **Prevention rule:** Review queues need separate `eligible` and `visible` collections; batch actions operate on eligible data, while rendering can stay capped. Paste intake should preserve structured user hints when they match known categories, and tests must cover multi-category paste plus provider confidence visibility.
- **Files affected:** `apps/web/src/components/cockpit/TechStackCard.tsx`, `apps/web/src/components/cockpit/TechStackCard.test.tsx`, `apps/web/src/styles/cockpit.css`.

### 2026-06-18 API/WEB: Partial MCP config overclaimed provider readiness

- **What went wrong:** Apollo Technical Stack refresh could present MCP as the active transport when only part of the MCP configuration existed, and the review queue capped visible provider cards without telling users that bulk acceptance still applied to the larger eligible set.
- **Root cause:** Provider status logic treated URL-or-token presence as enough to describe MCP posture, while the UI separated eligible and visible source suggestions without an explicit overflow cue.
- **Prevention rule:** Provider transport labels must require the complete credential set for that transport. If a review queue renders fewer cards than the eligible batch action set, show an explicit status message and test the hidden-count path.
- **Files affected:** `apps/api/src/routes/crm/companies.ts`, `apps/api/src/routes/crm/companies.test.ts`, `apps/web/src/components/cockpit/TechStackCard.tsx`, `apps/web/src/components/cockpit/TechStackCard.test.tsx`, `apps/web/src/styles/cockpit.css`.

### 2026-06-18 TOOLING: Release preflight was trapped inside bundle execution

- **What went wrong:** Operators could dry-run the release bundle or execute the full evidence sequence, but there was no first-class command that only checked live-input readiness without being marked as deploy approval.
- **Root cause:** Preflight collection lived inside `scripts/run-deploy-evidence-bundle.mjs` as an internal step, so the cheapest way to learn missing staging inputs was a dry-run artifact or a failed bundle execution.
- **Prevention rule:** Long release evidence flows need a standalone preflight artifact that checks credentials, targets, owner approvals, provider company keys, Sentry projects, and Clerk browser settings without running evidence commands. Passing preflight must never imply deploy approval.
- **Files affected:** `scripts/run-deploy-evidence-bundle.mjs`, `package.json`, `docs/solutions/deploy-evidence-hard-gate.md`.

### 2026-06-18 TOOLING: Dirty source evidence lacked review breakdown

- **What went wrong:** Source-control evidence correctly failed a dirty release tree, but the artifact only exposed aggregate counts and a first-page status sample. Large untracked directories could also be collapsed by plain `git status`, hiding the real review area.
- **Root cause:** The source gate optimized for pass/fail release validation before modeling the human review task needed to turn a large dirty tree into a clean reviewed release revision.
- **Prevention rule:** Fail-closed release gates should also produce actionable cleanup metadata. Dirty source artifacts need full untracked path expansion, path-area counts, risk buckets, truncation metadata, and small file samples, while still requiring a clean worktree for release.
- **Files affected:** `scripts/write-source-control-evidence.mjs`, `docs/solutions/deploy-evidence-hard-gate.md`.

### 2026-06-18 TOOLING: Source cleanup still lacked an ordered review plan

- **What went wrong:** The dirty-source artifact became reviewable, but release operators still had to decide the cleanup order manually from buckets and samples.
- **Root cause:** Evidence metadata described the problem shape, but there was no non-destructive artifact translating it into release cleanup waves with priorities and verification commands.
- **Prevention rule:** Large source cleanup blockers need a generated review plan that orders release-critical config/secrets, security/access, runtime code, frontend UX, docs, and uncategorized files. The plan must stay advisory and must not weaken the clean-source release gate.
- **Files affected:** `scripts/write-source-review-plan.mjs`, `scripts/write-release-tool-readiness.mjs`, `package.json`, `docs/solutions/deploy-evidence-hard-gate.md`, `docs/solutions/release-tool-readiness-gate.md`.

### 2026-06-18 TOOLING: Source cleanup waves lacked exact files

- **What went wrong:** The cleanup plan ordered review waves but still exposed only aggregate counts and samples, which left reviewers without the exact path list for each wave.
- **Root cause:** The source-control artifact intentionally capped `statusEntries` for readability, but no separate path-only manifest existed for downstream review tooling.
- **Prevention rule:** Keep human-readable samples capped, but write a full path-only status manifest for review automation. Cleanup plans should attach exact files to each wave while preserving the hard clean-source gate.
- **Files affected:** `scripts/write-source-control-evidence.mjs`, `scripts/write-source-review-plan.mjs`, `docs/solutions/deploy-evidence-hard-gate.md`.

### 2026-06-18 TOOLING: Provider quality was documented but not deploy-gated

- **What went wrong:** Apollo, Seamless, and Tech Intel live source-quality risk was documented as a residual release risk, but the strict deploy verifier did not require a fresh provider-quality artifact.
- **Root cause:** The provider UX/API work shipped honest lanes first, then release evidence work hardened load/secrets/Sentry/browser without carrying the provider-source risk into the same hard gate.
- **Prevention rule:** Any residual risk that depends on live external provider evidence must become a release artifact or an explicit launch exception. Strict deploy gates should reject missing, local, fixture-only, or weak source-quality proof.
- **Files affected:** `scripts/write-provider-quality-evidence.mjs`, `scripts/verify-deploy-evidence.mjs`, `scripts/run-deploy-evidence-bundle.mjs`, `scripts/write-release-tool-readiness.mjs`, `package.json`, `docs/solutions/deploy-evidence-hard-gate.md`.

### 2026-06-18 TOOLING: Release evidence lacked one sequenced operator path

- **What went wrong:** The release gate had strong individual evidence commands, but no single auditable runner that executed them in order and recorded the final strict verifier result.
- **Root cause:** Evidence work improved each proof family independently, leaving the operator journey as a manual checklist rather than a fail-closed release command.
- **Prevention rule:** Every production evidence family must be reachable from one bundle runner that writes a redacted artifact, records skipped/failed steps, and ends with the strict verifier. Dry-run artifacts must stay blocked so planning output cannot be used as approval.
- **Files affected:** `scripts/run-deploy-evidence-bundle.mjs`, `scripts/write-release-tool-readiness.mjs`, `package.json`, `docs/solutions/deploy-evidence-hard-gate.md`.

### 2026-06-18 TOOLING: Secret history owner approval was only a boolean

- **What went wrong:** Secret-history evidence required owner approval but did not require a separate named owner approver, making the approval too easy to represent as a checkbox.
- **Root cause:** The artifact schema modeled reviewer and owner approval, but not the accountable security owner identity for historical credential disposition.
- **Prevention rule:** Any manual security disposition must record both the reviewer/operator and the accountable owner approver. Strict release verifiers should reject historical secret evidence when owner approval is true but no owner approver is named.
- **Files affected:** `scripts/write-secret-scan-evidence.mjs`, `scripts/verify-deploy-evidence.mjs`, `scripts/run-deploy-evidence-bundle.mjs`, `docs/solutions/deploy-evidence-hard-gate.md`.

### 2026-06-18 TOOLING: Secret owner approval still lacked audit shape

- **What went wrong:** Adding a named owner approver improved accountability, but the release evidence still allowed a historical secret disposition without an approval ticket/reference or timestamps for approval and rotation verification.
- **Root cause:** The gate focused on boolean truth values before modeling the evidence shape a security owner can actually sign and an auditor can trace.
- **Prevention rule:** Manual launch approvals must have identity, ticket/reference, timestamp, and a single machine-readable disposition file. Bundle preflight should ingest that file so release operators do not hand-compose security signoff from scattered environment flags.
- **Files affected:** `scripts/write-secret-scan-evidence.mjs`, `scripts/verify-deploy-evidence.mjs`, `scripts/run-deploy-evidence-bundle.mjs`, `docs/templates/secret-history-disposition.example.json`, `docs/solutions/deploy-evidence-hard-gate.md`.

### 2026-06-18 TOOLING: Release evidence did not prove source provenance

- **What went wrong:** Strict deploy verification could accept operational evidence artifacts without proving they were generated from a clean, attributable Git revision.
- **Root cause:** The release gate tracked tools, load, scanners, secrets, providers, Sentry, and browser proof, but treated source-control cleanliness as an implicit human step.
- **Prevention rule:** Enterprise release gates must include source-control evidence: full commit SHA, clean worktree, no staged changes, no tracked modifications, and no untracked files. The bundle should run this before expensive live evidence and stop early when the source snapshot is dirty.
- **Files affected:** `scripts/write-source-control-evidence.mjs`, `scripts/verify-deploy-evidence.mjs`, `scripts/run-deploy-evidence-bundle.mjs`, `scripts/write-release-tool-readiness.mjs`, `package.json`, `docs/solutions/deploy-evidence-hard-gate.md`.

### 2026-06-18 TOOLING: Source provenance lacked upstream reviewability

- **What went wrong:** Source-control evidence could prove a clean local commit without proving the commit belonged to an upstream tracking branch or had zero ahead/behind drift.
- **Root cause:** The first provenance pass modeled local cleanliness before remote reviewability.
- **Prevention rule:** Release source evidence must record upstream branch and ahead/behind counts. Strict release gates should fail missing upstream, unpushed commits, and branches behind upstream.
- **Files affected:** `scripts/write-source-control-evidence.mjs`, `scripts/verify-deploy-evidence.mjs`, `docs/solutions/deploy-evidence-hard-gate.md`.

### 2026-06-17 API: Sentry privacy docs drifted from production init

- **What went wrong:** The documented Sentry PII scrubber lived in the Fastify plugin file, but the actual API entrypoint initialized Sentry through `apps/api/src/instrument.ts` without the scrubber. Auth also set Sentry user context with email.
- **Root cause:** Observability was split between an init module, a request plugin, and auth-side convenience calls. The tests covered copied scrubber logic, not the production init/request-context path.
- **Prevention rule:** Privacy scrubbers must live in a shared helper used by the real init path; tests must import that helper directly and assert request context never includes email/name/phone. Capture handled 5xx errors at the central error-handler sink, not by assuming framework hooks cover normalized errors.
- **Files affected:** `apps/api/src/lib/sentry-privacy.ts`, `apps/api/src/instrument.ts`, `apps/api/src/plugins/sentry.ts`, `apps/api/src/plugins/auth.ts`, `apps/api/src/plugins/error-handler.ts`.

### 2026-06-18 TOOLING: Browser evidence selftest missed Windows spawn/runtime parser gaps

- **What went wrong:** The browser evidence selftest validated fixture parsing and command construction, but the first real runner attempt failed on Windows `pnpm` spawning, then parsed real Playwright JSON as unknown tests.
- **Root cause:** The selftest did not execute the spawned command boundary, and the parser fixture used simplified `passed` statuses/file paths instead of Playwright's real `status: "expected"` and testDir-relative paths.
- **Prevention rule:** Release evidence runners need at least one real local execution to a non-latest artifact on the current OS, plus parser fixtures that mirror real tool output status/path shapes.
- **Files affected:** `scripts/write-browser-regression-evidence.mjs`, `package.json`, `docs/solutions/deploy-evidence-hard-gate.md`.

### 2026-06-18 TOOLING: Sentry evidence depended on a manual smoke trigger pre-step

- **What went wrong:** The Sentry evidence writer queried for API/worker smoke issues, but the normal release command did not trigger those controlled failures first.
- **Root cause:** Triggering and observing were documented as separate human steps instead of one auditable release evidence flow.
- **Prevention rule:** Release evidence commands should either create the signal they verify or record that they are query-only. Manual pre-steps must have a trigger-capable script path before the gate is called release-ready.
- **Files affected:** `scripts/write-sentry-smoke-evidence.mjs`, `package.json`, `docs/solutions/deploy-evidence-hard-gate.md`, `docs/observability/sentry.md`.

### 2026-06-18 TOOLING: Load certification command could create rejectable release proof

- **What went wrong:** The load certification command could be run with default localhost settings, producing a local artifact that the strict deploy verifier correctly rejected.
- **Root cause:** The k6 wrapper guarded non-local auth, but it did not have a named strict release-evidence mode that refused local/invalid targets before k6 started.
- **Prevention rule:** Evidence commands used for release approval need a strict mode separate from local regression commands. Strict load evidence must fail before execution unless it is certification profile, non-local, authenticated, and not health-only.
- **Files affected:** `scripts/run-k6-load-test.mjs`, `package.json`, `docs/solutions/deploy-evidence-hard-gate.md`, `docs/solutions/k6-load-gate-docker-fallback.md`.

### 2026-06-18 WEB: Technical stack source review was too all-or-nothing

- **What went wrong:** The Technical Stack source review queue could collect Apollo, Seamless, Tech Intel MCP, and other suggestions together, but users had no provider filter and source cards did not show the reported transport. That made large provider pulls harder to trust and made bulk acceptance feel too broad.
- **Root cause:** The first premium review queue optimized for one visible source shelf before modeling the enterprise review task as a provider-scoped inbox.
- **Prevention rule:** Any multi-provider review queue must expose source/provider filters, counts, transport/provenance cues, and batch actions scoped to the user’s current review filter. Keep an All filter for full-queue actions, and test both paths.
- **Files affected:** `apps/web/src/components/cockpit/TechStackCard.tsx`, `apps/web/src/components/cockpit/TechStackCard.test.tsx`, `apps/web/src/styles/cockpit.css`.

### 2026-06-18 TOOLING: Failed bundles made source cleanup a second manual step

- **What went wrong:** The production bundle stopped at dirty source evidence, but operators still had to know and run a separate source review planner command to get exact cleanup waves.
- **Root cause:** The planner was strict by default and exited non-zero on active waves, so it was not safe to include in the bundle without a write-only diagnostic mode.
- **Prevention rule:** Any expected-fail evidence gate that can produce a useful remediation artifact should have a bundle-safe write mode. The remediation step must not count as deploy approval or weaken the strict final verifier.
- **Files affected:** `scripts/run-deploy-evidence-bundle.mjs`, `scripts/write-source-review-plan.mjs`, `package.json`, `docs/solutions/deploy-evidence-hard-gate.md`.

### 2026-06-18 WEB: Technical stack review count counted staged suggestions

- **What went wrong:** The Technical Stack edit-mode provider panel could keep showing the original provider suggestion count after a user accepted a suggestion into the draft, so the source inbox felt stale before save.
- **Root cause:** The metric used the server suggestion list instead of the draft-filtered list that excludes technologies already staged by the user.
- **Prevention rule:** Workflow counters must derive from the same visible/actionable collection as the UI list. For review queues, test the count before and after staging an item, not only after persistence.
- **Files affected:** `apps/web/src/components/cockpit/TechStackCard.tsx`, `apps/web/src/components/cockpit/TechStackCard.test.tsx`.

### 2026-06-18 WEB: Technical stack batch accept could include hidden provider rows

- **What went wrong:** The Technical Stack source inbox capped the visible provider cards at eight, but the batch action could still stage every filtered suggestion, including hidden rows the user had not inspected.
- **Root cause:** The batch action used the filtered source array instead of the visible source array, while the overflow copy implied the hidden scope was intentional.
- **Prevention rule:** Review-queue batch actions must operate on the same visible/actionable collection named by the button. If hidden rows can be affected, the UI must expose an explicit separate action and tests must prove the hidden-row behavior.
- **Files affected:** `apps/web/src/components/cockpit/TechStackCard.tsx`, `apps/web/src/components/cockpit/TechStackCard.test.tsx`, `apps/web/src/styles/cockpit.css`.

### 2026-06-18 API: Generic Tech Intel MCP was only a single source

- **What went wrong:** The Technical Stack source-pull UX could honestly say Tech Intel MCP, but the backend only supported one generic MCP endpoint. BuiltWith, Wappalyzer, and private enrichers needed a custom aggregator before they could all contribute stack evidence.
- **Root cause:** The provider metadata modeled a single `techStackMcp` profile before the product workflow was treated as a multi-source intelligence inbox.
- **Prevention rule:** Vendor-neutral MCP lanes must support multiple named source configs, preserve provider labels downstream, and keep legacy single-source envs compatible. Tests should cover multiple configured MCPs and duplicate technology de-dupe.
- **Files affected:** `apps/api/src/providers/company-tech-stack-mcp.ts`, `apps/api/src/services/crm/enrichment.service.ts`, `apps/api/src/services/crm/company-enrichment.service.ts`, `apps/api/src/routes/crm/companies.ts`, `.env.example`.

### 2026-06-18 TOOLING: Provider evidence proved the lane but not named Tech Intel sources

- **What went wrong:** Release evidence could prove the generic `tech_intel` lane while failing to prove that each promised MCP source, such as BuiltWith MCP and Wappalyzer MCP, actually returned attributed stack evidence.
- **Root cause:** The first provider-quality gate treated source lanes as the release contract. After multi-MCP support, the contract needed a second dimension: expected source labels inside the Tech Intel lane.
- **Prevention rule:** Any aggregate provider lane that accepts multiple named sources must expose both expected and observed source labels in its release artifact. Strict deploy verification must reject missing named sources when operators declare them required.
- **Files affected:** `scripts/write-provider-quality-evidence.mjs`, `scripts/verify-deploy-evidence.mjs`, `scripts/run-deploy-evidence-bundle.mjs`, `docs/templates/release-evidence.env.example`.

### 2026-06-18 TOOLING: Operational readiness was documented but not deploy-gated

- **What went wrong:** Deploy evidence proved app/source/provider/browser families, but Azure plan, migration path, backup/restore, rollback, monitoring, on-call, and ops approval were still mostly docs-only or draft evidence.
- **Root cause:** The strict verifier hardened product and security signals first, while platform/ops readiness stayed outside the machine-readable release artifact set.
- **Prevention rule:** 100k-user release gates must require platform/ops evidence: infra plan/build, migration deployment path, backup configuration and retention, restore RTO/RPO drill, rollback runbook/drill, monitoring alerts, on-call escalation, named approver, ticket/reference, and approval timestamp.
- **Files affected:** `scripts/write-operational-readiness-evidence.mjs`, `scripts/verify-deploy-evidence.mjs`, `scripts/run-deploy-evidence-bundle.mjs`, `scripts/write-release-tool-readiness.mjs`, `package.json`, `docs/templates/operational-readiness.example.json`, `docs/templates/release-evidence.env.example`, `docs/solutions/deploy-evidence-hard-gate.md`, `docs/solutions/release-tool-readiness-gate.md`.

### 2026-06-18 WEB: Auth cache fingerprint ignored tenant switches

- **What went wrong:** Long-lived tabs could keep user-scoped React Query snapshots when the effective workspace changed but the local session marker did not, especially demo email/workspace changes under `bidstack:session=demo` and Clerk organization switches under the same user id.
- **Root cause:** Cache invalidation listened to `bidstack:session` storage changes, but the fingerprint omitted Clerk `orgId` and had no same-tab event for identity details that change while the session marker string remains stable.
- **Prevention rule:** User-scoped browser caches must key invalidation by the effective tenant identity, not only the login session. Emit a same-tab auth-fingerprint event for auth writes, include organization/workspace identity in the marker, and test same-marker identity changes.
- **Files affected:** `apps/web/src/lib/queryCache.ts`, `apps/web/src/lib/queryCache.test.ts`, `apps/web/src/lib/auth.tsx`, `apps/web/src/lib/auth.test.tsx`, `docs/solutions/idle-auth-refresh-and-focus-refetch.md`.

### 2026-06-18 WEB: Pipeline drag/drop lacked pointer-path browser proof

- **What went wrong:** Keyboard stage movement and optimistic mutation behavior had coverage, but native pointer drag-and-drop could regress without a focused browser proof.
- **Root cause:** Critical-controls work emphasized command and keyboard paths, while the pipeline suite lacked an API-backed native drop test that asserted both board placement and persisted stage data.
- **Prevention rule:** Critical workflows need both accessible keyboard and pointer-path E2E proof, plus rollback unit tests for optimistic cache mutations. Green tests should be free of warning noise.
- **Files affected:** `apps/web/e2e/flows/pipeline.spec.ts`, `apps/web/src/hooks/useStageMutation.test.tsx`, `docs/solutions/pipeline-drag-drop-qa-gate.md`.

### 2026-06-18 WEB: Outcome button QA depended on seeded terminal state

- **What went wrong:** Mark Won browser proof could skip when seeded first deal was terminal, and detail UI had no explicit Mark Won/Lost buttons despite the page object expecting them.
- **Root cause:** Critical-controls coverage relied on seed data and a generic stage selector instead of fixture-backed terminal action controls.
- **Prevention rule:** Revenue terminal actions need explicit UI controls wired through the domain transition route and deterministic API-backed E2E for each terminal outcome. Tests must assert pipeline semantics (`isWon`/`isLost` plus linked pipeline stage), not display labels.
- **Files affected:** `apps/web/src/pages/OpportunityDetailPage.tsx`, `apps/web/e2e/pages/DealDetailPage.ts`, `apps/web/e2e/flows/pipeline.spec.ts`, `docs/solutions/pipeline-outcome-buttons-qa-gate.md`.

### 2026-06-18 TOOLING: Source review plan could outlive the source artifact

- **What went wrong:** The source cleanup plan could be generated from an older source-control artifact and still look actionable after later worktree changes.
- **Root cause:** `write-source-review-plan` trusted `deploy-evidence/source-control-latest.json` without comparing its commit/status manifest to the current Git worktree.
- **Prevention rule:** Remediation plans for dirty source must prove currency before allowing active cleanup waves. Compare commit, branch, upstream, and the full status manifest; stale evidence must fail even in write/diagnostic mode.
- **Files affected:** `scripts/write-source-review-plan.mjs`, `docs/solutions/deploy-evidence-hard-gate.md`.

### 2026-06-18 WEB: Provider workbench copy crowded the narrow cockpit panel

- **What went wrong:** The Technical Stack workbench correctly named Apollo MCP/API, Seamless MCP/API, Tech Intel MCP, and open data, but the provider title and metric chips could crowd a narrow card column after the copy was made more explicit.
- **Root cause:** The provider panel used a single-row grid for title plus metrics while provider-source copy grew from short lane names into the honest runtime contract.
- **Prevention rule:** When copy becomes more explicit in dense enterprise panels, run a live browser layout check in the real shell, not only unit/E2E clicks. Let metrics wrap under headings and keep file/import/action controls at 44px targets.
- **Files affected:** `apps/web/src/components/cockpit/TechStackCard.tsx`, `apps/web/src/styles/cockpit.css`, `apps/web/src/components/cockpit/TechStackCard.test.tsx`, `apps/web/e2e/technical-stack.spec.ts`.

### 2026-06-18 TOOLING: Secret disposition artifacts accepted template-looking approval fields

- **What went wrong:** Preflight rejected placeholder secret-disposition environment values, but the evidence writer/verifier path could still accept an existing artifact with non-empty sample owner/reviewer/ticket strings.
- **Root cause:** Secret disposition validation checked presence for approver, reviewer, and ticket, while placeholder detection lived mainly in bundle preflight string checks.
- **Prevention rule:** Any release approval field must reject template-looking values at every ingestion layer: preflight, writer, and verifier. Selftests need poisoned twins for copied template files and stale artifacts, not only missing fields.
- **Files affected:** `scripts/write-secret-scan-evidence.mjs`, `scripts/verify-deploy-evidence.mjs`, `docs/solutions/deploy-evidence-hard-gate.md`.

### 2026-06-18 TOOLING: Ops approval tickets only had generic placeholder checks

- **What went wrong:** Operational readiness rejected obvious placeholders like angle-bracket values and example emails, but copied sample tickets such as `OPS-1234` could still satisfy the ticket field if other template values were replaced.
- **Root cause:** The placeholder detector relied on generic words and angle brackets, while approval-ticket samples use realistic-looking project prefixes.
- **Prevention rule:** Release approval ticket fields need exact poisoned sample tokens in every ingestion layer, plus a selftest where only the ticket remains fake. Template files should make sample tickets visibly non-release evidence.
- **Files affected:** `scripts/write-operational-readiness-evidence.mjs`, `scripts/verify-deploy-evidence.mjs`, `scripts/run-deploy-evidence-bundle.mjs`, `docs/templates/operational-readiness.example.json`, `docs/solutions/deploy-evidence-hard-gate.md`.

### 2026-06-18 TOOLING: Provider proof could still look live with fixture-shaped inputs

- **What went wrong:** Provider-quality evidence selftests could use release-shaped fixture values, and strict verification did not reject all provider target/company/token placeholder shapes at every layer.
- **Root cause:** The first strict provider gate focused on required lanes and named Tech Intel source coverage, but it did not fully separate non-strict fixtures from live release proof.
- **Prevention rule:** Provider release evidence must reject fixture response files, local or placeholder targets, placeholder company keys, placeholder or short tokens, and placeholder expected source lists in writer, verifier, and bundle preflight paths. Selftests need poisoned twins for each field.
- **Files affected:** `scripts/write-provider-quality-evidence.mjs`, `scripts/verify-deploy-evidence.mjs`, `scripts/run-deploy-evidence-bundle.mjs`, `docs/solutions/deploy-evidence-hard-gate.md`.

### 2026-06-18 SECURITY: Integration token key format drifted across code, env, and rotation docs

- **What went wrong:** Production env validation only required `INTEGRATION_TOKEN_KEY` to be present, while the token cipher needed a 64-character hex key. The rotation script generated base64 and `.env.example` documented base64, so operators could create a key that passed boot and failed later during OAuth token encryption.
- **Root cause:** The key contract lived in comments and runtime crypto, but was not enforced at API boot or kept synchronized with the rotation runbook.
- **Prevention rule:** Secret/key format contracts must be enforced at every ingestion point: env validation, crypto boundary, examples, and rotation scripts. Add poisoned tests for correct length but wrong alphabet.
- **Files affected:** `packages/shared/src/crypto/token-cipher.ts`, `packages/shared/src/crypto/token-cipher.test.ts`, `apps/api/src/env.ts`, `apps/api/src/env.test.ts`, `.env.example`, `scripts/ops/rotate-secrets.sh`.

### 2026-06-18 WEB: Service worker owned routes that should stay network-only

- **What went wrong:** The PWA worker documented API/auth/export/download bypass behavior, but the actual policy only bypassed `/api/` and `/trpc/`. Production nginx also lacked explicit no-store headers for `sw.js` and `index.html`, and asset cache headers risked shadowing inherited security headers.
- **Root cause:** The cache policy lived in the worker implementation and nginx config without focused tests for network-owned route classes or nginx `add_header` inheritance behavior.
- **Prevention rule:** Service workers must define and test network-owned route prefixes/segments separately from shell assets. When adding cache headers in nginx locations, either avoid `add_header` or redeclare the security headers in that same location.
- **Files affected:** `apps/web/public/sw.js`, `apps/web/src/main.tsx`, `apps/web/e2e/flows/pwa-offline.spec.ts`, `apps/web/nginx.conf`, `apps/web/src/lib/service-worker-policy.test.ts`, `apps/web/src/lib/nginx-cache-policy.test.ts`.

### 2026-06-19 WEB/API: Technical stack source pulls overwrote draft trust

- **What went wrong:** Running Technical Stack `Pull sources` while already editing could replace the user's unsaved draft with the refreshed effective stack. Separately, a single named Tech Intel MCP provider serialized item provenance as generic `enrichment:tech_stack_mcp`.
- **Root cause:** The source-pull handler reused the same draft reset for both pre-edit and in-edit flows, and the single-MCP serializer did not apply the provider slug path used by multi-MCP metadata.
- **Prevention rule:** Refresh actions inside an editor must preserve in-progress draft state unless the user explicitly resets or accepts incoming changes. Provider provenance tests must cover zero, one, and many configured sources, because the one-source path is where aggregate labels often collapse.
- **Files affected:** `apps/web/src/components/cockpit/TechStackCard.tsx`, `apps/web/src/components/cockpit/TechStackCard.test.tsx`, `apps/api/src/services/crm/company-enrichment.service.ts`, `apps/api/src/services/crm/company-enrichment.service.test.ts`.

### 2026-06-19 SECURITY: Local secret regex missed modern token families

- **What went wrong:** The local secret scan stack still focused on older Stripe/AWS/GitHub/OpenAI shapes and missed modern `sk-proj-*`, `sk-ant-*`, `github_pat_*`, Slack, Google API, and Azure Storage `AccountKey=` patterns.
- **Root cause:** Gitleaks defaults were trusted as broad coverage, while the local pre-commit/full-tree/deploy-checklist regexes stayed narrow and did not have poisoned fixture selftests for the token families this product can realistically use.
- **Prevention rule:** Every secret scanner surface must share the same provider-token families and include selftest fixtures for modern key shapes. When adding a provider, add its token shape to staged-diff, full-tree, untracked-source, hook, deploy-checklist, and gitleaks coverage together.
- **Files affected:** `.gitleaks.toml`, `.claude/hooks/scan-secrets.sh`, `scripts/check-secrets.sh`, `scripts/write-secret-scan-evidence.mjs`, `scripts/ops/deploy-checklist.sh`, `docs/solutions/security-scan-local-gates.md`.

### 2026-06-19 WEB: Source-assisted add path downgraded provider matches to manual

- **What went wrong:** Technical Stack had source-backed match chips, but typing an exact pending Apollo/Seamless/Tech Intel MCP technology and pressing the normal Stage command still saved it as manual-only data.
- **Root cause:** Provider provenance was wired only to the explicit source-suggestion buttons. The primary composer path did not resolve exact typed vendors against pending provider suggestions before staging.
- **Prevention rule:** Any assisted manual-entry path must make the primary commit command source-aware when exact provider matches exist. Tests need to cover the obvious keyboard/button path, not only the special recommendation chip.
- **Files affected:** `apps/web/src/components/cockpit/TechStackCard.tsx`, `apps/web/src/components/cockpit/TechStackCard.test.tsx`, `docs/solutions/technical-stack-provider-source-pull.md`.

### 2026-06-19 SECURITY: Server crypto kept accepting legacy key formats

- **What went wrong:** After aligning token-cipher, env validation, rotation, and Azure policy on 64-character hex `INTEGRATION_TOKEN_KEY`, the exported `@bidstack/shared/server-crypto` helper still accepted base64 key material.
- **Root cause:** Two AES-GCM helpers owned the same operator-facing secret contract, but only the newer token-cipher path had poisoned tests for legacy base64 and correct-length wrong-alphabet keys.
- **Prevention rule:** Any shared secret/key contract must have one poisoned regression suite per exported helper and one operator-contract note listing every runtime importer. Do not call the contract aligned until all exported crypto boundaries reject the same bad fixtures.
- **Files affected:** `packages/shared/src/utils/crypto.ts`, `packages/shared/src/utils/crypto.test.ts`, `docs/solutions/agent-provider-credentials-org-secret-routing.md`.

### 2026-06-19 API: SERUM status ignored its own config audit events

- **What went wrong:** The SERUM status summary's `latestConfigChangeAt` watched agent-provider, Dust, org settings, and RBAC audit actions, but ignored the `serum_config.*` audit rows written by SERUM draft/publish/rollback workflows.
- **Root cause:** The status freshness query was introduced before the versioned SERUM config audit trail was fully wired, and the config lifecycle test verified the snapshot audit trail but not the top-level status summary.
- **Prevention rule:** Any control-plane workflow that writes audit events must have a status-summary freshness assertion proving its own status page reflects those events. Do not rely only on detail-page audit trails.
- **Files affected:** `apps/api/src/routes/serum.ts`, `apps/api/src/routes/serum.integration.test.ts`, `docs/solutions/serum-versioned-config-control-plane.md`.

### 2026-06-19 UX: Technical stack MCP pull was still outside the add moment

- **What went wrong:** The Technical Stack composer still led with manual add, while provider pull/coverage lived in the surrounding panel and queue. The intake summary also squeezed five metrics into four columns, and mobile source lane/drop-cue copy could truncate around 390px.
- **Root cause:** Provider-pull UX had been layered onto the editor incrementally. Tests covered function and provenance, but not whether the composer itself made Apollo, Seamless.AI, Tech Intel MCP, open data, source-backed accept, and mobile wrapping feel first-class.
- **Prevention rule:** Source-backed entity composers must expose provider pull, provider coverage, best-match accept, and provenance in the same add surface. Browser QA must include mobile overflow after adding new status chips or source-copy rows.
- **Files affected:** `apps/web/src/components/cockpit/TechStackCard.tsx`, `apps/web/src/components/cockpit/TechStackCard.test.tsx`, `apps/web/src/styles/cockpit.css`, `docs/solutions/technical-stack-provider-source-pull.md`.

### 2026-06-19 SECURITY: Secret scanner selftests used raw token-shaped fixtures

- **What went wrong:** `scripts/write-secret-scan-evidence.mjs` widened modern token coverage but stored raw poisoned fixture strings in the scanner source. Because the file was still untracked, the untracked release scan flagged the scanner itself; once tracked, the full-tree scanner would have hit the same source literals.
- **Root cause:** Selftests proved detection of assembled values but did not also prove that scanner/test source stayed scan-clean. The scanner surfaces were aligned, yet the fixture storage format violated the scanner's own release rule.
- **Prevention rule:** Secret scanner fixtures must be assembled from non-matching fragments at runtime, and every scanner selftest must assert its own source text does not match the production secret regex. Never allow raw token-shaped literals in scanner source, tests, or docs outside explicitly excluded example files.
- **Files affected:** `scripts/write-secret-scan-evidence.mjs`, `docs/solutions/security-scan-local-gates.md`.

### 2026-06-19 TOOLING: Operational restore proof coerced missing values to green 0m

- **What went wrong:** The strict production verifier could display missing operational `restoreRtoMinutes` and `restoreRpoMinutes` values as passing `0m` subchecks because `Number(null)` returns `0`.
- **Root cause:** The operational evidence writer correctly used `null` for absent numeric proof, but the verifier compared coerced numbers without first checking that numeric evidence was present.
- **Prevention rule:** Release evidence verifiers must parse numeric evidence with an explicit missing-value guard before threshold comparisons. Add poisoned selftests for `null`, empty string, and out-of-threshold values whenever a gate compares numeric proof.
- **Files affected:** `scripts/verify-deploy-evidence.mjs`, `docs/solutions/deploy-evidence-hard-gate.md`.

### 2026-06-19 UX: Accepted stack source proof was hidden in the draft

- **What went wrong:** The Technical Stack add assistant could accept source-backed Apollo, Seamless, Tech Intel MCP, or open-data suggestions, but the composer did not summarize accepted provider/source evidence before save.
- **Root cause:** The source-aware add path preserved provenance in item metadata, while the visible composer state still optimized for queued suggestions and typed entries.
- **Prevention rule:** Source-assisted entity composers must show pre-save proof for accepted source-backed draft rows, including provider/source counts and mobile wrapping checks.
- **Files affected:** `apps/web/src/components/cockpit/TechStackCard.tsx`, `apps/web/src/components/cockpit/TechStackCard.test.tsx`, `apps/web/src/styles/cockpit.css`, `docs/solutions/technical-stack-provider-source-pull.md`.

### 2026-06-19 TOOLING: Sentry smoke preflight missed CLI auth

- **What went wrong:** The release bundle preflight required Sentry smoke target, release, org, projects, smoke token, and DSN proof, but not the Sentry CLI auth token needed for `sentry issue list`.
- **Root cause:** The preflight modeled the smoke trigger inputs but not the observation/query credential used by the evidence writer.
- **Prevention rule:** Evidence preflight must cover every external credential used by both the trigger path and the observation path. If a writer shells out to a SaaS CLI, its auth token must be preflight-checked with poisoned placeholder coverage.
- **Files affected:** `scripts/run-deploy-evidence-bundle.mjs`, `docs/solutions/deploy-evidence-hard-gate.md`.

### 2026-06-19 UX: Technical stack add path lacked source-verification guidance

- **What went wrong:** The Technical Stack composer had source pull, provider review, and accepted-source proof, but typed manual entries still did not get a clear contextual source-check prompt before Stage.
- **Root cause:** Tests covered provider pulls and accepted provenance after action, but not the pre-stage decision state where a user decides whether to verify a typed vendor against Apollo, Seamless.AI, Tech Intel MCPs, and open data.
- **Prevention rule:** Source-assisted add flows must test unchecked-provider guidance, exact source-match guidance, mobile no-overflow, and 44px touch targets around the primary add command.
- **Files affected:** `apps/web/src/components/cockpit/TechStackCard.tsx`, `apps/web/src/components/cockpit/TechStackCard.test.tsx`, `apps/web/src/styles/cockpit.css`, `apps/web/e2e/technical-stack.spec.ts`, `docs/solutions/technical-stack-provider-source-pull.md`.

### 2026-06-19 TOOLING: Browser release evidence did not check deploy environment

- **What went wrong:** Strict deploy evidence checked browser regression profile, target, Clerk auth, production build, roles, projects, specs, and test counts, but did not require the browser artifact's environment to match the deploy target.
- **Root cause:** The browser artifact recorded environment as metadata, while the verifier treated it as informational. Evidence environment normalization also reused the deploy-target normalizer, which defaulted missing values to `production`.
- **Prevention rule:** Every release evidence artifact that records an environment must have a strict environment-match assertion and a poisoned mismatch selftest. Use optional-evidence normalization for artifact values so missing evidence stays missing.
- **Files affected:** `scripts/verify-deploy-evidence.mjs`, `docs/solutions/deploy-evidence-hard-gate.md`.

### 2026-06-19 TOOLING: Provider release evidence did not check deploy environment

- **What went wrong:** Strict deploy evidence checked provider live-refresh status, target, company key, source lanes, response lanes, and Tech Intel MCP sources, but did not require the provider artifact's environment to match the deploy target.
- **Root cause:** Provider quality recorded `environment`, but the verifier treated it as informational metadata rather than release-scope evidence.
- **Prevention rule:** Any release evidence artifact with provider, browser, observability, ops, load, or security proof must assert environment equality in strict mode and include a poisoned mismatch selftest.
- **Files affected:** `scripts/verify-deploy-evidence.mjs`, `docs/solutions/deploy-evidence-hard-gate.md`.

### 2026-06-19 TOOLING: Container scan writer could pass an empty image set

- **What went wrong:** A malformed `BIDSTACK_CONTAINER_SCAN_IMAGES` override such as `,,` could reduce the scanner image list to zero and still let the writer emit `passed: true`.
- **Root cause:** The runner parsed image/severity lists at module load and did not enforce a non-empty requested image set or require reports for every requested image in the evidence builder.
- **Prevention rule:** Evidence writers must fail closed on empty required target sets, record requested target coverage, and selftest separator-only overrides plus zero-report artifacts.
- **Files affected:** `scripts/run-container-vulnerability-scan.mjs`, `docs/solutions/container-vulnerability-scan-gate.md`.

### 2026-06-19 UX: Duplicate stack sources could downgrade typed provenance

- **What went wrong:** When Apollo, Seamless, or a Tech Intel MCP reported the same typed technology, the composer sorted suggestions by confidence/provider trust and then rebuilt them into a `Map` that let later, weaker duplicate rows overwrite the best source.
- **Root cause:** The exact-match lookup used `new Map(sortedPairs)` without an explicit first-wins rule, so sorted order was not preserved for duplicate vendor names.
- **Prevention rule:** Any source-backed add flow that dedupes sorted provider evidence must use a named first-wins helper and a regression with duplicate provider rows. Canonical provider names should win over rough typed casing when a source match exists.
- **Files affected:** `apps/web/src/components/cockpit/TechStackCard.tsx`, `apps/web/src/components/cockpit/TechStackCard.test.tsx`, `docs/solutions/technical-stack-provider-source-pull.md`.

### 2026-06-19 TOOLING: Docker daemon readiness stood in for image execution proof

- **What went wrong:** Strict deploy verification accepted a passing tool-readiness artifact even when Gitleaks, k6, Semgrep, and Trivy Docker image probes were marked `skipped`.
- **Root cause:** The writer kept image probes optional for local inventory, and the strict verifier only inspected required failed checks instead of requiring executed image proof when a release tool depended on Docker fallback.
- **Prevention rule:** Release evidence may treat direct local inventory as informational, but strict staging/production gates must require executed pinned-image probes for every Docker-dependent fallback. A green Docker daemon check is not image execution proof.
- **Files affected:** `package.json`, `scripts/verify-deploy-evidence.mjs`, `scripts/run-deploy-evidence-bundle.mjs`, `docs/solutions/release-tool-readiness-gate.md`, `docs/solutions/deploy-evidence-hard-gate.md`.

### 2026-06-19 TOOLING: Strict deploy verifier left stale JSON reports

- **What went wrong:** `pnpm deploy:evidence:production` printed fresh strict results but did not update `deploy-evidence/strict-production-latest.json` unless `BIDSTACK_DEPLOY_EVIDENCE_REPORT` was set.
- **Root cause:** The verifier defaulted to console-only output for strict runs instead of deriving a target-specific release report path.
- **Prevention rule:** Release verifiers must always write the same fresh pass/fail state to the canonical artifact path used by reviewers. Selftests must assert default report paths for every deploy target.
- **Files affected:** `scripts/verify-deploy-evidence.mjs`, `docs/solutions/deploy-evidence-hard-gate.md`.

### 2026-06-19 TOOLING: Sentry smoke proof omitted the trigger target

- **What went wrong:** Sentry smoke evidence could prove matching API and worker issues existed in Sentry without proving which release API target produced those events.
- **Root cause:** Bundle preflight checked `API_BASE_URL`, but the compact Sentry artifact and strict verifier treated target provenance as outside the artifact contract.
- **Prevention rule:** Observability release evidence must record the event-producing target, and strict gates must reject missing, local, or placeholder targets with poisoned selftests.
- **Files affected:** `scripts/write-sentry-smoke-evidence.mjs`, `scripts/verify-deploy-evidence.mjs`, `docs/solutions/deploy-evidence-hard-gate.md`, `docs/observability/sentry.md`.

### 2026-06-19 TOOLING: Strict source evidence trusted stale clean JSON

- **What went wrong:** The source-review planner compared source evidence to current Git, but the strict deploy verifier only checked source artifact freshness and the artifact's recorded clean/dirty fields.
- **Root cause:** Currentness enforcement lived in the cleanup-planning helper, not in the deploy-blocking verifier.
- **Prevention rule:** Release source evidence must be compared with live Git state inside the strict deploy gate. Selftests must prove a stale clean artifact fails after a new worktree change.
- **Files affected:** `scripts/verify-deploy-evidence.mjs`, `docs/solutions/deploy-evidence-hard-gate.md`.

### 2026-06-19 UX: Other attributed stack sources lost clear provenance

- **What went wrong:** The Technical Stack add assistant could receive attributed stack suggestions from valid sources outside Apollo, Seamless.AI, configured Tech Intel MCP, open-data, meeting, or Omniscient families, but the review UI did not give those sources a visible lane or readable accepted-source label.
- **Root cause:** Source mapping logic covered known provider families and preserved raw metadata, while unknown attributed sources fell back to generic accepted proof.
- **Prevention rule:** Source-assisted composers must preserve every attributed source in visible pre-save proof, including an explicit fallback lane and readable fallback label for unknown but valid source IDs.
- **Files affected:** `apps/web/src/components/cockpit/TechStackCard.tsx`, `apps/web/src/components/cockpit/TechStackCard.test.tsx`, `docs/solutions/technical-stack-provider-source-pull.md`.

### 2026-06-19 TOOLING: Browser release evidence could be summary-only

- **What went wrong:** Strict browser release verification could accept a hand-authored summary artifact with `passed: true`, required roles/projects/specs, and a non-local target without proving the raw Playwright JSON report or command trail existed. It also did not reject `tests.unknown > 0` when the artifact claimed `passed: true`.
- **Root cause:** The browser writer emitted source-report proof, but the strict verifier only checked the compact summary fields.
- **Prevention rule:** Release evidence verifiers must require the raw source artifact and command trail for derived summaries, plus poisoned tests for summary-only artifacts and unknown outcome counts.
- **Files affected:** `scripts/verify-deploy-evidence.mjs`, `docs/solutions/deploy-evidence-hard-gate.md`.

### 2026-06-19 TOOLING: Load certification could rely on derived summary only

- **What went wrong:** Strict load verification checked `production-load-latest.json` thresholds and metrics but did not require the raw k6 summary export to exist, even though the compact artifact is derived from that raw run.
- **Root cause:** The load writer recorded `rawSummaryPath` and `rawSummaryFound`, while the strict verifier only consumed the derived fields.
- **Prevention rule:** Release verifiers must require raw source artifacts for every derived evidence summary, and include a poisoned missing-source fixture.
- **Files affected:** `scripts/verify-deploy-evidence.mjs`, `docs/solutions/deploy-evidence-hard-gate.md`, `docs/solutions/k6-load-gate-docker-fallback.md`.

### 2026-06-19 TOOLING: Playwright project name was assumed

- **What went wrong:** The Technical Stack E2E verification was first run with `--project=chromium`, but this repo names the desktop Chromium project `chromium-desktop`.
- **Root cause:** I assumed the common Playwright project name instead of checking `apps/web/playwright.config.ts` before invoking the targeted E2E command.
- **Prevention rule:** Before a targeted Playwright run, read the repo config or run `pnpm --filter @bidstack/web exec playwright test --list` and use the exact project name. If a managed server port is already healthy, use the repo's `E2E_REUSE_SERVER=1` path rather than killing local processes.
- **Files affected:** Verification command only.

### 2026-06-19 TOOLING: Container release evidence could be compact-only

- **What went wrong:** Strict container verification could rely on `container-scan-latest.json` without requiring the raw Trivy JSON reports that produced the zero-finding summary.
- **Root cause:** The scanner wrote a derived compact artifact, and the verifier checked image coverage, immutability, environment, and findings but did not require source-report proof.
- **Prevention rule:** Every derived release evidence summary must point to repo-local raw source artifacts, and strict verifiers must include poisoned compact-only fixtures.
- **Files affected:** `scripts/run-container-vulnerability-scan.mjs`, `scripts/verify-deploy-evidence.mjs`, `docs/solutions/container-vulnerability-scan-gate.md`, `docs/solutions/deploy-evidence-hard-gate.md`.

### 2026-06-19 TOOLING: Raw load and browser reports only needed to exist

- **What went wrong:** Strict load and browser verification required raw source report paths, but a zero-byte or non-JSON file at that path could still satisfy the release gate.
- **Root cause:** The verifier checked `existsSync` for raw k6 and Playwright reports while only the container raw Trivy gate parsed JSON.
- **Prevention rule:** Source artifacts for derived release summaries must be opened and parsed in strict mode, with invalid-source poison fixtures for each artifact family.
- **Files affected:** `scripts/verify-deploy-evidence.mjs`, `docs/solutions/deploy-evidence-hard-gate.md`, `docs/solutions/k6-load-gate-docker-fallback.md`, `docs/solutions/cross-browser-e2e-core-gate.md`.

### 2026-06-19 TOOLING: Semgrep release proof allowed compact summaries

- **What went wrong:** Strict Semgrep verification could accept a compact `passed: true` / `blockingFindings: 0` summary without proving the scanner, configs, severities, coverage, command exit, raw arrays, or Dockerfile syntax check.
- **Root cause:** Semgrep was treated differently from newer evidence lanes that require source-run provenance. The verifier trusted outcome fields without validating run metadata.
- **Prevention rule:** A green release evidence lane must prove the tool actually ran with reviewable metadata, especially when the artifact is generated from an external scanner.
- **Files affected:** `scripts/verify-deploy-evidence.mjs`, `docs/solutions/deploy-evidence-hard-gate.md`.

### 2026-06-19 TOOLING: Secret scan evidence could be summary-only

- **What went wrong:** Strict secret release verification trusted current-commit and full-history booleans without requiring the raw Gitleaks JSON reports that produced them.
- **Root cause:** The secret evidence writer parsed temp Gitleaks reports and deleted them, while the deploy verifier only inspected the derived disposition fields.
- **Prevention rule:** Secret release evidence must persist repo-local raw Gitleaks JSON reports, and strict verifiers must parse them before accepting any derived secret-scan summary.
- **Files affected:** `scripts/write-secret-scan-evidence.mjs`, `scripts/verify-deploy-evidence.mjs`, `docs/solutions/deploy-evidence-hard-gate.md`.

### 2026-06-19 TOOLING: Ops readiness could pass on boolean claims

- **What went wrong:** Operational readiness evidence could be made release-shaped with boolean flags, names, and timestamps but without references to the approval, Azure validation, backup/restore, rollback, monitoring, or on-call proof behind those claims.
- **Root cause:** The ops writer and strict verifier treated claim fields as the evidence instead of requiring reviewable evidence references for each operational assertion.
- **Prevention rule:** Every operational release claim must carry a non-placeholder evidence reference, and bundle preflight must preserve those refs when bridging an ops readiness file into environment variables.
- **Files affected:** `scripts/write-operational-readiness-evidence.mjs`, `scripts/verify-deploy-evidence.mjs`, `scripts/run-deploy-evidence-bundle.mjs`, `docs/solutions/deploy-evidence-hard-gate.md`.

### 2026-06-19 TOOLING: Failed strict container preflight left stale evidence

- **What went wrong:** Strict container evidence could exit on invalid deploy inputs before writing a fresh artifact, leaving an older non-strict container scan for the production verifier to read. The verifier also passed `container.findings` when strict evidence had zero image reports.
- **Root cause:** Scanner option validation happened before artifact writing, and the findings check treated an empty report list as zero vulnerabilities instead of no scan evidence.
- **Prevention rule:** Release evidence commands must write a fresh red artifact on preflight failure, and strict verifiers must not turn missing scan reports into zero-finding passes.
- **Files affected:** `scripts/run-container-vulnerability-scan.mjs`, `scripts/verify-deploy-evidence.mjs`, `docs/solutions/container-vulnerability-scan-gate.md`, `docs/solutions/deploy-evidence-hard-gate.md`.

### 2026-06-19 TOOLING: Browser evidence bundle skipped red artifact under preflight blockers

- **What went wrong:** `deploy:evidence:bundle:production` skipped the browser evidence writer whenever operator preflight was blocked, leaving `deploy-evidence/browser-regression-latest.json` missing and forcing the strict verifier to report only missing proof.
- **Root cause:** The bundle runner treated every step as all-or-nothing under preflight blockers, while browser evidence already had a cheap write-only path that can produce a fresh red artifact without launching Playwright.
- **Prevention rule:** Release bundles should run safe diagnostic writers under preflight blockers when they can produce reviewable red artifacts without live side effects.
- **Files affected:** `scripts/run-deploy-evidence-bundle.mjs`, `docs/solutions/cross-browser-e2e-core-gate.md`.

### 2026-06-19 TOOLING: Provider bundle left stale staging evidence under preflight blockers

- **What went wrong:** `deploy:evidence:bundle:production` skipped provider quality evidence when release preflight lacked live provider inputs, so strict production verification kept reading an older staging-scoped provider artifact.
- **Root cause:** The provider writer already knew how to fail closed and write a fresh red artifact before network calls, but the bundle did not mark it as a preflight diagnostic step.
- **Prevention rule:** Safe release evidence writers that fail before external side effects should run under preflight blockers so reviewers see fresh target-scoped failures instead of stale proof.
- **Files affected:** `scripts/run-deploy-evidence-bundle.mjs`, `docs/solutions/deploy-evidence-hard-gate.md`.

### 2026-06-19 WEB/API: Apollo MCP partial config looked queued

- **What went wrong:** Technical Stack refresh could present Apollo source-pull posture while the worker tried to use Apollo MCP with only a URL, and the API producer could enqueue Apollo jobs when neither complete MCP credentials nor REST fallback existed.
- **Root cause:** API provider status required URL plus token to claim MCP readiness, but the worker branch keyed only on URL and queueing did not share the same readiness invariant.
- **Prevention rule:** Provider status, producer queueing, and worker transport selection must use one tested readiness rule. Apollo MCP requires `APOLLO_MCP_URL` plus `APOLLO_MCP_BEARER_TOKEN`; REST fallback requires `APOLLO_API_KEY` plus a domain. Partial MCP config must be unavailable/skipped, never queued as runnable.
- **Files affected:** `apps/api/src/services/crm/enrichment.service.ts`, `apps/api/src/services/crm/company-enrichment.service.test.ts`, `apps/worker/src/queues/company-enrich-apollo.ts`, `apps/worker/src/queues/company-enrich-apollo.test.ts`, `apps/web/src/components/cockpit/TechStackCard.tsx`, `apps/web/src/components/cockpit/TechStackCard.test.tsx`.

### 2026-06-19 DEVOPS: MCP Dockerfile exposed stale traffic port

- **What went wrong:** The root Dockerfile `mcp-server` target exposed `3001`, while `apps/mcp-server/src/main.ts` listens on `PORT_MCP` default `4001`. Platforms that infer service ports from image metadata could route MCP traffic to the wrong port.
- **Root cause:** Health hardening added a separate `4003` health port, but the traffic `EXPOSE` metadata was not checked against the runtime default.
- **Prevention rule:** Any Dockerfile runtime target with a source-defined default port must have a package-level policy test that checks `EXPOSE`, healthcheck, and non-root process order against the source contract.
- **Files affected:** `Dockerfile`, `apps/mcp-server/src/dockerfile-policy.test.ts`, `docs/solutions/mcp-production-env-fail-fast.md`.

### 2026-06-19 DEVOPS: Production compose web app was not published

- **What went wrong:** `docker-compose.prod.yml` published the marketing site but did not publish the primary `web` CRM service, so a local production compose deployment could boot without exposing the actual app UI.
- **Root cause:** The web image moved to unprivileged nginx on container port `8080`, but the compose policy only checked API/worker/MCP secret and dependency wiring.
- **Prevention rule:** Production compose policy must verify every public runtime surface has either an explicit ingress service or a published host port. The main web service must publish container `8080` and the port must be documented in `.env.example`.
- **Files affected:** `docker-compose.prod.yml`, `.env.example`, `scripts/verify-compose-production-policy.mjs`, `docs/RUNBOOK.md`, `docs/solutions/production-compose-secret-wiring.md`.

### 2026-06-19 UI: Technical Stack provider status chips were too cramped

- **What went wrong:** The first source-assistant status-chip pass added useful provider state text but kept a four-column `minmax(0, 1fr)` grid. In the real account card, chips measured about 67px wide, making Apollo/Seamless/Tech Intel status copy feel cramped instead of premium.
- **Root cause:** Component tests verified the text contract, but only the in-app browser preview measured the rendered card inside the dense account layout.
- **Prevention rule:** Any dense cockpit chip/card that adds multi-line status text must get a browser layout check for desktop and 390px mobile widths, including minimum chip width, no horizontal overflow, and touch target measurements.
- **Files affected:** `apps/web/src/components/cockpit/TechStackCard.tsx`, `apps/web/src/components/cockpit/TechStackCard.test.tsx`, `apps/web/src/styles/cockpit.css`, `docs/solutions/technical-stack-provider-source-pull.md`.

### 2026-06-19 DEVOPS: Production web startup only depended on API container creation

- **What went wrong:** The production compose `web` service depended on the API with short-form `depends_on: - api`, which only ordered container creation and did not wait for the API healthcheck.
- **Root cause:** The compose policy checked that the dependency existed, but not that it used a health-gated condition.
- **Prevention rule:** Public web/runtime surfaces that proxy to an internal API must wait on `service_healthy`, and compose policy selftests must include a poisoned short-form dependency fixture.
- **Files affected:** `docker-compose.prod.yml`, `scripts/verify-compose-production-policy.mjs`, `docs/solutions/production-compose-secret-wiring.md`.

### 2026-06-19 API/WORKER: Default-off SERUM blocked existing Dust workflows

- **What went wrong:** The API and worker Dust clients always called the SERUM Dust/MCP Gateway runtime guard, so orgs without a published gateway policy could be denied even when `SERUM_ENABLED` was unset or `false`.
- **Root cause:** The new gateway guard was wired directly into every Dust client method but was not gated by the global SERUM feature flag.
- **Prevention rule:** Default-off enterprise control-plane features must not break existing integrations. Runtime fail-closed checks should activate only when their feature flag is enabled, and tests must cover both disabled-pass-through and enabled-denied paths.
- **Files affected:** `apps/api/src/lib/dust-credentials.ts`, `apps/api/src/lib/dust-credentials.test.ts`, `apps/worker/src/lib/dust-credentials.ts`, `apps/worker/src/lib/dust-credentials.test.ts`, `docs/solutions/serum-control-plane-safe-foundation.md`.

### 2026-06-19 DB: SERUM runtime guards resolved the full control-plane snapshot

- **What went wrong:** Hot runtime guards for SERUM tools, connectors, Dust/MCP gateway, and adjacent policy slices called the full `resolveSerumRuntimePolicy` aggregator even though each decision needed only one active policy row.
- **Root cause:** The admin/status snapshot resolver was reused for runtime enforcement, hiding about ten DB reads behind single-operation checks.
- **Prevention rule:** Runtime guards must have query-budget tests. Admin snapshots may aggregate many policy slices, but per-request enforcement should read only the policy slice and evidence rows required for that decision.
- **Files affected:** `packages/db/src/serum-runtime-policy.ts`, `packages/db/src/serum-runtime-policy.test.ts`, `docs/solutions/serum-control-plane-safe-foundation.md`.

### 2026-06-19 DB: Model Router runtime checks reused admin readiness probes

- **What went wrong:** The Model Router runtime fast path still reused the admin snapshot builder, so explicit model execution checks could query the org active provider and provider credential readiness before checking the single provider being executed.
- **Root cause:** Admin display policy and per-request enforcement shared one DTO builder even though they have different query budgets.
- **Prevention rule:** Runtime guards should use enforcement-specific policy builders when admin snapshots include display-only readiness probes. Query-count tests must cover zero-credential providers such as `gemma` so display-only SQL fan-out is caught.
- **Files affected:** `packages/db/src/serum-runtime-policy.ts`, `packages/db/src/serum-runtime-policy.test.ts`, `docs/solutions/serum-control-plane-safe-foundation.md`.

### 2026-06-19 TOOLING: Local agent worktrees were tracked as gitlinks

- **What went wrong:** Two `.claude/worktrees/*` paths were tracked as gitlinks without a `.gitmodules` mapping. Dirty nested agent worktrees blocked source evidence, and a clean branch could still have shipped malformed local workspace references.
- **Root cause:** `.gitignore` excluded future agent worktrees, but existing tracked gitlink entries remained in the index and the source evidence gate did not check clean tracked local-artifact paths.
- **Prevention rule:** Release source evidence must inspect the Git index for tracked local coordination artifacts, not only dirty status output. `.claude/worktrees/*` must remain local-only and never be tracked in release source.
- **Files affected:** `.claude/worktrees/agent-a10be174ac9f8abbc`, `.claude/worktrees/agent-af86570a156df70f1`, `scripts/write-source-control-evidence.mjs`, `docs/solutions/deploy-evidence-hard-gate.md`.

### 2026-06-20 BUG: soft-delete update-scoping broke GDPR re-erasure (idempotency + PII-on-tombstone)

- **What went wrong:** The soft-delete middleware update/updateMany scoping (commit eb67c010) injected `deletedAt: null` into every update where-clause. GDPR erasure (Art.17) updates a subject by id; on an already soft-deleted contact/lead the scoped update matched 0 rows → P2025 → 404, breaking idempotent re-erasure and leaving PII on tombstoned rows. Caught by the multi-agent QA swarm.
- **Root cause:** Added a global update-scoping guard without enumerating privileged admin ops that MUST mutate soft-deleted rows. The prior review flagged "restore" as the risk class; erasure is the same class and was missed.
- **Prevention rule:** When adding a global Prisma $use guard that excludes soft-deleted rows from mutation, list every privileged op that legitimately mutates tombstoned rows (GDPR erasure, restore, admin merge) and route each through the documented bypass (`where.deletedAt` present = match-all) or $executeRaw, with a regression test per op.
- **Files affected:** packages/db/src/middleware/soft-delete.ts, apps/api/src/routes/erasure.ts

### 2026-06-25 INFRA: Blind `prisma.<newModel>` API code — assumed "image push" = build success

- **What went wrong:** Added a new Prisma model (SalesToolkit) + API routes using `prisma.salesToolkit`. The Windows DLL-lock blocks local `prisma generate` (dev servers hold `query_engine-windows.dll`), so the API couldn't be typechecked locally. A single `reply.code(204).send()` (TS2554 — the zod `204:z.null()` response needs `.send(null)`) failed the Railway api tsc step on EVERY deploy → no new image → the old container kept serving → `/store` 404'd. I burned many deploy/wait cycles + a wrong "Railway won't promote my deploys" diagnosis before reading the build log.
- **Root cause:** Treated the build-log line `image push` (a cached/earlier layer) as success and never read the actual tsc result; the real failure was `Build Failed ... exit code: 2` further down.
- **Prevention rule:** When local typecheck is blocked (new Prisma model + DLL-lock), the Railway/Docker build IS the typecheck — read it immediately: `railway logs <deploymentId> -b | grep -iE "error TS|Build Failed|exit code"`. Do not infer success from `image push` or `readyz ok` (that's the OLD container). Match `reply.send()` to the route's zod response type (`204: z.null()` → `.send(null)`).
- **Files affected:** apps/api/src/routes/sales-toolkits.ts

### 2026-06-25 TESTING: Stale persisted React-Query cache produced phantom account ids during browser QA

- **What went wrong:** Verifying the P0-4 cockpit fix, the demo browser showed Sanofi → `/accounts/9aa8eaaa…`; that id 404'd "Couldn't load the account cockpit", which looked like a P0-4 failure. A DB probe proved company `9aa8eaaa` does not exist (count 0) — the id was a phantom from a prior demo session's persisted RQ cache. `localStorage.removeItem('bidstack-rq-cache')` did NOT clear it (queryCache.ts re-persists from an in-memory mirror); only a full localStorage+SW clear + fresh login cleared it. P0-4 verified fine against a real DB-sourced id.
- **Root cause:** A long-lived test browser accumulates persisted cache across many demo sessions; cached UI links carry ids from orgs that no longer exist.
- **Prevention rule:** For demo browser QA, verify against ids sourced fresh from the DB (or a clean browser/incognito + fresh login), never against cached UI links. Treat a single "Couldn't load" as suspect until the id is confirmed present in the DB.
- **Files affected:** (QA process; no code) — relevant: apps/web/src/lib/queryCache.ts

### 2026-06-27 PROCESS: Workflow "read-only audit" subagents had Write tools and made uncontrolled code edits

- **What went wrong:** A ~300-agent Workflow framed as a READ-ONLY audit spawned DEFAULT subagents (full toolset incl. Edit/Write). Despite "audit / return findings only" prompts, agents edited ~30 files in parallel (auth.ts, rbac.ts + rbac.test.ts, erasure.ts +372, users.ts, sales-toolkits.ts, webhook-subscriptions.\*, worker files, pii-encryption, plus new test files) — unreviewed, unverified. This turned the suite red (rbac.test.ts cross-file failure) and mixed swarm edits into the working tree alongside intended changes.
- **Root cause:** Read-only intent was enforced ONLY by prompt wording, not by tool restriction. Default workflow agentType can write. Agents read "improve / proposedChange" as license to implement.
- **Prevention rule:** For read-only audit/research Workflows: (1) restrict tools — use a read-only agentType (Explore / code-reviewer / Plan) or add an explicit "DO NOT edit or create any file; output findings only" line; (2) run the swarm in worktree isolation so stray writes cannot contaminate the active tree; (3) ALWAYS `git status` immediately after a "read-only" workflow and reconcile before trusting the tree. Back up before discarding (patch + stash), never blind-revert.
- **Also:** the swarm hit the session usage limit (368 agents / 12.86M tokens / ~3.3h) → final synthesis failed, no backlog doc written. Scale read-only fan-outs to the session budget; per-finding adversarial-verify multiplied agent count ~3x.
- **Files affected:** working tree — preserved in `stash@{0}` + `scratchpad/swarm-edits-tracked-2026-06-27.patch` for reviewed mining post-reset.

### 2026-06-27 TESTING: api full suite is intermittently flaky (cross-file env/global leakage) — don't claim "suite green" from one pass

- **What went wrong:** Treated a green full-suite run as proof of stability; subsequent runs failed on DIFFERENT tests (llm-judge, then webhook plaintext-secret), each passing in isolation. The api suite leaks global state across files (serial worker, fileParallelism off): `vi.stubGlobal` without `unstubAllGlobals`, `process.env` mutation, and env-derived module caches.
- **Root cause:** Non-hermetic tests + module-level caches that defeat per-test env overrides.
- **Prevention rule:** A single green full-suite run does NOT prove stability on a known-flaky suite. To attribute a full-suite failure: re-run the named file in isolation — pass-alone + fail-in-suite = leak, not regression. When mutating globals/env in a test, ALWAYS pair cleanup (`vi.unstubAllGlobals`/`vi.unstubAllEnvs`/`vi.useRealTimers`) in afterEach. See docs/qa/flaky-suite-2026-06-27.md for the hermeticity fix-plan.
- **Files affected:** apps/api/src/evals/llm-judge.test.ts (fixed), webhook-subscriptions.integration.test.ts + rbac.test.ts (pending).

### 2026-06-27 E2E: Broad role selectors collided with Cross-sell workflow commands

- **What went wrong:** A Cross-sell Playwright check used `getByRole('button', { name: 'Done' })`, which matched both the status filter `Done` and the action command `Mark done`, causing an ambiguous locator failure.
- **Root cause:** The test treated a common enterprise UI word as globally unique. The page intentionally has filters and row actions that share status language.
- **Prevention rule:** For dense CRM pages, scope Playwright locators to the owning region/group/table before clicking reused labels, and use `exact: true` when a label is expected to be the whole accessible name.
- **Files affected:** apps/web/e2e/cross-sell.spec.ts

### 2026-06-27 TESTING: Package-script Vitest file args launched a broad API suite

- **What went wrong:** Ran `corepack pnpm --filter @bidstack/api test -- <files...>` expecting a focused file list. The package script forwarded a literal `--` to Vitest and launched broader API suites, surfacing unrelated failures and burning time.
- **Root cause:** The package `test` script already wraps `vitest run`; passing `--` through pnpm does not behave like direct Vitest file arguments in this repo.
- **Prevention rule:** For exact Vitest files, use `corepack pnpm --filter <pkg> exec vitest run <file...>`. Keep `corepack pnpm` because the machine-global pnpm may violate the repo's `>=10 <11` engine.
- **Files affected:** test process only.

### 2026-06-27 API: Fastify preHandler guard did not complete/await on success

- **What went wrong:** A human-session guard for webhook writes was registered as a synchronous preHandler returning `void`; successful requests hung until test timeout. The cross-sell guard was also defined but initially not wired into write routes, then called inside handlers without `await`, letting API-key actors reach the database path.
- **Root cause:** Treated Fastify preHandlers as ordinary synchronous assertions and missed the handler defense-in-depth call after converting the helper to `async`.
- **Prevention rule:** Route preHandlers must be `async` or call `done` on every success path. If the same guard is called inside a handler, always `await` it. Regression tests must cover the forbidden actor and a successful human write.
- **Files affected:** apps/api/src/routes/webhook-subscriptions.ts, apps/api/src/routes/cross-sell.ts, apps/api/src/routes/cross-sell.integration.test.ts

### 2026-06-27 E2E: Playwright webServer used global pnpm despite corepack wrapper

- **What went wrong:** Ran the Settings E2E through `corepack pnpm`, but Playwright's managed `webServer.command` strings invoked bare `pnpm`. On Tony's machine global pnpm is 11.7.0 while the repo requires `>=10 <11`, so the browser test failed before the API/web servers booted.
- **Root cause:** The outer command used the correct package manager, but nested orchestration commands in `apps/web/playwright.config.ts` bypassed Corepack.
- **Prevention rule:** Any repo-owned script/config that launches package-manager commands must use `corepack pnpm` end-to-end. Do not assume an outer Corepack invocation propagates to child command strings.
- **Files affected:** apps/web/playwright.config.ts

### 2026-06-28 TESTING: Full-server DB route tests can exceed Vitest's default hook timeout

- **What went wrong:** A new API auth integration test created an isolated org and booted the full Fastify server. It passed alone, but when run beside another transformed test file the `beforeAll` hook crossed Vitest's default 10s timeout.
- **Root cause:** DB reachability, isolated-org seeding, auth stub setup, and `buildServer().ready()` are integration-test setup, not lightweight unit setup; the default hook budget is too tight under parallel transform/load.
- **Prevention rule:** For DB-backed route tests that create isolated orgs and boot `buildServer`, give `beforeAll`/`afterAll` explicit hook timeouts (for example 30s) and verify the file both alone and with its nearest focused companion.
- **Files affected:** apps/api/src/routes/ai-compute-auth.integration.test.ts

### 2026-06-28 PROCESS: Relay issue status overclaimed webhook-secret hardening

- **What went wrong:** The relay/issue text said webhook secrets already used strict decrypt/backfill tooling, but the checked-out source still used `decryptSecretOrPlaintext` in API/worker delivery and had no `scripts/encrypt-webhook-secrets.ts`.
- **Root cause:** Handoff status was treated as current enough before re-checking the runtime call sites and script inventory.
- **Prevention rule:** For security closure claims, verify source reality before implementation: search runtime call sites, operator scripts, package scripts, and release verifier wiring. Treat relay status as a pointer, not proof.
- **Files affected:** apps/api/src/routes/webhook-subscriptions.ts, apps/worker/src/queues/webhook-delivery.ts, scripts/encrypt-webhook-secrets.ts, scripts/write-webhook-secret-ciphertext-evidence.mjs
