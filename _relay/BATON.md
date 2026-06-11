# BATON — BidStack 360 WALTEUR full review/fix

**Shift:** Claude (Fable 5) · 2026-06-10 · branch `demo`
**Goal:** Full CRM review + fix all issues (WALTEUR v8.5 brownfield) + deploy demo

## State NOW — DONE, ready to deploy
- 54-finding audit (10-dimension subagent fan-out + adversarial verify) → fixed across 5 waves. Full data: `walteur-kit/audit-findings.json`. Plan + status: `walteur-kit/PLAN.md`.
- Gates GREEN: `pnpm typecheck` ✅ · `pnpm lint` ✅ · API tests 535 pass / 2 skip ✅ · worker tests 216 ✅ + new migration helper tests 9 ✅ · web unit 256 ✅ · `build:demo` ✅.
- 8 fix commits on `demo` (unpushed): build baseline, wave-1 criticals, wave-2 majors, wave-3 UX, wave-4 perf, reports CTA, queryCache, undo fix, worker tests.

## Deploy architecture (DEPLOY.md)
- **Vercel** = SPA (`apps/web`, root dir, `build:demo`, env `VITE_API_URL`→Railway). Git-integration on branch `demo`.
- **Railway** = api + worker + Postgres + Redis (Docker targets `api`/`worker`). Git-integration on branch `demo`.
- **Deploy = push `demo` to origin** → both rebuild. NO new Prisma migration this session (schema untouched) → no migrate:deploy handoff needed.

## NOT included in deploy (surface to Tony)
- `apps/web/src/components/login/Hero.tsx` — Tony's UNCOMMITTED login tweak (unstaged). Push uses the COMMITTED Hero. If Tony wants the tweak live, commit + push it. (P4 perf dedup of framer-motion in this file also deferred for the same reason.)

## Report-only / out-of-scope (new features, not defects)
- Analytics report-builder + custom dashboards cluster (`/api/reports*`, `/api/dashboards*`) — frontend-only, no backend. Kept out of nav + dead CTA removed. Needs a query engine + 2 Prisma models + migrations to build.
- `.github/workflows/ci.yml` targets non-existent `main` branch (no PR/push gates run). CLAUDE.md forbids workflow edits without coordination → REPORT. Fix: change `branches: [main]` → `[demo, feat/wave9-rfp-engine]` (or the real default).
- Email send integration, duplicate-merge UI — benchmark gaps, not defects.

## Next action
`git push origin demo` → watch Vercel + Railway deploys.
