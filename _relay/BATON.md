# BATON — BidStack demo-feedback program (WALTEUR)

**Shift:** Claude (Fable 5) - 2026-06-13 - branch `demo` - /goal "Salesforce-level"
**Goal:** Autonomous quality climb vs best-in-class. Benchmark in `walteur-kit/salesforce-gap.json` (scores updated this shift).

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
