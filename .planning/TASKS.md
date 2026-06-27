# Production-hardening loop — 2026-06-26

Doable-here fixes from the QA + Azure audit. Azure validate/deploy, Clerk-prod,
Front Door domain, passwordless Postgres, App Insights-verify, load/restore tests
are DEFERRED (need a subscription / prod env).

- [x] T1 — Top-Accounts empty-state copy (don't claim "add opportunities" when they exist) · PM-01b
- [x] T2 — Remove dead `useGoals` hook (`/api/goals` 404, orphaned) · F7
- [x] T3 — Saved-view per-user count cap + filters total-size cap · F6
- [x] T4 — Notification partial-unique dedupe index + worker P2002 catch (I3); index applied + verified
- [x] T5 — opp↔Company linkage DONE (T5b seed + T5a runtime link-only-if-exists); Top-Accounts/Sector/KAM populate · F2

## Deferred (need decision / infra)
- Forecasts derive from pipeline (F8) — product design, /adhd-worthy
- Azure `az bicep build`/what-if/deploy, Clerk prod wiring, Front Door custom domain,
  passwordless Postgres token provider, CD activation, load/perf + restore tests
