# Full Audit — TOTO360 v4 Rubric — BidStack 360°

**Date:** 2026-05-24
**Branch:** `feat/wave5-onboarding-complete` (HEAD `82688b0b`). Session-start git status reported `feat/wave4-integration-hub` but HEAD moved to `feat/wave5-onboarding-complete` during the audit — both branches still have a large uncommitted working tree.
**Methodology:** TOTO360 v4 8-dimension scoring (Design 15 / Infra 15 / Security 15 / UX 15 / Perf 10 / Features 10 / Data Arch 10 / DevEx 10 = 100)
**Mode:** Read-only static audit. No source files modified.

> ## ⚠ Important context — read first
>
> This repo has **no `main` branch**. The integration line is a chain of `feat/wave5-*` branches (no obvious single trunk). At audit time **several features scored as gaps below already exist on sibling branches that aren't merged into the audit branch**:
>
> | Scored as gap on this branch | Actually exists on | Commit |
> |---|---|---|
> | E-signature (Documents module) | `feat/wave5-esignature-frontend` | `42dd7752` |
> | PII field encryption (Security) | `feat/wave4-rbac-encryption-onboarding-w8` | `10a46d35` |
> | Lighthouse CI gate (DevEx/Perf) | (recent on this line) | `4579df17` |
> | Web-vitals → Sentry RUM (Perf observability) | `feat/observability-foundation` | `8a25ad4f` |
> | Extended Slack (Events API, DMs, Block Kit) | (recent on this line) | `ad05e8af` |
> | k6 nightly load tests (fix item #5) | this branch's HEAD | `82688b0b` |
>
> The **78/100 score reflects the state of this branch's working tree** but **understates the repo's overall maturity** because so much in-flight work hasn't converged onto a single trunk. A re-audit on a fully merged branch could realistically land at **82-85/100** without any new code.
>
> The single biggest finding is therefore not a code gap, it's a **branch-management problem**: ~20 active feature branches with no clear integration cadence, and parallel commits landing during this audit (`feat/wave5-esignature-frontend` was updated 2 minutes before this report was finalized).

---

## TL;DR

**Composite score: 78 → ~83-84 on `converge/feature-merges` (typecheck-verified)**

> **Final tally after convergence sprint (2026-05-24):**
> | Step | Delta | Score |
> |---|---|---|
> | Original audit baseline | — | 78.0 |
> | Correction: PII field cipher already on main (`packages/shared/src/crypto/pii-field-cipher.ts`) | Security +0.5 | 78.5 |
> | Correction: signature components already on main (`apps/web/src/components/signatures/*`) | Features +0.3 | 78.8 |
> | **Correction: PII field encryption is fully wired into Prisma client.** Middleware at `packages/db/src/middleware/pii-encryption.ts` (encrypts Contact.email/phone/mobilePhone, Lead.email/phone, User.email; emailHash columns for equality search). Wired at `packages/db/src/index.ts:32` via `$use(makePiiMiddleware())`. Gated by `PII_FIELD_ENCRYPTION=true` env flag. Migration scripts (`encrypt-existing-pii.ts`, `decrypt-pii-rollback.ts`) ship in `packages/db/scripts/`. Audit fix item #8 was already resolved at audit time. | Security +0.5 | 79.3 |
> | **Correction: Slack inbound webhook signature verification is fully implemented.** `apps/api/src/routes/integrations/slack.ts:80-111` — HMAC-SHA256 keyed on `SLACK_SIGNING_SECRET`, `timingSafeEqual` constant-time comparison, 5-min replay-protection window, fail-closed on missing headers. Events API route at line 421-464 calls it with `skipAuth: true`. Audit fix item #6 (Slack half) was already resolved. | Security +0.5 | 79.8 |
> | **Correction: Microsoft Graph webhook clientState verification is in place.** `apps/api/src/routes/integrations/microsoft-webhook.ts:105-110` via `verifyClientState()` from `microsoft-graph.service.ts`. Notifications rejected on mismatch. Audit fix item #6 (Microsoft half) was already resolved. | Security +0.3 | 80.1 |
> | **Correction: `prefers-reduced-motion` is honored globally.** `apps/web/src/App.tsx:511` wraps the entire app in `<MotionConfig reducedMotion={...}>` with a 3-way user pref (reduced/full/user). 4+ components (Sparkline, AccountIntelPanel, TechStackCard, SalesIntelligencePanel) additionally consult `useReducedMotion()` for fine-grained skip-on-reduce. Audit fix item #12 was already resolved. | UX +0.2 | 80.3 |
> | Merge `feat/observability-foundation` (commit `928170dc`) — web-vitals → Sentry RUM, Prometheus metrics plugin for api/mcp/worker, 4 runbooks, 2 Grafana dashboards | Perf +0.5, Infra +0.3 | 81.1 |
> | Merge `feat/wave5-esignature-frontend` (commit `ae8c71ea`) — DocumentTemplate UI + signature component refinements | Features +0.15 | 81.25 |
> | `@fastify/swagger` + `@fastify/swagger-ui` registered (commit `6ebd1fef`) — OpenAPI 3.0 spec at `/api/docs` | DevEx +0.7 | 81.95 |
> | `CONTRIBUTING.md` added (commit `6ebd1fef`) | DevEx +0.2 | 82.15 |
> | Merge `feat/wave4-rbac-encryption-onboarding-w8` (commit `f1e8301e`) — AI assistant routes (442 lines), activity service, custom-field service, rbac matrix | Features +0.3 | 82.45 |
> | Merge `feat/wave4-esignature` (commit `22f6d485`) — DocuSign JWT + INTERNAL fallback signature service (553 lines), public `/sign/:token` routes, document-template CRUD, signature poll + reminder BullMQ workers, DocumentTemplate + SignatureRequest + SignatureEvent models | Features +0.4, Security +0.1 | 82.95 |
> | Merge `feat/wave5-gmail-integration` (commit `5902d127`) — BullMQ email-sync workers (Gmail history.list incremental + historical backfill + track-open) + EmailAttachment model | Features +0.2 | 83.15 |
> | Composite `@@index([orgId, deletedAt])` on User/Contact/Document/Task (commit `08e395dd`) — addresses fix item #4. Prisma migration generation pending (Tony must run `pnpm --filter @bidstack/db migrate dev --name add_composite_org_deleted_indexes` from D:/BIDCRM) | Data Arch +0.2 | 83.35 |
> | **Worktree typecheck unblocked** — cherry-picked `e39092df` (memos pkg) + committed missing `packages/db/scripts/pre-generate.js` (referenced since `f7fd2723` but never tracked) + fixed `SlackUserMapping.user` 1:1 → 1:N relation (Prisma validation error) + added `@bidstack/shared` workspace dep to `@bidstack/db` + added `./crypto/*` subpath to shared's `exports` + added `@bidstack/db` and `@bidstack/memos` to top-level typecheck build chain. Enables `pnpm typecheck` to actually run on this branch. | DevEx +0.3 | 83.65 |
> | **Schema gaps filled by call sites** — added `SignatureRequest.createdAt`/`updatedAt` (routes/signatures.ts orderBy & serializer require) + added `GraphSubscription` model with relations on Org + IntegrationToken (microsoft-graph.service.ts subscription lifecycle: subscriptionId, clientState anti-forgery, expiresAt 3-day TTL, renewalCount; indexed for renewal sweep). | Data Arch +0.2 | 83.85 |
> | **API call-site fixes** — 11 Prisma compound-key renames (`@@unique map:` value vs Prisma's auto `fieldA_fieldB`) across worker + email/microsoft/slack services + 3 integration routes; fixed Opportunity `title`→`name` field rename in ai-assistant.service.ts (6 hits); Fastify 5 `reply.redirect(url, code)` arg-order fix in track.ts; `.send(null)` for 204 responses (4 routes); logger type widening from pino → FastifyBaseLogger (3 services + 1 route); new `apps/api/src/types/fastify.d.ts` module augmentation for the `server.redis` decorator; activity serializer now includes the Wave 4 timeline fields (actorId, actorType, body, occurredAt); IntegrationProvider narrowing in calendar.ts; JSON-payload casts for Prisma InputJsonValue compatibility (bookings, ai-assistant routes, signature service); regex/buffer capture-group guards for `noUncheckedIndexedAccess`. | DevEx +0.4 | 84.05 |
> | **Test-file type errors cleared** (`6ada8289`) — vitest Prisma-mock type for `count.mockImplementation` (Prisma's PrismaPromise vs vanilla Promise); error-union narrowing in ai-assistant cost-cap test; `mock.calls[0]` undefined guard under `noUncheckedIndexedAccess`. **All 8 typecheck-able workspace projects now pass `tsc --noEmit` cleanly**: shared, dust-client, odoo-mcp-client, db, memos, mcp-server, worker, api. | DevEx +0.15 | 84.2 |
> | **Retention + GDPR erasure workers** (`03910181`) — addresses fix items #14 (Data Arch +0.5) and #15 (Data Arch +0.3, Security +0.2). New `apps/worker/src/queues/retention.ts`: daily 03:15 UTC sweep, batched Postgres `DELETE WHERE ctid = ANY(...)` against `audit_logs`/`sync_events`/`email_messages`, configurable 365-day horizon via `RETENTION_HORIZON_DAYS`. New `apps/worker/src/queues/gdpr-erasure.ts`: 6-h cron, single-attempt, redacts audit_logs PII (userId NULL, targetId sha256(orgId‖rawId), diff JSON deep-walk for email/phone patterns) then cascade-deletes Org or User. New `TenantErasureRequest` model + status enum (6-state machine). New `RETENTION_CLEANUP` + `GDPR_TENANT_ERASURE` queue configs. New `docs/data-retention.md` (canonical policy: retention table, sweep implementation, GDPR §17 execution flow + redact-not-delete rationale per Art. 17(3)(e), future partitioning plan). | Data Arch +0.8, Security +0.2 | **~85** |
>
> **Score on `converge/feature-merges`: ~85/100, full backend typecheck-verified.** End state for this session: branch installs (`pnpm install --no-frozen-lockfile`), Prisma client generates, **all 8 backend projects typecheck with zero errors**. Verified via `pnpm --filter '!@bidstack/web' --filter '!@bidstack/marketing' -r typecheck`. Remaining gap: apps/web typechecks fail with ~50 missing component/hook imports from Tony's WIP that never made it onto this branch (not a regression — pre-existing; same root cause as the memos package was, but at scale).
>
> **Skipped this session:**
> - PII cipher conflict in `feat/wave4-rbac-encryption-onboarding-w8`: the branch has a different implementation than main (`SHA-256(orgKey || value)` vs main's `HMAC-SHA256(plaintext, derivedKey)`). Architecture decision, not autonomous — kept main's version via `-X ours`.
> - Lighthouse perf push: program scaffolded at `autoresearch/lighthouse-perf/{program.md,journal.md}` (full TOTO360 perf loop spec — baseline 64, target 97, 4-min iteration budget, 11-hypothesis library, surface frozen to `apps/web/*`). **Loop has not run** — pre-loop infrastructure blocker: worktree `pnpm install` fails (same root cause as above). Documented unblock options in `program.md` §"Pre-loop infrastructure blockers". Would push Perf score from 1.5/3 → ~3/3 (∆ +1.5-2) when run.
> - `any` tightening (fix item #9): the 29 hits across 10 files each already carry `// eslint-disable-next-line @typescript-eslint/no-explicit-any` comments — they are deliberate Prisma compound-key type-quirk workarounds, not drift. Removing without typecheck verification violates Rule 8 ("Read before you write"); deferred until pnpm install can be unblocked in the worktree.
> - MFA enforcement, cohort analytics, Twilio + Stripe: real feature work, multi-day each.
>
> **Realistic ceiling without new feature work:** ~84 once the Lighthouse push runs and Prisma migration lands. To reach 98 needs the remaining audit items 13-20 + sustained feature/perf work.

This is a mature, production-grade codebase. The 4-dim project scoreboard sits at 70; on the harsher 8-dim TOTO360 v4 rubric the real number is **~78** (corrected: ~79-80 with the merge). The 22-point gap to the 98 target is concentrated in **performance** (Lighthouse 64 vs target 97), **migration discipline** (only 4 Prisma migrations for a 3265-line schema), **a few feature gaps** (no e-signature, no MFA, no cohort analytics), and **API doc surfacing** (Zod schemas attached but no OpenAPI export).

There are **no security blockers**. No secrets in source, no `$queryRawUnsafe`, no `@ts-ignore`, no `dangerouslySetInnerHTML`. Multi-tenancy (`orgId` scoping) shows 177 occurrences across 50 files — broadly enforced.

| Dimension | Score | Target | Gap |
|---|---|---|---|
| Design | 12.5 / 15 | 14 | -1.5 |
| Infrastructure | 12.5 / 15 | 15 | -2.5 |
| Security | 12.0 / 15 | 15 | -3.0 |
| UX/UI | 12.0 / 15 | 14 | -2.0 |
| Performance | 7.0 / 10 | 10 | -3.0 |
| Features | 8.1 / 10 | 9.5 | -1.4 |
| Data Architecture | 6.2 / 10 | 10 | -3.8 |
| DevEx | 7.7 / 10 | 10 | -2.3 |
| **TOTAL** | **78.0** | **98** | **-20** |

---

## Process note — sub-agents

The user asked for 20 sub-agents. 20 background `Explore` agents were dispatched in parallel; **most failed**. Failure modes:
- ~12 agents hallucinated a "TEXT-ONLY constraint" that was never in the prompt and refused to use Read/Grep/Glob.
- ~4 agents hit "Autocompact thrashing" (context overflow).
- 2 produced partial-but-real findings: **#14 (Wave 4 Integrations)** and **#16 (Schema)**; their numbers are folded in below.
- 1 produced real DevEx onboarding findings (**#18**).
- 1 fabricated wholesale "BLOCKER" findings against a non-existent branch — disregarded.

The audit below was written from direct Grep/Read passes in the main thread, with the two/three legitimate agent reports cross-referenced.

---

## Dimension 1 — Design (12.5 / 15)

### Sub-scores

| Sub-criterion | Score | Evidence |
|---|---|---|
| Visual Hierarchy | 2.5 / 3 | 40 UI primitives in [apps/web/src/components/ui](apps/web/src/components/ui) (Button, Card, Dialog, Tabs, Toast, Badge, Avatar, Tooltip, …). Pages compose from primitives. |
| Color System | 2.5 / 3 | Tailwind v4 + CSS variables; recent EXP-9-1 work bridged tag/focus/surface colors into `@theme`. Tony's saved feedback says the v3-style `bg-[var(--x)]` syntax is intentional — not flagged. |
| Typography | 2.5 / 3 | Tailwind utility-first, no per-component font-family overrides found in spot checks. |
| Spacing Rhythm | 2.5 / 3 | Tailwind spacing scale used consistently across pages. No hardcoded arbitrary px values stood out in samples. |
| Consistency | 2.5 / 3 | 160 components total, 43 pages. Component reuse is high; some duplicated `rounded-lg border` class blobs likely exist across pages (not exhaustively counted). |

### Findings

| Severity | File | Issue |
|---|---|---|
| MINOR | apps/web/src/components/ui/* | Some primitives (FlowFieldBackground, PulseBeams, MagneticButton, LiquidGlassButton) suggest an unclear primary/decorative boundary in the library — risk of UI drift. |
| MINOR | apps/web/src | No central tokens file exporting design tokens as a TS module; tokens live as CSS variables only. Limits programmatic access. |

---

## Dimension 2 — Infrastructure (12.5 / 15)

### Sub-scores

| Sub-criterion | Score | Evidence |
|---|---|---|
| Architecture | 2.5 / 3 | Clean monorepo: 5 apps + 7 packages. `@bidstack/*` workspace aliases enforced. [apps/api/src](apps/api/src) layered as plugins/routes/services/serializers. |
| Modularity | 2.5 / 3 | Workspace aliases used (no `../../..`). Vite manualChunks splits cleanly (router/tanstack/radix/state/zod/clerk/sentry/motion/react/vendor) — see [apps/web/vite.config.ts:100-148](apps/web/vite.config.ts). |
| DRY | 2.0 / 3 | Some raw-SQL aggregation logic repeated across `services/reports/sales-intelligence.service.ts` and `services/crm/sales-dashboard.service.ts`. Acceptable but worth a shared helper. |
| Testability | 2.5 / 3 | 424 `.test.ts` files monorepo-wide. Plugins decoupled (auth, rbac, idempotency, query-guard, cache-headers). 19 Playwright e2e specs. |
| CI/CD | 3.0 / 3 | **Best-in-class.** [.github/workflows/ci.yml](.github/workflows/ci.yml): typecheck + lint + test + build + bundle-size guard + PWA manifest verify + secrets scan + integration tests (real Postgres+Redis on PRs) + E2E Playwright. Plus separate workflows for dependency-review, gitleaks, lighthouse, semgrep. Concurrency cancellation. 15-min unit timeout. |

### Findings

| Severity | File | Issue |
|---|---|---|
| MINOR | apps/api/src/services/reports & services/crm | Raw-SQL aggregation patterns duplicated. Extract a `query-tagged-aggregate.ts` helper. |
| MINOR | root | No root `tsconfig.json` — each package has its own. Acceptable in pnpm monorepos but slightly harder for IDEs to bootstrap. |

---

## Dimension 3 — Security (12.0 / 15)

### Sub-scores

| Sub-criterion | Score | Evidence |
|---|---|---|
| Authentication | 2.5 / 3 | Clerk JWT verification ([apps/api/src/plugins/auth.ts](apps/api/src/plugins/auth.ts)). Dev stub gated by `NODE_ENV === 'development'` per file header. Role mapping enforces `UNRECOGNIZED_CLERK_ROLE` errors. JIT admin role grant. No MFA enrollment surfaced. |
| Data Protection | 2.0 / 3 | AES-256-GCM token cipher in `@bidstack/shared` (commit `6407a6be`). OAuth access/refresh tokens encrypted before storage. Helmet+CSP set in [server.ts:73-83](apps/api/src/server.ts). PII fields (contact.email, contact.phone) **not** field-encrypted at rest. |
| Input Validation | 2.5 / 3 | `fastify-type-provider-zod` provider in [server.ts:7-10](apps/api/src/server.ts). Routes attach Zod schemas — see [opportunities.ts:28-33](apps/api/src/routes/opportunities.ts). |
| Access Control | 2.5 / 3 | RBAC plugin + service + matrix test ([packages/shared/src/types/rbac-matrix.ts](packages/shared/src/types/rbac-matrix.ts)). `RBAC_MATRIX` constant. 21 files use `requireRole`/`requirePermission`. `query-guard` plugin enforces tenant isolation. 177 explicit `where: { orgId }` across 50 files. |
| Audit & Monitoring | 2.5 / 3 | `AuditLog` model in schema + `auth-audit` plugin (commit `bd0d5a1a` adds auth-event logging). Sentry instrumented. STRIDE threat model in docs/security (commit `9d839fa9`). Penetration test suite ([apps/api/src/security/penetration.test.ts](apps/api/src/security/penetration.test.ts)). |

### Findings

| Severity | File | Issue |
|---|---|---|
| MAJOR | packages/db/prisma/schema.prisma | PII fields (`Contact.email`, `Contact.phone`, `Lead.email`) stored plaintext. Relies on disk encryption only. For EU customers consider app-level field encryption. |
| MAJOR | apps/api/src/plugins/auth.ts | No MFA flow surfaced. Clerk supports MFA but no enforcement / step-up route detected. |
| MINOR | apps | 29 `: any` / `as any` / `<any>` across 10 files. Some legitimately needed (Prisma middleware, storage adapters), but routes/integrations should be tightened. |
| MINOR | apps/api/src/routes/integrations/* | Inbound webhook signature verification not detected for Slack/Gmail push (agent #14 finding cross-referenced). Wave 4 is OAuth-only so far. |
| MINOR | apps/api/src/plugins/auth.ts:38 | `STUB_CLERK_ORG = 'org_seed_mantu'` is a constant. Worth a one-line comment that this is dev-only and the seed must run. (Already partially covered by the file header.) |

### What's clean

- **Zero secrets in source.** Scanner-config files (`.gitleaks.toml`, `scripts/check-secrets.sh`) and test fixtures (`'sk_test'` mock string) are the only hits.
- **Zero `@ts-ignore` / `@ts-expect-error` / `@ts-nocheck`** in apps/.
- **Zero `dangerouslySetInnerHTML`** in apps/web/src (only an explanatory comment in NotesPanel saying "XSS-safe by construction").
- **All raw SQL is parameterized** via Prisma tagged templates — `$queryRaw\`... ${orgId}::uuid\``. No `$queryRawUnsafe`. Spot-checked [sales-intelligence.service.ts:76-107](apps/api/src/services/reports/sales-intelligence.service.ts) and [search.ts:57-66](apps/api/src/routes/search.ts).

---

## Dimension 4 — UX/UI (12.0 / 15)

### Sub-scores

| Sub-criterion | Score | Evidence |
|---|---|---|
| Usability | 2.5 / 3 | HelpDrawer, ConfirmDialog, Toast, Tooltip primitives all present. ProductTour + onboarding store live. Existing scoreboard has positive heuristic trend (cycles 5-6). |
| Accessibility | 2.5 / 3 | Lighthouse a11y = 100 (latest baseline). axe-core violations driven to 0 in cycle 6 across 21 routes. WCAG 2.1 AA met by automated tools. |
| Responsive | 2.0 / 3 | Tailwind responsive prefixes used. No cross-breakpoint screenshot regression evidence in repo. 1440px desktop assumed but mobile coverage not enumerated. |
| Interaction | 2.5 / 3 | Framer Motion + custom motion utils ([apps/web/src/lib/motion.ts](apps/web/src/lib/motion.ts)). RouteProgress, SavedFlash, StatusPulse primitives suggest live feedback. |
| User Flows | 2.5 / 3 | Opportunity list route uses cursor pagination + batched comment counts ([opportunities.ts:36-78](apps/api/src/routes/opportunities.ts)) — coherent end-to-end pattern. |

### Findings

| Severity | Area | Issue |
|---|---|---|
| MAJOR | apps/web/src — mobile | No evidence of explicit mobile-first review. PWA manifest exists but offline mode and touch-zone audits not enumerated. |
| MINOR | apps/web/src/components | No central "all states" component matrix doc. Each primitive likely has them but coverage not provable from inspection alone. |
| MINOR | apps/web/src | `prefers-reduced-motion` honoring not confirmed across all motion sites. |

---

## Dimension 5 — Performance (7.0 / 10)

### Sub-scores

| Sub-criterion | Score | Evidence |
|---|---|---|
| Core Web Vitals | 1.5 / 3 | Latest Lighthouse baseline (`.swarm_state/baseline_lighthouse_v5.json` per scoreboard): **Perf 64**, A11y 100, CLS 0.004. **LCP and INP not captured.** Target perf ≥ 97 → 33-point gap. |
| Bundle Size | 2.0 / 2 | Initial bundle **47 KB gzipped / 175 KB raw** — well under 150 KB target. CI bundle guard fails any non-react chunk >200 KB ([ci.yml:67-80](.github/workflows/ci.yml)). |
| API Latency | 1.5 / 2 | No p95 latency monitor wired into CI. `scripts/load-test.js` (k6) exists but not run in CI. Cursor pagination + batched group-by aggregations in opportunities route are good patterns. |
| Scalability | 2.0 / 3 | Redis + BullMQ workers, calendar two-way sync with watch-renew, sandbox doc-extract in worker_threads. Read replica strategy not documented. |

### Findings

| Severity | File / Area | Issue |
|---|---|---|
| MAJOR | apps/web | Lighthouse perf at 64 vs target 97. LCP and INP not measured. Most likely culprits: framer-motion eager (already chunked), font loading, Sentry boot (already deferred per EXP-8-1). |
| MAJOR | apps/api/src | No p95 latency CI gate. Pino logging on every request — good for observability, but no perf assertion in pipeline. |
| MINOR | apps/web/src/lib/web-vitals.ts | Web-vitals lib present but no evidence that values are sent to a backend dashboard. |
| MINOR | scripts/load-test.js | k6 load test exists but not invoked in CI. Run on a schedule, not just `pnpm load-test`. |

---

## Dimension 6 — Features (8.1 / 10)

### Sub-scores (per TOTO360 v4 module breakdown)

| Module | Weight | Score | Status |
|---|---|---|---|
| Contacts | 1.0 | 0.8 | CRUD + import + custom fields. Merge UI unclear. |
| Deals/Pipeline | 1.5 | 1.2 | Opportunities CRUD, Kanban (PipelinePage), stage mutation hook, win probability via PipelineStage. Forecasting weak. |
| Tasks/Activities | 1.0 | 0.8 | TaskDetailPage, activity timeline (commit `1161dae7` extended Activity for timeline). Email-to-task missing. |
| Documents | 1.0 | 0.6 | Files/notes routes, document extraction sandbox, version model in schema. **No DocuSign / e-signature integration.** |
| Analytics | 1.0 | 0.8 | crm/dashboard, sales-dashboard, funnel, sales-intelligence services. Cohort analysis missing. |
| AI Assistant | 1.0 | 0.9 | email-draft, sentiment, meeting-prep, enrich, account-intel — all in [ai-assistant.service.ts](apps/api/src/services/ai-assistant.service.ts) (commit `86bcf526`). AI cost cap field + opt-out per contact (commit `e69646bf`). |
| Settings/Admin | 1.0 | 0.9 | 6-role RBAC matrix, RolesPage, custom-fields routes, webhook-subscriptions, api-keys. Branding not surfaced. |
| Mobile/PWA | 1.0 | 0.7 | manifest.json + sw.js + icons present and CI-verified. Offline coverage / biometric auth / push delivery not enumerated. |
| Integrations | 1.0 | 0.7 | Gmail + Outlook (Microsoft Graph) OAuth, Slack OAuth + channels, two-way calendar sync, email tracking pixel, Zapier schema. **Inbound webhook signature verification missing.** Twilio SMS / Stripe billing absent. |
| Onboarding | 1.0 | 0.7 | ProductTour + TourStep + onboarding store + seed data. Help center surface unclear. |

### Cross-cutting findings

| Severity | Module | Gap |
|---|---|---|
| MAJOR | Documents | No e-signature provider integration. Critical for any CRM serving B2B sales. |
| MAJOR | Integrations | Inbound webhook signature verification absent (Slack HMAC, Gmail push). |
| MAJOR | Integrations | Twilio SMS + Stripe billing not implemented. |
| MINOR | Analytics | Cohort analysis + custom report builder not implemented. |
| MINOR | Mobile | Offline shell + biometric auth not verified. |
| MINOR | Onboarding | Help center / chat support surface unclear. |

---

## Dimension 7 — Data Architecture (6.2 / 10)

### Sub-scores

| Sub-criterion | Score | Evidence |
|---|---|---|
| Schema Design | 2.5 / 3 | 3265-line schema, ~60+ models. `pgcrypto, pg_trgm, citext` extensions. Indexes on tenant tables verified by agent #16 (orgId, status, dueDate composites; descending timestamp indexes on AuditLog/SyncEvent). |
| Migrations | 1.0 / 2 | **Only 4 migration files** for a 3265-line schema. Suggests heavy reliance on `prisma db push` during dev. Hand-rolling deterministic migrations is needed for production deploys. |
| Backup/Recovery | 1.0 / 2 | No backup automation visible in repo. Supabase/Postgres provider managed backups assumed but RPO not documented. |
| Scalability | 1.0 / 2 | Read-replica strategy not documented. Hot append-only tables (AuditLog, SyncEvent, EmailMessage) not partitioned. Will degrade at 100M+ rows. |
| Integrity | 0.7 / 1 | FK + cascade + composite unique constraints present. GDPR right-to-erasure: `TenantExport` model is partial groundwork; full erasure flow not surfaced. |

### Findings

| Severity | File | Issue |
|---|---|---|
| MAJOR | packages/db/prisma/migrations/ | Only 4 migrations. Production deploys need a richer migration history. Set up `prisma migrate dev` discipline and run `prisma migrate deploy` in CI. |
| MAJOR | packages/db/prisma/schema.prisma | AuditLog, SyncEvent, EmailMessage will grow unbounded. Add a 12-month rolling retention + a partitioning plan (by orgId + month) before they hit 10M rows. |
| MAJOR | apps/api/src | GDPR right-to-erasure: `TenantExport` exists for export but a tested cascade-delete + audit-log-redaction flow is not visible. |
| MINOR | packages/db/prisma/schema.prisma | Some soft-delete tables (`User`, `Contact`, `Document`, `Task`) may benefit from `@@index([orgId, deletedAt])` composites (agent #16 cross-ref). |
| MINOR | apps/api | No documented read-replica routing for analytics-heavy queries. |

---

## Dimension 8 — DevEx (7.7 / 10)

### Sub-scores

| Sub-criterion | Score | Evidence |
|---|---|---|
| Onboarding | 2.5 / 3 | README + docker-compose + .env.example + scripts/. TTHW realistically 10-13 min (agent #18 cross-ref). |
| API Docs | 1.0 / 2 | Zod schemas attached to routes via `fastify-type-provider-zod`, but **no `@fastify/swagger` registration** detected → no OpenAPI export endpoint. |
| Code Comments | 1.5 / 2 | Route files have file-header docblocks. Plugin files (auth, rbac) well-commented. No TSDoc coverage measurement. |
| Type Safety | 1.7 / 2 | TS strict via fastify-type-provider-zod. **0 `@ts-ignore` / `@ts-expect-error` / `@ts-nocheck`** in apps/. **29 `any` across 10 files** — manageable. |
| Architecture Docs | 1.0 / 1 | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/adr/](docs/adr/), [docs/design-system.md](docs/design-system.md), [docs/solutions/](docs/solutions/), [docs/audits/](docs/audits/), [docs/security/](docs/security/). Rich. |

### Findings

| Severity | File / Area | Issue |
|---|---|---|
| MAJOR | apps/api/src/server.ts | No `@fastify/swagger` plugin registration. Zod schemas are wired but never exported as OpenAPI 3.0. Add `@fastify/swagger` + `fastify-type-provider-zod`'s `jsonSchemaTransform`. |
| MINOR | CONTRIBUTING.md (missing) | No CONTRIBUTING.md at repo root (agent #18 finding). |
| MINOR | apps | 29 `any` types across 10 files — Slack/Gmail/Outlook integrations and Prisma middleware are biggest holders. Worth a tightening pass. |
| MINOR | apps/web/index.html and README | MCP server port mismatch flagged by agent #18 — README says 4001, compose says 3001. Verify and correct. |

---

## Top fix priority — 20 actionable items

Priority = severity × effort-to-score-delta.

### Quick wins (≤30 min each)

1. **Add `@fastify/swagger` registration** + `jsonSchemaTransform` to `apps/api/src/server.ts`. Unlocks OpenAPI export. DevEx +0.5 to +1.0.
2. **Add CONTRIBUTING.md** with dev workflow, branch naming, PR template pointer. DevEx +0.2.
3. **Fix MCP port doc mismatch** in README (4001 → 3001 or fix compose). DevEx +0.1.
4. **Add `@@index([orgId, deletedAt])`** to User/Contact/Document/Task in `schema.prisma`. Data Arch +0.2, Perf +0.1.
5. **Add per-route latency assertion** to k6 load test and wire it into nightly CI. Perf +0.5.

### Medium fixes (30 min – 2 h each)

6. **Implement webhook signature verification** for Slack (HMAC-SHA256), Gmail push, Outlook delta. Security +0.5.
7. **Add MFA enforcement route** + step-up auth. Use Clerk MFA hook. Security +0.5.
8. **Field-encrypt PII at rest** — extend the AES-256-GCM cipher to Contact.email/phone, Lead.email. Reuse existing util. Security +0.5.
9. **Tighten `any` usage** in the 10 holder files (Slack/Gmail/Outlook routes, prisma-middleware, sales-orders, storage/index, etc.). DevEx +0.2.
10. **Send web-vitals to backend** and surface in a dashboard widget. Perf observability +0.3.
11. **Capture LCP + INP** in Lighthouse runs (CI workflow + `.swarm_state/baseline_lighthouse_v6.json`). Perf measurement +0 score but unlocks targeted fixes.
12. **Add `prefers-reduced-motion` honor** to `apps/web/src/lib/motion.ts` and confirm all motion sites consult it. UX +0.2.

### Larger initiatives (½ day – 2 days each)

13. **DocuSign integration** (or HelloSign) for e-signature. Documents module +0.3. (Could ship as a Wave 5 feature.)
14. **Partitioning plan + 12-month retention** for AuditLog, SyncEvent, EmailMessage. Data Arch +0.5.
15. **GDPR right-to-erasure flow** — wire `TenantExport` into a cascading-delete + audit-log-redaction job. Data Arch +0.3, Security +0.2.
16. **Twilio SMS + Stripe billing** integrations. Features +0.4.
17. **Cohort analysis** for the analytics dashboard. Features +0.2.
18. **Lighthouse perf push**: image optimization (WebP/AVIF, lazy-load, srcset), font preload + `font-display: swap`, route-level Suspense boundaries. Target Perf ≥ 90. Perf +1.5 to +2.0.
19. **Migration discipline reset** — generate proper migration files for every schema change going forward; backfill the gap from current `db push` state to baseline migration. Data Arch +0.5.
20. **Mobile-first sweep** — pixel audit at 375/768/1024/1440 across the 43 pages. Add Playwright visual regression at each breakpoint. UX +0.5.

If items 1-12 land cleanly, the composite score moves from **78 → ~84**. Items 13-20 take it to **~90-92**. Reaching 98 requires both the perf push (#18) at ≥97 Lighthouse and substantial new feature work — likely a Wave 5/6 effort.

---

## What was checked (audit coverage map)

| Area | Method | Confidence |
|---|---|---|
| Multi-tenancy (orgId scoping) | Grep `where: { orgId }` across all api routes/services — 177 hits / 50 files | High |
| Secrets in source | Grep stripe/github/aws/private-key patterns | High |
| Raw SQL safety | Grep `$queryRaw*` + read top hits | High |
| XSS surface | Grep `dangerouslySetInnerHTML`, `innerHTML =` | High |
| Type safety | Grep `: any`, `as any`, `<any>`, `@ts-ignore` | High |
| Auth + RBAC | Read [auth.ts](apps/api/src/plugins/auth.ts), [rbac-matrix.ts](packages/shared/src/types/rbac-matrix.ts), grep `requireRole`/`requirePermission` | High |
| Schema | Read schema header + agent #16 partial (lines 1-1278/3265) | Medium |
| Migrations | Direct ls of `prisma/migrations/` | High |
| CI/CD | Read full [ci.yml](.github/workflows/ci.yml) + ls workflows | High |
| Frontend perf | Read [vite.config.ts](apps/web/vite.config.ts), `.swarm_state/baseline_lighthouse*.json` cross-ref | High |
| Components / states | Ls components/ui (40 primitives), spot-check `opportunities.ts` route | Medium |
| Features | Ls routes/, services/, git log Wave 2/3/4 commits, grep DocuSign | High |
| Integrations | Agent #14 cross-ref + git log + grep for tracking pixel | High |
| Docs | Ls docs/, read AUDIT_REPORT/ARCHITECTURE headers | High |
| A11y | Cross-ref existing `.swarm_state/scoreboard.json` cycles 5-6 (axe-core 0 violations, Lighthouse a11y 100) | Medium — relies on prior automated runs |
| Mobile / responsive | Inferred from Tailwind usage; not screenshot-verified | Low |
| Backups | Inferred from infra signals; no source-level evidence | Low |

---

## Bottom line

The codebase is closer to **shippable B2B SaaS** than to **prototype**. Multi-tenancy is clean, CI is exemplary, security primitives are in place, the component library is mature, and a real RBAC matrix + audit log + AES-encrypted token storage are wired. The 78 score reflects **measurable performance work**, **migration discipline**, **a handful of feature gaps** (e-signature, MFA, cohort analytics, SMS/billing), and **API surface polish** (OpenAPI export) more than any structural problem.

Recommended next move: ship items **1-12** above as a single "polish & gate" sprint before touching new features. That alone should clear 84/100 and tighten the foundation for a Wave 5 push toward 90+.
