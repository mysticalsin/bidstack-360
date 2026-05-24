# BidStack 360° — Final QA Report
**Date:** 2026-05-24
**Auditor:** Agent W6-C (static analysis, no live install)
**Worktree:** `.claude/worktrees/agent-a2029f76469120917`
**Base branch:** `running_best` (`f7fd2723`)
**QA branch:** `docs/wave6-qa-pass`
**Scope:** 22 Wave 3/4/5 feature branches, static analysis only (no node\_modules, no live DB)

---

## Methodology Note

`node_modules` is absent in this worktree. **No `pnpm typecheck`, `pnpm lint`, or `vitest` run** is possible.
All findings are derived from:
- `git diff running_best..<branch>` — incremental diffs
- `git show <branch>:<path>` — file inspection
- Pattern grep over diffs (ts-ignore/as any, console.log, TODO/FIXME)
- Prisma schema model extraction
- Route registration grep in `server.ts` and `routes/integrations/`
- File tree enumeration via `git ls-tree`

Results marked `[STATIC ONLY]` require live toolchain verification before merge sign-off.

---

## A. Per-Branch Static Analysis

### A.1 Metric Table

Counts are **incremental additions** in the branch diff vs `running_best`.
`ts-ignore+as-any` = combined `@ts-ignore` and `as any` hits added in diff.
`console.log` = new `console.log` additions.
`TODO/FIXME` = new TODO/FIXME additions.
`phantom-dep` = references to `@bidstack/memos` (non-existent package).

| Branch | Short SHA | ts-ignore+as-any | console.log | TODO/FIXME | phantom-dep |
|---|---|---|---|---|---|
| feat/wave3-calendar-twoway-booking | 841f76a1 | 4 | 1 | 1 | 0 |
| feat/wave3-migration-connectors | ffff29ab | 2 | 2 | 0 | 0 |
| feat/wave3-mobile-pwa-offline | 71044238 | 2 | 3 | 0 | 0 |
| feat/wave3-notification-engine | 4306d4e8 | 2 | 1 | 0 | 0 |
| feat/wave3-workflow-builder-ui | 23082905 | 2 | 1 | 0 | 0 |
| feat/wave4-ai-assistant | f9b5f326 | 2 | 1 | 3 | YES |
| feat/wave4-analytics-dashboards | ba791590 | **21** | 1 | **8** | YES |
| feat/wave4-design-system | 97ec6b39 | 2 | 3 | 3 | YES |
| feat/wave4-esignature | 72ee1620 | 2 | 1 | 4 | YES |
| feat/wave4-pwa-completion | 66668ed9 | 2 | 1 | **8** | YES |
| feat/wave4-rbac-encryption-onboarding | f9b5f326 | 2 | 1 | 3 | YES |
| feat/wave4-timeline-custom-fields | 25a1b6e7 | 2 | 1 | 3 | YES |
| feat/wave5-ai-frontend | 28fadf4f | **18** | 1 | 3 | YES |
| feat/wave5-analytics-frontend | 0bfedb96 | **33** | 4 | 4 | YES |
| feat/wave5-azure-sso | a11f6630 | **18** | 1 | 3 | YES |
| feat/wave5-custom-fields | 8a200726 | **19** | 1 | 3 | YES |
| feat/wave5-esignature-frontend | c608ac76 | **19** | 1 | 3 | YES |
| feat/wave5-final-polish | 6f366510 | **18** | 1 | 3 | YES |
| feat/wave5-gmail-integration | 2d04f9db | **21** | 2 | 3 | YES |
| feat/wave5-onboarding-complete | 5e6ddab8 | **33** | 4 | 4 | YES |
| feat/wave5-outlook-integration | e8dc4ac6 | **21** | 2 | 3 | YES |
| feat/wave5-slack-zapier | ad05e8af | **28** | 2 | 3 | YES |

**Interpretation:**
- Wave 3 branches are cleanest (2-4 ts-ignore/as-any hits, minimal console.log).
- Wave 4+ branches show cumulative growth because each branch includes all prior schema/code; the count is **not** exclusively new issues in that branch's unique additions.
- `feat/wave5-analytics-frontend` and `feat/wave5-onboarding-complete` have the highest ts-ignore+as-any at **33 each**. These are the most complete branches and likely the merge targets — these need careful review.
- `feat/wave4-analytics-dashboards` has **21 ts-ignore+as-any** — notably high for what is primarily a backend analytics branch.
- **All Wave 4+ branches reference `@bidstack/memos`** via `apps/api/src/routes/bid-scores.ts` and `apps/api/src/routes/proposals.ts`. This package does not exist in `packages/`. This is a **P0 compile-time error** on install.
- `console.log` counts are low (1-4 per branch) — mostly from wave5 multi-stream branches.
- No `pnpm typecheck` run possible. Error counts require live verification `[STATIC ONLY]`.

### A.2 Phantom Dependency — `@bidstack/memos`

**Files affected:** `apps/api/src/routes/bid-scores.ts`, `apps/api/src/routes/proposals.ts`
**Import:** `import { MemOSService } from '@bidstack/memos';`
**Package existence:** NOT present in `packages/` directory.
**Impact:** TypeScript compile error + runtime crash on `import`. All branches that include these routes will fail typecheck.
**Resolution:** Either create `packages/memos/` stub or replace `MemOSService` calls with `MemosTrace`/`MemosPolicy` Prisma models (which ARE in `running_best` schema).

---

## B. Schema Collision Audit

### B.1 Base Schema

`running_best` has **76 Prisma models**. All feature branches add net-new models on top.

### B.2 New Models Per Branch (vs running\_best)

| Model | w3-cal | w3-mig | w3-pwa | w3-notif | w3-wf | w4-ai | w4-analytics | w4-design | w4-esig | w4-pwa | w4-rbac | w4-timeline | w5-ai-fe | w5-analytics-fe | w5-azure | w5-cf | w5-esig-fe | w5-polish | w5-gmail | w5-onboard | w5-outlook | w5-slack |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| TenantExport | + | + | + | + | + | + | + | + | + | + | + | + | + | + | + | + | + | + | + | + | + | + |
| Quote/QuoteLine/QuoteVersion | + | + | + | + | + | + | + | + | + | + | + | + | + | + | + | + | + | + | + | + | + | + |
| Pipeline/PipelineStage | + | + | + | + | + | + | + | + | + | + | + | + | + | + | + | + | + | + | + | + | + | + |
| MigrationJob/MigrationMapping | — | + | — | — | — | + | + | + | + | + | + | + | + | + | + | + | + | + | + | + | + | + |
| IntegrationToken | + | — | — | — | — | + | + | + | + | + | + | + | + | + | + | + | + | + | + | + | + | + |
| CalendarEvent/BookingPage/Booking | + | — | — | — | — | + | + | + | + | + | + | + | + | + | + | + | + | + | + | + | + | + |
| Notification/NotificationPreference/WebPushSubscription | — | — | — | + | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — |
| AiAssistantSession/Feedback/PromptTemplate | — | — | — | — | — | + | — | — | — | — | + | — | + | + | + | + | + | + | + | + | + | + |
| AnalyticsDashboard/Widget/Report/ReportRun/Goal | — | — | — | — | — | — | + | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — |
| DocumentTemplate/DocumentTemplateVersion | — | — | — | — | — | — | — | — | + | — | — | — | — | — | — | — | — | — | — | — | — | — |
| SignatureRequest/SignatureEvent | — | — | — | — | — | — | — | — | + | — | — | — | — | — | — | — | — | — | — | — | — | — |
| EmailMessage/EmailTrackingPixel | — | — | — | — | — | — | — | — | — | — | — | — | + | + | + | + | + | + | + | + | + | + |
| EmailAttachment | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | + | — | — | — |
| SlackWorkspace/SlackUserMapping | — | — | — | — | — | — | — | — | — | — | — | — | — | + | — | — | — | — | — | + | — | + |
| SlackChannel | — | — | — | — | — | — | — | — | — | — | — | — | + | + | + | + | + | + | + | + | + | + |
| ZapierApp/Trigger/Action | — | — | — | — | — | — | — | — | — | — | — | — | + | + | + | + | + | + | + | + | + | + |
| ZapierSubscription | — | — | — | — | — | — | — | — | — | — | — | — | — | + | — | — | — | — | — | + | — | + |
| SsoProvider/ScimToken | — | — | — | — | — | — | — | — | — | — | — | — | — | — | + | — | — | — | — | — | — | — |

Legend: `+` = model added by this branch, `—` = not present in this branch's diff

### B.3 Critical Schema Collisions

#### COLLISION 1: `AnalyticsDashboard` / `AnalyticsReport` family — ORPHANED
**Only branch adding these models:** `feat/wave4-analytics-dashboards` (5 models)
**Not present in:** Any Wave 5 branch, including `feat/wave5-analytics-frontend`
**Impact (P0):** The analytics frontend (`useAnalyticsReports`, `ReportBuilderPage`) references report/dashboard entities via API. If `feat/wave4-analytics-dashboards` is merged before frontend branches, the frontend route definitions must reference those API endpoints. If analytics branches are merged WITHOUT w4-analytics-dashboards, the frontend will 404 at runtime. Analytics Prisma models are NOT in the master schema yet.

#### COLLISION 2: `DocumentTemplate` / `SignatureRequest` / `SignatureEvent` — DROPPED BY FRONTEND
**Added in:** `feat/wave4-esignature` (4 models: DocumentTemplate, DocumentTemplateVersion, SignatureRequest, SignatureEvent)
**Present in Wave 5:** `feat/wave5-esignature-frontend` DOES NOT include these 4 models
**Impact (P0):** `feat/wave5-esignature-frontend` ships full UI (`SignaturesPage`, `SignatureRequestDetailPage`, `useSignatureRequests`, `SendForSignatureModal`) that references `SignatureRequest` via shared Zod schemas and API calls — but the Prisma models are missing from that branch's schema. The API routes for signing (`documentTemplatesRoutes`, `signaturesRoutes`) are also absent from `wave5-esignature-frontend/server.ts`. Merge without w4-esignature will cause runtime crashes.

#### COLLISION 3: `SlackChannel` — Conflicting structures
**SlackChannel added in:** w5-ai-frontend, w5-azure, w5-custom-fields, w5-esig-fe, w5-polish, w5-gmail, w5-outlook (without `SlackWorkspace`)
**SlackWorkspace + SlackChannel + SlackUserMapping added in:** w5-analytics-frontend, w5-onboarding-complete, w5-slack-zapier
**Risk:** If a branch without `SlackWorkspace` is merged first and the `SlackChannel.workspaceId` FK exists, migration will fail because `SlackWorkspace` table doesn't exist yet. **Merge order gate required:** w5-slack-zapier BEFORE any branch referencing SlackChannel without SlackWorkspace.

#### COLLISION 4: `IntegrationToken.provider` enum — Multi-branch extension
**Extended in:** w3-calendar-twoway-booking, w4-ai-assistant (via inheritance), w5-gmail-integration, w5-outlook-integration, w5-azure-sso
Each branch adds provider values (GOOGLE_CALENDAR, GMAIL, MICROSOFT_GRAPH, MICROSOFT_MAIL, etc.). If any two branches attempt to extend the same enum in conflicting ways, Prisma migration will error. **Resolution:** Merge in wave order; verify combined enum after each merge with `pnpm db:generate`.

#### COLLISION 5: `Notification` — Wave 3 only, not forward-ported
**Added in:** `feat/wave3-notification-engine` only (Notification, NotificationPreference, WebPushSubscription)
**Not present in:** All Wave 4/5 branches (they don't base on w3-notification-engine)
**Risk:** Any Wave 4/5 branch merged before w3-notification-engine will not have the notification tables. Cross-channel notification references in Wave 5 AI/onboarding features will have no DB backing.

### B.4 Merge Precedence Recommendation

Strict order requirement per schema dependency:
1. `running_best` (base — 76 models)
2. `feat/wave3-notification-engine` — adds Notification cluster
3. `feat/wave3-calendar-twoway-booking` — adds IntegrationToken + Calendar cluster
4. `feat/wave3-migration-connectors` — adds MigrationJob
5. `feat/wave4-timeline-custom-fields` — extends Activity
6. `feat/wave4-analytics-dashboards` — adds Analytics cluster (**required before any analytics frontend**)
7. `feat/wave4-esignature` — adds DocumentTemplate + SignatureRequest (**required before w5-esig-fe**)
8. `feat/wave4-ai-assistant` / `feat/wave4-rbac-encryption-onboarding` — adds AI cluster
9. `feat/wave5-slack-zapier` — adds SlackWorkspace + ZapierSubscription (**required before any branch with SlackChannel**)
10. `feat/wave5-gmail-integration` — adds EmailMessage + EmailAttachment
11. `feat/wave5-azure-sso` — adds SsoProvider + ScimToken
12. `feat/wave5-esignature-frontend` — safe only after step 7
13. `feat/wave5-analytics-frontend` — safe only after step 6

---

## C. Cross-Branch Route Conflicts

### C.1 Route Analysis (static via git show)

Analysis based on `server.ts` register calls and route file inspection across key branches.

| Route namespace | Branches defining routes here | Risk |
|---|---|---|
| `/api/v1/integrations/gmail/oauth/*` | feat/wave5-gmail-integration | Single owner — no conflict |
| `/api/v1/integrations/microsoft/mail/oauth/*` | feat/wave5-gmail-integration + feat/wave5-outlook-integration | **DUPLICATE REGISTRATION** — same routes defined in both branches |
| `/sso/microsoft/login/:orgSlug`, `/sso/microsoft/callback` | feat/wave5-azure-sso | Single owner — no conflict with `/api/v1/integrations/microsoft/mail/oauth/` (different namespace) |
| `/api/v1/notifications` | feat/wave3-notification-engine only | Not registered in any Wave 4/5 branch server.ts — will need to be re-added on merge |
| `/api/v1/analytics/*` | feat/wave4-analytics-dashboards only | Not in w5-analytics-frontend server.ts — see §C.2 |
| `/api/v1/documents/*`, `/api/v1/signatures/*`, `/sign/:token` | feat/wave4-esignature only | Not in w5-esig-fe server.ts — see §C.3 |
| `/track/*` | feat/wave5-gmail-integration | Single owner — no conflict |

### C.2 Missing Route Registrations in Frontend Branches

**`feat/wave5-analytics-frontend` server.ts** does NOT register `analyticsRoutes`.
The analytics backend (`/api/v1/analytics/*`) was registered only in `feat/wave4-analytics-dashboards`. The frontend assumes the API exists, but after merging `wave5-analytics-frontend` without `wave4-analytics-dashboards`, all analytics API calls will 404.

**`feat/wave5-esignature-frontend` server.ts** does NOT register `documentTemplatesRoutes`, `signaturesRoutes`, or `publicSignRoutes`.
These were registered only in `feat/wave4-esignature`. Same problem: frontend ships, API doesn't.

### C.3 Microsoft Route Double-Registration Risk

`feat/wave5-gmail-integration` registers:
- `gmailOAuthRoutes` at `/api/v1/integrations`
- `microsoftMailOAuthRoutes` at `/api/v1/integrations`

`feat/wave5-outlook-integration` also appears to contain the same `microsoft-mail.ts` routes.
On merge without conflict resolution, Fastify will attempt to register `/integrations/microsoft/mail/oauth/start` twice and throw a `DuplicateRouteError` at startup.

---

## D. Test Coverage Estimate (Static)

All figures based on `feat/wave5-onboarding-complete` (most complete branch).
Ratio = test files / source files. This is a **file count ratio, not line coverage**.

| Package | Source files | Test files | Ratio | Notes |
|---|---|---|---|---|
| apps/api | 109 `.ts` | 44 `.test.ts` | 40% | Good for a backend; routes well covered. Missing: notification, calendar, booking, esignature, analytics routes (those live on separate branches) |
| apps/web | 227 `.ts/.tsx` | 11 `.test.ts/.tsx` | 5% | Very low. Only UI primitives + auth tested. 34 pages, 51 hooks — nearly all untested at unit level |
| apps/web (E2E) | 34 pages | 16 `.spec.ts` | 47% | Good E2E coverage breadth. Missing: onboarding tour, AI assistant, custom fields, e-sig signing |
| apps/worker | 12 `.ts` | 4 `.test.ts` | 33% | Reasonable. BullMQ queue logic and extract-text covered |
| packages/shared | 46 `.ts` | 7 `.test.ts` | 15% | Low. Zod schemas for calendar + core CRM covered but integration hub schemas untested |

**Key gap:** Web unit test ratio (5%) is far below the project's quality gate of meaningful coverage. Integration tests (E2E at 47%) partially compensate but do not cover component state machines.

---

## E. Security Spot-Checks

### E.1 `.env` Files Committed
**Result: CLEAN.** No `.env` files (excluding `.env.example`) found in tracked files across any branch.

### E.2 Hardcoded Secret Patterns
**Pattern scanned:** `sk_live|pk_live|AKIA[0-9A-Z]|ghp_|github_pat|xoxb-|xoxp-|AIza`
**Result: CLEAN.** Matches found only in `scripts/check-secrets.sh` and `.gitleaks.toml` (the scanning definitions themselves, not actual secrets).

### E.3 Unguarded `process.env` Access
The following were found without nullish coalescing (`??`) or validation:

| File | Line pattern | Risk |
|---|---|---|
| `apps/api/src/server.ts` | `process.env.PUBLIC_BASE_URL` in `.filter(Boolean)` | Low — filter(Boolean) effectively guards undefined |
| `apps/api/src/services/microsoft-graph.service.ts` | `const v = process.env.MICROSOFT_GRAPH_CLIENT_ID` | Medium — if undefined, OAuth client construction silently fails |
| `apps/api/src/services/microsoft-graph.service.ts` | `const v = process.env.MICROSOFT_GRAPH_CLIENT_SECRET` | Medium — same |
| `apps/api/src/services/microsoft-graph.service.ts` | `const v = process.env.MICROSOFT_WEBHOOK_BASE_URL` | Medium — webhook subscriptions silently fail |

**Recommended fix:** Use the validated-config pattern (Zod schema over `process.env`) already recommended in `PROGRESS.md`'s deferred items list. Replace the 3 Microsoft Graph raw reads with a shared `env.ts` config file.

### E.4 Multi-tenancy Org Scope
`running_best:PROGRESS.md` documents that every Prisma query must include `where: { orgId }`. No regression found in the routes inspected. The RBAC plugin (`feat/wave4-rbac-encryption-onboarding`) adds middleware-level enforcement.

---

## F. Checklist: Can-Run Status Per Branch

| Branch | node_modules | Can typecheck | Can test | Blockers |
|---|---|---|---|---|
| All 22 branches | NO (worktree only) | NO [STATIC ONLY] | NO [STATIC ONLY] | node_modules absent |

Workaround: User must `pnpm install` + `pnpm db:generate` in main repo checkout between merges per the Wave 5 final report §5 recommendation.

---

## Summary: Top 5 Issues by Severity

| Rank | Severity | Issue |
|---|---|---|
| 1 | **P0** | `@bidstack/memos` phantom dep in `bid-scores.ts` + `proposals.ts` — compile error on install for all Wave 4/5 branches |
| 2 | **P0** | `DocumentTemplate`/`SignatureRequest`/`SignatureEvent` Prisma models missing from `feat/wave5-esignature-frontend` — e-sig frontend ships with no DB backing |
| 3 | **P0** | `AnalyticsDashboard` etc. models only in `feat/wave4-analytics-dashboards`, not carried into Wave 5 analytics frontend — analytics API 404s after merge without strict ordering |
| 4 | **P1** | Microsoft Mail OAuth routes double-registered in `wave5-gmail-integration` AND `wave5-outlook-integration` — Fastify startup crash on merge without conflict resolution |
| 5 | **P1** | `SlackChannel` model added without `SlackWorkspace` on 7 Wave 5 branches — migration failure if merged before `feat/wave5-slack-zapier` |
