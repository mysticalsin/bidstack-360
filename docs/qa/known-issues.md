# BidStack 360° — Known Issues
**Date:** 2026-05-24
**Source:** Wave 6 QA Pass (W6-C) + carryovers from Wave 5 final report + prior audit files
**Scope:** All issues discovered before merge of Wave 3-5 branches

---

## P0 — Blocks Ship (must fix before any merge or first deploy)

### P0-1 — Phantom dependency `@bidstack/memos` in API routes
**Files:** `apps/api/src/routes/bid-scores.ts`, `apps/api/src/routes/proposals.ts`
**Symptom:** `import { MemOSService } from '@bidstack/memos'` — package does not exist in `packages/`.
**Impact:** TypeScript compile error on install. All Wave 4/5 branches will fail `pnpm typecheck` and `pnpm build`. Server will not start.
**Root cause:** `@bidstack/memos` was referenced in code but the package was never created. The `MemosTrace`/`MemosPolicy`/`MemosWorldModel` Prisma models exist in `running_best` schema, suggesting the intent was to wrap them in a service package that was never implemented.
**Resolution:** Replace `MemOSService` usage with direct Prisma calls or create a minimal `packages/memos/` stub. Option A (direct Prisma) preferred.
**Affects:** feat/wave4-ai-assistant, feat/wave4-analytics-dashboards, feat/wave4-design-system, feat/wave4-esignature, feat/wave4-pwa-completion, feat/wave4-rbac-encryption-onboarding, feat/wave4-timeline-custom-fields, all Wave 5 branches.

---

### P0-2 — `DocumentTemplate`/`SignatureRequest`/`SignatureEvent` Prisma models missing from `feat/wave5-esignature-frontend`
**Files affected:** `packages/db/prisma/schema.prisma` on `feat/wave5-esignature-frontend`
**Symptom:** Frontend ships `SignaturesPage`, `SignatureRequestDetailPage`, `useSignatureRequests`, `SendForSignatureModal`, `DocumentTemplatesPage`, `DocumentTemplateEditorPage` — all require `SignatureRequest` and `DocumentTemplate` Prisma models and API routes that are absent from this branch.
**Impact:** After merge, the entire e-signature UI will error on every API call (routes don't exist). `pnpm db:generate` will not see the e-sig models.
**Root cause:** `wave5-esignature-frontend` was built on the base stack WITHOUT first merging `feat/wave4-esignature`. The schema and API routes from W4-7 were not forward-ported.
**Resolution:** `wave5-esignature-frontend` must be merged AFTER `wave4-esignature`. Do not open a standalone `wave5-esignature-frontend` PR — it depends on w4-esignature as a prerequisite.

---

### P0-3 — `AnalyticsDashboard`/`AnalyticsReport` models only exist on `feat/wave4-analytics-dashboards`
**Files affected:** `packages/db/prisma/schema.prisma`
**Symptom:** `feat/wave5-analytics-frontend` ships `useAnalyticsReports`, `WidgetRenderer`, `FilterBuilder`, `ReportsPage`, charts library — but the backend analytics endpoints (`/api/v1/analytics/*`) are only registered in `feat/wave4-analytics-dashboards`. The 5 Analytics Prisma models are also missing from all Wave 5 branches.
**Impact:** After merging analytics frontend without analytics backend, all analytics API calls 404. `pnpm db:migrate` cannot create the analytics tables.
**Resolution:** Strict merge order: `feat/wave4-analytics-dashboards` BEFORE `feat/wave5-analytics-frontend`. Verify `analyticsRoutes` is re-registered in server.ts after merge.

---

### P0-4 — No migration files for ~69 new Prisma models
**Files affected:** `packages/db/prisma/migrations/`
**Symptom:** All Wave 3/4/5 branches have exactly 10 migration files (same as `running_best`), but their `schema.prisma` adds 24-36+ new models per branch. None of the new models (CalendarEvent, BookingPage, Notification, DocumentTemplate, SignatureRequest, EmailMessage, SlackWorkspace, AnalyticsDashboard, AiAssistantSession, etc.) have corresponding migration files.
**Impact:** `pnpm db:migrate dev` after merge will attempt to generate migrations for all ~69 models at once. This may produce a single giant migration that is difficult to debug if it fails. It also means no migration history for individual features.
**Resolution:** After each branch merge, run `pnpm db:migrate dev --name <feature>` to generate a granular migration. Do not let migrations accumulate across multiple branches before running. See merge order in `docs/audits/2026-05-24-wave5-final-report.md §5`.

---

### P0-5 — `feat/wave5-onboarding-complete` is a multi-stream conglomerate (worktree leak)
**Symptom:** This branch contains W5-1 (Azure SSO), W5-3 (Outlook), W5-4 (Slack/Zapier), W5-6 (Analytics frontend), W5-9 (Onboarding), and W5-10 (Final polish) — 6 unrelated feature streams in one branch.
**Impact:** If this branch is opened as a single PR, it will be unreviable (27+ commits across 6 concerns). Merging it directly will bypass per-feature typecheck gates and make rollback impossible.
**Resolution:** Cherry-pick each stream to its own branch BEFORE opening any PR. Map per Wave 5 final report §6.1.

---

## P1 — Must Fix in Week 1 (blocks first paying customer)

### P1-1 — Microsoft Mail OAuth routes double-registered
**Files:** `apps/api/src/routes/integrations/microsoft-mail.ts`
**Symptom:** Both `feat/wave5-gmail-integration` and `feat/wave5-outlook-integration` define `/integrations/microsoft/mail/oauth/start`, `/integrations/microsoft/mail/oauth/callback`, `/integrations/microsoft/mail/disconnect`. Merging both without conflict resolution will cause Fastify `DuplicateRouteError` at server startup.
**Resolution:** Keep one canonical `microsoft-mail.ts`; verify which branch has the most complete version and discard the other's duplicate during merge.

---

### P1-2 — `SlackChannel` model added without `SlackWorkspace` on 7 Wave 5 branches
**Symptom:** `SlackChannel` assumes a `SlackWorkspace` FK on branches: w5-ai-frontend, w5-azure-sso, w5-custom-fields, w5-esig-fe, w5-final-polish, w5-gmail, w5-outlook. `SlackWorkspace` is only present on w5-slack-zapier, w5-analytics-frontend, w5-onboarding-complete.
**Impact:** If any of the 7 incomplete branches are merged first and a migration is run, the `slack_channels` table will have a foreign key pointing to a non-existent `slack_workspaces` table.
**Resolution:** Strict merge order gate: `feat/wave5-slack-zapier` BEFORE any branch containing `SlackChannel` without `SlackWorkspace`.

---

### P1-3 — `PublicSignPage` at `/sign/:token` not verified shipped
**Source:** Wave 5 final report §6.5
**Symptom:** `feat/wave4-esignature` registers `publicSignRoutes` at root (no /api/v1 prefix) so recipients can sign without auth. `feat/wave5-esignature-frontend` has no equivalent page in `apps/web/src/pages/` — `PublicSignPage.tsx` is absent.
**Impact:** Recipients who receive a signing link will get a 404 or the React app's catch-all error page. The entire DocuSign/internal signing experience for external customers is broken.
**Resolution:** Create `apps/web/src/pages/PublicSignPage.tsx` + add `/sign/:token` route to `App.tsx` that bypasses Clerk auth.

---

### P1-4 — 451 uncommitted files in main repo (worktree-leak residue + WIP)
**Symptom:** `git status --short` in the main BIDCRM repo returns 451 modified/untracked files. Includes leaked Wave 5 work (Azure SSO, analytics frontend, etc.) that was committed to `feat/wave5-onboarding-complete` instead of proper branches, plus accumulated WIP.
**Impact:** The merge baseline is unclear. Running `git stash` before merges could silently drop intentional work. Branch-to-branch diffs will be noisy.
**Resolution:** Before starting merge sequence: `git stash` → identify stashed files against the cherry-pick plan → `git stash pop` + commit what's intentional to the correct branches → drop the rest.

---

### P1-5 — `@bidstack/memos` used but `MemOSService` behaviour unclear
**Context:** Beyond the P0-1 compile error, there is no documented specification for what `MemOSService` was supposed to do. `bid-scores.ts` and `proposals.ts` call it at runtime.
**Impact:** Even after creating a stub package to resolve the compile error, the runtime behaviour is undefined. Bid scoring and proposal generation may silently produce wrong results if `MemOSService` is a no-op stub.
**Resolution:** Audit usages in `bid-scores.ts` and `proposals.ts`; determine whether the MemOS integration was a planned feature or accidental import; if planned, spec and implement; if accidental, remove the import entirely.

---

### P1-6 — ReportBuilderPage, GoalsPage not verified shipped for analytics
**Source:** Wave 5 final report §6.6
**Symptom:** `feat/wave5-analytics-frontend` ships chart components (`WidgetRenderer`, `FilterBuilder`, `KpiCard`, etc.) and a `ReportsPage.tsx`, but there is no `ReportBuilderPage.tsx` or `GoalsPage.tsx`. `useGoals.ts` hook exists but has no page binding.
**Impact:** Users cannot build custom reports or set goals through the UI. The analytics feature is component-complete but page-incomplete.
**Resolution:** Create `ReportBuilderPage.tsx` composing `FilterBuilder` + `AggregatePicker` + `GroupByPicker` + `FieldPicker` + preview chart. Create `GoalsPage.tsx` using `useGoals` hook.

---

### P1-7 — Custom fields wired only to `Contact` detail page
**Source:** Wave 5 final report §8 (partial)
**Symptom:** `feat/wave5-custom-fields` wires `CustomFieldFormSection` into `ContactDetailPage.tsx` only. `OpportunityDetailPage`, `LeadDetailPage`, `CompanyDetailPage`, `TaskDetailPage` do not include custom field rendering.
**Impact:** Custom fields admin works; custom fields can be defined for any entity; but only contacts show them. Opportunities, Leads, Companies, Tasks ignore custom field values.
**Resolution:** Add `CustomFieldFormSection` to the 4 remaining detail pages.

---

### P1-8 — `Notification` cluster not included in Wave 4/5 base schemas
**Symptom:** `feat/wave3-notification-engine` adds `Notification`, `NotificationPreference`, `WebPushSubscription`. No Wave 4 or 5 branch forwards these models.
**Impact:** If Wave 4/5 branches are merged without Wave 3 notification engine, the notification tables don't exist. The bell icon + notification service that Wave 5 references (AI cost cap notifications, workflow run alerts, etc.) will crash at DB query time.
**Resolution:** Enforce merge order: notification engine BEFORE any Wave 4 branch. After merge, confirm notification tables exist before enabling workflow/AI features.

---

### P1-9 — `Opportunity.valueMicros` vs `valueEur` money type inconsistency
**Source:** PROGRESS.md deferred items
**Symptom:** PROGRESS.md documents `Opportunity.valueEur Decimal(14,2)` should be migrated to `valueMicros BigInt` for consistency with the money doctrine (`packages/CLAUDE.md`: "Always store amounts in micros"). Migration deferred.
**Impact:** Revenue reporting will mix decimal EUR values with micros from other models (Invoice, SalesOrder), producing incorrect currency aggregations.
**Resolution:** Add a migration: `ALTER TABLE opportunities ADD COLUMN value_micros BIGINT; UPDATE ... SET value_micros = value_eur * 1000000; DROP COLUMN value_eur;` with a backfill script.

---

## P2 — Backlog (address in Wave 6 or later)

### P2-1 — Web unit test coverage at 5% (11 test files / 227 source files)
**Impact:** Low confidence in frontend regressions. UI state machines, edge cases, form validation untested.
**Resolution:** Add Vitest unit tests for critical hooks (`useSignatureRequests`, `useAnalyticsReports`, `useOpportunities`, `useLeads`) and key pages.

---

### P2-2 — `crm.ts` service file exceeds 400-line cap
**Source:** PROGRESS.md deferred items
**Symptom:** `apps/api/src/routes/crm.ts` was reported at 1590 lines — 4x the project's 400-line quality rule.
**Resolution:** Extract into `crm/contacts.ts`, `crm/companies.ts`, `crm/leads.ts`, `crm/opportunities.ts` sub-services.

---

### P2-3 — 29 scattered `process.env.X` reads without Zod validation
**Source:** PROGRESS.md deferred items + §E.3 of this QA report
**Symptom:** Env vars accessed via direct `process.env.X` reads spread across server.ts, services/microsoft-graph.service.ts, etc.
**Resolution:** Create a validated `apps/api/src/env.ts` that applies a Zod schema to `process.env` at startup; import config values from there.

---

### P2-4 — Framer Motion `transparent` animation values (M-1)
**Source:** Prior QA audit 2026-05-23
**Symptom:** Framer Motion warnings `"transparent" is not an animatable value` — `backgroundColor` animated from/to `"transparent"`.
**Impact:** Console noise; potential visual glitch on slower devices.
**Resolution:** Replace `"transparent"` with `"rgba(0,0,0,0)"` in all Framer motion variant definitions.

---

### P2-5 — `Opportunity.valueEur` compound FK consistency
**Source:** PROGRESS.md deferred items
**Symptom:** `Company` first-class entity with FK is deferred. `Note.accountId`/`FileAttachment.accountId` are free-text VarChar rather than FK to `Company`.
**Impact:** Referential integrity not enforced at DB level for notes and attachments.

---

### P2-6 — Onboarding template pipeline definitions not verified shipped
**Source:** Wave 5 final report §6.7
**Symptom:** 4 template pipelines (B2B_SAAS, AGENCY, ENTERPRISE, INSIDE_SALES) were spec'd for W5-9 but `apps/api/src/services/onboarding-templates/` directory does not exist on `feat/wave5-onboarding-complete`.
**Impact:** "Apply template" step in onboarding tour has no backend to call.
**Resolution:** Create `apps/api/src/services/onboarding-templates/` with 4 seed payloads that call the existing workflow/pipeline CRUD APIs.

---

### P2-7 — `IntegrationToken.provider` enum merging — no conflict protection
**Symptom:** Multiple branches extend the `IntegrationToken.provider` enum with values (GOOGLE_CALENDAR, GMAIL, MICROSOFT_GRAPH, etc.). No automated conflict detection exists.
**Impact:** If two branches add conflicting enum values or duplicate enum entries during merge, Prisma migration will fail silently or create a schema that cannot be introspected.
**Resolution:** Create a `packages/db/prisma/enum-audit.ts` script that reads the merged schema and asserts no duplicate enum values.

---

### P2-8 — Stripe billing branch not in merge order
**Source:** Branch `feat/stripe-billing-wave2` exists but is not in the Wave 5 recommended merge order (§5 of final report).
**Impact:** Billing/subscription flows won't be active after Wave 3-5 merge unless Stripe branch is also merged.
**Resolution:** Add `feat/stripe-billing-wave2` to Phase 9 of merge order, after RBAC.

---

### P2-9 — `SELECT *` usage in CRM routes
**Source:** PROGRESS.md deferred items
**Symptom:** Several CRM routes use `prisma.model.findMany()` without explicit column selection, violating the project's "No SELECT *" rule.
**Impact:** Performance degradation; potentially leaking PII fields from models that have PII encryption middleware.
**Resolution:** Audit all `prisma.*.findMany()` / `findFirst()` calls; add explicit `select: { ... }` blocks.

---

### P2-10 — C-2: Intermittent 500 on CRM Dashboard endpoint (unresolved from 2026-05-23 audit)
**Source:** Prior QA audit 2026-05-23 C-2
**Symptom:** `GET /api/v1/crm/dashboard?account={id}` returns intermittent 500 errors.
**Root cause:** TBD — needs server log investigation in a running environment.
**Resolution:** Reproduce with `pnpm dev`, set `LOG_LEVEL=debug`, trigger the 500, capture Pino structured log, identify failing DB query.

---

## Carryovers From Prior Audits (not yet resolved)

| Issue | Source | Status |
|---|---|---|
| Framer Motion `transparent` warnings | QA 2026-05-23 M-1 | Open (P2-4 above) |
| CRM Dashboard intermittent 500 | QA 2026-05-23 C-2 | Under investigation (P2-10 above) |
| Service-layer extract from `crm.ts` (1590 lines) | PROGRESS.md | Deferred (P2-2 above) |
| Zod-validated config for 29 process.env reads | PROGRESS.md | Deferred (P2-3 above) |
| `Opportunity.valueEur` → `valueMicros` migration | PROGRESS.md | Deferred (P1-9 above) |
| Composite FKs `(org_id, X_id)` for DB-level multi-tenancy | PROGRESS.md | Deferred — architectural lift |
| `audit_log.diff` typed split | PROGRESS.md | Deferred |
| `packages/twenty-bidstack` — extract or delete | PROGRESS.md | Deferred |
| OpenAPI auto-gen + Swagger UI | Wave 5 final report §4 | Not started |
| TSDoc coverage ≥80% | Wave 5 final report §4 | Not started |
| Bundle size analysis (<150KB gzip target) | Wave 5 final report §4 | Not measured |
| 21st.dev component adoption (20 of 25 remaining) | Wave 5 final report §4 | Not started |

---

## Issue Count Summary

| Severity | Count |
|---|---|
| P0 | 5 |
| P1 | 9 |
| P2 | 10 |
| **Total** | **24** |
