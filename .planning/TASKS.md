# Production-hardening loop — 2026-06-26

Doable-here fixes from the QA + Azure audit. Azure validate/deploy, Clerk-prod,
Front Door domain, passwordless Postgres, App Insights-verify, load/restore tests
are DEFERRED (need a subscription / prod env).

- [x] T1 — Top-Accounts empty-state copy (don't claim "add opportunities" when they exist) · PM-01b
- [x] T2 — Remove dead `useGoals` hook (`/api/goals` 404, orphaned) · F7
- [x] T3 — Saved-view per-user count cap + filters total-size cap · F6
- [ ] T4 — Notification `(orgId,userId,url)` partial unique index for bid-deadline dedupe · I3
- [ ] T5 — Seed: create Company rows for opp customers + link `companyId` + set `topAccountRank` so Top-Accounts/Sector/KAM populate (durable F2 fix) · then run seed

## Deferred (need decision / infra)
- Forecasts derive from pipeline (F8) — product design, /adhd-worthy
- Azure `az bicep build`/what-if/deploy, Clerk prod wiring, Front Door custom domain,
  passwordless Postgres token provider, CD activation, load/perf + restore tests
