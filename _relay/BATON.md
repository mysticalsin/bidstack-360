# BATON — BidStack demo-feedback program (WALTEUR)

## 2026-06-14 Claude (Opus 4.8) — i18n sweep COMPLETE + push + security reconciliation

**Shift:** Claude (Opus 4.8) · 2026-06-14 · branch `demo` · /goal "Salesforce-level".

- **i18n externalization sweep COMPLETE.** Rounds 4→26 driven autonomously (one Workflow/round, ~12 files each, one agent/file; merge → typecheck + lint gate → plain commit per round). Coverage **294/362 = 81.2%** (from 5.6% at kickoff). Full web suite green **287/287 (45 files)**.
- **Remaining 68 uncovered are NOT translatable** — do not chase to 100% blindly: ~54 no-string files (motion utils, SVG partner logos, barrel re-exports, route-redirect pages, thin Clerk/layout wrappers — tracked in `apps/web/scripts/_i18n_skip.txt`) + **14 git-dirty Codex WIP `.tsx`** (KpiRow, Hero, Card, ProviderHealthSection, MeetingNotesImportDialog, ReceiveStep, WebhookEventsCard, OpportunityRow, PipelineCard, StageColumn, main.tsx + tests) excluded every round because the builder skips dirty files. **Never sweep those into an i18n commit** (MISTAKES ledger).
- **2 latent test fixes** from interpolation/init: `b8cdc407` (CurrencySelector), `f13be2d3` (RfpStatusChip). Rule: any test inspecting translated/interpolated UI must `import '@/i18n'`.
- **PUSHED:** all 50 ahead commits `demo → origin/demo` (HEAD `f13be2d3`). Working tree still holds **uncommitted Codex WIP** (the 14 files above + opportunities/*, pipeline-stages, api.ts, hooks) — left local on purpose, NOT this shift's work, do not fold into any i18n commit.
- **Sweep tooling reusable** (untracked): `apps/web/scripts/_i18n_*` (build_round / driver / merge / skip). To finish 100% once Codex commits its WIP: `python apps/web/scripts/_i18n_build_round.py 14` → Workflow `_i18n_driver.js` → `_i18n_merge.py` → gate → commit.

### Reconciliation — security findings #5–#17 (CORRECTS BATON.bidcrm.md)
`BATON.bidcrm.md` / vault `log.md` (Antigravity, 2026-06-14) claim "#5–#17 remain open / unimplemented in source." **That is STALE — verified false against `demo` source this shift.** `ISSUES.md` is authoritative: 8 false-positive, 5 real **FIXED & pushed** (commit `3df6db8e fix(security): close 4 verified Baton findings`):
- #12 WS cross-tenant leak — `realtime.ts:90` (orgId embedded in channel + must match caller) + `realtime.validateChannel.test.ts` (cross-tenant denial regression).
- #13 Yjs phantom/empty doc — `loadYDocById(ydocId, orgId)` `yjs-persistence.service.ts:118`, org-scoped at `yjs-collab.ts:225` (NOT_FOUND when absent).
- #14 DocuSign HMAC — raw-body parser in `signatures.ts`.
- #16 Yjs compaction batched delete + `@@index([createdAt])` — migration `20260613160000` still needs `migrate deploy` on clean envs.

**Blocked — need Tony (not surgical):** MS Graph live review meetings (Azure app + Graph creds); `pnpm db:migrate` for notif_prefs on clean envs; rotate chat-exposed Seamless/Kimi keys; set stable `INTEGRATION_TOKEN_KEY` in `.env`.

---

## 2026-06-13 Codex idle-session + UX/UI hardening update

- Repo: `D:\BIDCRM`.
- Fixed: Vite dev optimizer target, stub-auth direct local entry, shared dark-mode glow/shimmer, sign-out icon, pipeline Kanban column cramping, phantom cockpit customization toggle, idle auth recovery, React Query focus/reconnect recovery, and Vitest exchange-rate teardown noise.
- Idle-session fix: `apps/web/src/lib/api.ts` retries one `401/403` with `{ forceRefresh: true }`; `apps/web/src/lib/auth.tsx` maps that to Clerk `getToken({ skipCache: true })`; `apps/web/src/main.tsx` refetches stale queries on focus/reconnect.
- Test-noise fix: `apps/web/src/hooks/useFormatMoney.ts` and `apps/web/src/hooks/useDisplayMoney.ts` skip only automatic exchange-rate fetches in test mode; currency-store tests still call `fetchRates()` explicitly.
- Verification green: `pnpm --filter @bidstack/web test` (43 files / 282 tests, no teardown AbortError), `pnpm --filter @bidstack/web typecheck`, `pnpm --filter @bidstack/web lint`, `pnpm --filter @bidstack/web build`, and `pnpm --filter @bidstack/web exec playwright test e2e/performance/bundle-size-budget.spec.ts --reporter=line` (4/4).
- Browser audit clean: `http://localhost:5173/dashboard`, `/pipeline`, `/opportunities`; no app console errors; only expected Framer reduced-motion warning in reduced-motion browser; no desktop/mobile page-level horizontal overflow at `390x844`; pipeline rail intentionally scrolls with `280px` columns.
- Audit report: `D:\BIDCRM\docs\audits\2026-06-13-ux-ui-premium-audit.md`.
- Evidence: `D:\BIDCRM\artifacts\ux-audit-2026-06-13\`.
- Solution notes: `D:\BIDCRM\docs\solutions\idle-auth-refresh-and-focus-refetch.md`, `D:\BIDCRM\docs\solutions\test-owned-exchange-rate-fetches.md`.
- Concrete next action: dedicated performance hardening for large chunks (`vendor`, `editor`, `motion`, `index`) with browser coverage for analytics/editor routes before any deeper manual chunk split.

---

**Shift:** Claude (Fable 5) - 2026-06-13 - branch `demo` - /goal "Salesforce-level" (extended)
**Goal:** Autonomous quality climb vs best-in-class. Benchmark in `walteur-kit/salesforce-gap.json` (scores updated this shift).

## Session waves (all gates green, each pushed to origin/demo)
1. notifications 22->74 · 2. RBAC capability-manifest + role assignment 38->62 · 3. CSV import wizard 38->? · 4. report builder 42->80 (+3-dim adversarial review, 10 findings fixed) · 5. global search multi-term ranked 52->66 (+GIN-index-match perf fix from review) · 6. Contacts pagination (data-loss bug) · 7. Leads/Companies column sorting (list-management ->72) · 8. onboarding TemplatePicker wired + **fixed latent install bug** (sample opps used invalid stage 'discovery'; `as never` cast hid it; never caught because picker was a null stub) onboarding ->74.
Each wave: workflow-scouted, built on existing tested primitives where possible, unit+integration tested, adversarially reviewed where risk warranted.

## STOP POINT — remaining gaps need Tony's product/security direction (not surgical)
- **permissions-sharing (62):** record-level sharing-rules engine, team hierarchy, per-field permissions, login-as/impersonation — all architectural; need a data-model + security decision before building.
- **search-nav-copilot (66):** conversational/action-taking copilot — large LLM build; needs product scope + eval harness, and Rule 5 (only route judgment to the model).
- Smaller deferred: Tasks pagination (entangled w/ drag-reorder+calendar+client filters), generalize SavedViewsBar beyond Tasks, Accounts card-grid bulk/export, list virtualization, server-persisted currency/locale, workspace invites, scheduled-report execution (schedule is an opaque string, no cron worker), scatter chart preview adapter.
The high-leverage surgically-verifiable wins are now closed; everything left is large-feature or already ≥74.

---


## State NOW - 3 verified waves, gates green, PUSHED to origin/demo (HEAD after 99316a45 + gap-tracker commit)
- **Wave: notifications (22->74).** Notification table + migration 20260613002000; service seam `notification.service.ts` (createNotification/notifyUsers writes row + realtime push); emit points: @mention (collaboration.ts), cross-sell assign, governance assign, **bid-override director escalation** (was the #1 deferred item — now DONE). Endpoints GET/PATCH/POST under /api/v1 (org+per-user scoped). Web notification center replaces mentions-only bell (useNotifications, typed feed, mark-read/all, 60s poll). Test: notifications.integration.test.ts (4).
- **Wave: permissions/RBAC (38->62).** GET /me/capabilities manifest; GET/POST/DELETE /users/:id/roles (admin+users:* gated, audited, idempotent upsert); bounded the now-reachable loadUserPermissions findMany. Web useCapabilities/useHasPermission + TeamSection "Manage roles" panel (UserRolesManager). Test: users.roles.integration.test.ts (3). 55 existing RBAC tests still green.
- **Wave: CSV import wizard (38->60).** Front door over the existing (already-tested) migration engine. lib/csv-parse.ts (RFC-4180, unit-tested), lib/import-fields.ts (per-entity catalog + autoMap, tested), useMigrations hook, CsvImportWizard (upload->map->run, dedup, live progress, errors.csv), reachable at Settings>Data import (admin). Test: csv-parse.test.ts (7).

## Gates (this shift)
typecheck all-green; lint green; targeted API tests green (notifications 4, user-roles 3, roles/rbac/matrix 55, cross-sell+governance 7, bid-scores 10); web csv-parse 7 + apiMutationBodies 2. DB live (Postgres 5433) used for integration runs.

## NEXT (prioritized remaining salesforce-gap waves)
1. reporting-dashboards (42) — report-builder UI absent (backend strong); add drill-through; scheduling is cosmetic. LARGE UI wave.
2. search-nav-copilot (52) — broaden /api/search, copilot depth.
3. list-management (58) — saved/named views beyond Tasks; list virtualization; Accounts grid has no bulk actions/export.

---

**Shift:** Claude (Fable 5 -> Opus 4.8) - 2026-06-12/13 - branch `demo`
**Goal:** Demo-feedback program as the OFFICIAL production build + concreteness pass + enterprise-readiness. Per `walteur-kit/PLAN.md`.

## State NOW - COMPLETE, gates green, PUSHED to origin/demo
14 commits on `demo`:
- Wave 0: analytics report-builder backend (migration 20260612000100).
- Wave R: removed quote-to-cash + RFP-Agent; CRM wording purged. Drop migration 20260612001000.
- Wave M: account-view External/Internal split + CompanyFieldOverride(+revert), real 4-factor Signal Coverage, Top-10 curation, M7 access scoping, M8 bid scoring. Migrations 001500/001600/002000/003000.
- Wave A: cross-sell, sector view, comitology, Spotlight-Ref stub, InfoSearch MCP, 360Learning toolkits, M6 filter rules, feature flags. Migration 20260613000100.
- Concreteness pass: revenue-evolution + win/loss DERIVED from the opportunity pipeline (real, flags default ON); 10 dated historical closed deals + EMEA access group seeded; InfoSearch/360L show labelled SAMPLE previews when unconfigured.
- Enterprise hardening (deep assessment, 43 agents, 34 confirmed fixed): account aggregates moved to Postgres groupBy/date_trunc (fetchAccountPerformance) so win/loss+revenue are exact + uncapped on BOTH cockpit paths; (orgId,companyId) opp index (migration 20260613001000); RBAC gates on account+analytics reads; audit safety-net covers new surfaces; cache bounded; field-override atomic; a11y on the new charts.

## Gates (last run, on HEAD)
typecheck all-green - lint green - API 558 pass/2 skip + worker + web 253 - production web build green - live smoke: per-account AND org-dashboard cockpit agree (CI Financial 67% win rate, 4 revenue months); cross-sell/governance/refs/sector/top/key all 200; InfoSearch+360L previews populated.

## Deploy
Pushed to origin/demo -> Vercel (web) + Railway (api/worker/PG/Redis). api Dockerfile CMD runs `migrate:deploy` on boot, so the 7 new migrations apply in order automatically. Demo DB re-seeds.

## NEXT (Tony decision)
- Before real client data: group security validation of the deploy + configure Access Groups (Settings -> Access groups). Documented in infra/azure/README.md.
- Flags WIN_LOSS/SHOW_REVENUE default ON (pipeline-derived, real). INFOSEARCH_ENABLED / LMS_360L_ENABLED off until creds; sections show sample previews meanwhile.

## Deferred (documented, accepted/v2)
In-app director notification for bid overrides; redis pub/sub scope-cache invalidation; SSRF resolved-IP recheck on outbound webhooks; standalone org-wide governance page; opportunity detail access-scoping; squash of migrations 001500+001600. None enterprise-blocking. See walteur-kit/enterprise-assessment.json + program-review.json.

## Watchouts
- Prisma migrate dev interactive-blocked on this shell -> migrate diff --from-url + migrate deploy (used for all 7).
- 360L_* env names digit-first (invalid) -> LMS_360L_*.
- tsx server has no hot-reload; reboot to pick up API changes when smoking live.
