# BATON — BidStack demo-feedback program (WALTEUR)

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
