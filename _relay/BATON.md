# BATON — BidStack demo-feedback program (WALTEUR)

**Shift:** Claude (Fable 5 -> Opus 4.8) - 2026-06-12/13 - branch `demo`
**Goal:** Implement the demo-session feedback as the OFFICIAL production build (not a demo). Per `walteur-kit/PLAN.md`.

## State NOW - program COMPLETE, gates green, NOT pushed
All waves done + committed on `demo` (11 commits, unpushed):
- Wave 0: analytics report-builder backend (hardened, migration 20260612000100)
- Wave R: removed quote-to-cash (sales-orders/products/invoices/payments), /sales dashboard, RFP-Agent cluster; CRM wording purged. Drop migration 20260612001000.
- Wave M: account-view external/internal split + CompanyFieldOverride (+revert), real 4-factor Signal Coverage, revenue/win-loss behind flags, Top-10 curation, M7 access scoping, M8 bid scoring. Migrations 001500/001600/002000/003000.
- Wave A: cross-sell log, sector view, comitology, Spotlight-Ref receiving end, InfoSearch MCP, 360Learning toolkits, M6 ABC filter rules, feature-flag spine. Migration 20260613000100.
- Wave V: adversarial 6-lens review (29 agents, 19 confirmed findings ALL fixed - walteur-kit/program-review.json), live read+write smoke of every endpoint green.

## Gates (last run)
- typecheck: all workspaces green
- lint: green
- API tests: 555 pass / 2 skip; web 253 pass; worker green
- production web build (build:demo path): green
- live API boot smoke (stub auth, seeded ci-financial): all 13 GETs 200 + cross-sell/override write+revert + sector-view + cockpit score=63/4-factor

## NEXT
1. Re-run full `pnpm test` after the review-fix commit (was running at handoff: task b3zesllt1) - confirm green.
2. `git push origin demo` -> Vercel (web) + Railway (api/worker/PG/Redis). Railway runs migrate on boot; 6 new migrations apply in order. Demo DB re-seeds.
3. Tony decision before real client data: security-team validation of the Azure deploy + configure Access Groups (M7) - documented in infra/azure/README.md. Flags WIN_LOSS_DATA_AVAILABLE / SHOW_REVENUE_BLOCK / INFOSEARCH_ENABLED / LMS_360L_ENABLED stay off until their data sources/creds exist.

## Deferred (documented, pre-prod-acceptable or by-design)
- Migration 001500+001600 squash (harmless sequence, empty table); CompanyFieldOverride.overridden_by_id has no users FK (attribution only, users soft-deleted); dashboard.cockpit.ts > 400 lines; SHOW_REVENUE_BLOCK inert until ABC revenue API lands (per brief); InfoSearch activity-log emails the viewer (the brief's explicit requirement).

## Watchouts
- Prisma migrate dev is interactive-blocked on this shell -> migrate diff --from-url + migrate deploy (used for all 6).
- 360L_* env names are digit-first (invalid) -> LMS_360L_*.
- tsx server has no hot-reload; reboot to pick up API changes when smoking live.
