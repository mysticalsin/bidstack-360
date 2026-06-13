# BATON — BidStack demo-feedback program (WALTEUR)

**Shift:** Claude (Fable 5) · 2026-06-12 · branch `demo`
**Goal:** Implement Tony's demo-session feedback per `walteur-kit/PLAN.md` (source of truth — read it first).

## State NOW
- Wave 0 done, committed: analytics report-builder backend hardened (35-finding review in `walteur-kit/analytics-wip-review.json`), migration `20260612000100`, 43 tests green.
- Wave R done, committed (`ea82e90e` + `4bfa937a`): quote-to-cash vertical (sales-orders/products/invoices/payments), /sales dashboard + sales-intelligence report family, RFP-Agent cluster (Dust squad + NocoBase) all REMOVED; drop migration `20260612001000` applied to local dev DB; CRM wording purged. Core RFP pipeline + Agent Studio untouched.
- Feature-flag spine ready: env.ts flags (WIN_LOSS_DATA_AVAILABLE, SHOW_REVENUE_BLOCK, INFOSEARCH_ENABLED, LMS_360L_*), `GET /api/v1/config/features` route file (`apps/api/src/routes/config-features.ts`) — NOT yet registered in server.routes.ts; web hook `useFeatureFlags.ts` ready.
- Gates at Wave-R commit: typecheck all-green, lint green, API suite green, web unit 248 green.

## Next (Wave M — account view core, PLAN.md tasks M1-M9)
1. Register configFeaturesRoutes in server.routes.ts.
2. M1 cockpit External Intelligence vs Internal Data split + CompanyFieldOverride model + override flagging.
3. M2 real 4-factor Signal Coverage scoring (replaces hardcoded 72 in dashboard.cockpit.ts:423).
4. M3/M4 revenue + win/loss blocks behind flags (hidden when off — never empty states).
5. M5 Top-10 curation via Company.topAccountRank + admin Settings editor; Top vs Key visual distinction.
6. M6 ABC opportunity filter rules (first GET/PUT /org-settings route).
7. M7 UserGroup access-scoping layer + negative tests.
8. M8 Bid/No-Bid: shared criteria registry (6 brief criteria), breakdown on opportunity detail, below-threshold override w/ mandatory justification.
Then Wave A (A2-A9: cross-sell log, sector view, comitology, spotlight-ref stub, InfoSearch MCP, 360Learning toolkits, migration+seeds) and Wave V (gates, panel, audit, honest report).

## Key context
- Recon maps: `walteur-kit/recon-demo-feedback.json` (14 areas, file-level).
- Scaffold pattern to copy: recon key `scaffold` (Tasks vertical: model->shared Zod->route->hook->page->nav).
- MISTAKES ledger rules in force: bounded reads, org-scope every query, db:generate sequential preflight, >=600s root test timeout, shared build before consumer tests.
- Prisma migrate dev is interactive-blocked on this shell -> use `migrate diff --from-url "$DATABASE_URL" --script > prisma/migrations/<stamp>_<name>/migration.sql` then `migrate deploy` (worked twice).
- Deploy: push `demo` -> Vercel (web) + Railway (api/worker/PG/Redis). Drop migration is destructive on the demo DB (re-seeds, acceptable). NO push yet this shift.

## Watchouts
- A subagent died on account session-limit mid-Wave-R (resets 8pm ET); deletions were finished inline. If spawning agents fails, work inline.
- `.forge/RUN.md` untracked leftover — not part of this program, leave it.
- Brief's `360L_*` env names are digit-first (invalid) -> implemented as `LMS_360L_*` (documented in env.ts).
