# Strategic Account Signal Explainability

## Problem

Strategic account surfaces can feel premium visually while still behaving like
static reports. If Key Accounts, Top Accounts, and Sector View only show counts,
bars, and percentages, users still have to infer why a signal is weak and what
the next action should be.

## Pattern

- Encode reason and next action in pure, deterministic helpers.
- Keep each signal local to the score or row it explains.
- Use the same insight treatment across related account surfaces.
- Show warning and success states, not just weak-state alerts.
- Keep text wrapping safe with `overflow-wrap: anywhere` and at least 44px
  interaction-safe height on compact guidance blocks.

## Implementation

- `apps/web/src/pages/accountsPage/strategicSignals.ts` contains the pure rules:
  `keyAccountSignal`, `topAccountSignal`, `sectorCoverageSignal`, and
  `sectorAccountSignal`.
- `apps/web/src/pages/accountsPage/StrategicSignalInsight.tsx` renders the
  shared guidance block with accessible labels.
- `apps/web/src/pages/KeyAccountsPage.tsx` renders account-level strategic
  coverage guidance.
- `apps/web/src/pages/TopAccountsPage.tsx` explains curated versus auto-ranked
  account readiness.
- `apps/web/src/pages/SectorViewPage.tsx` explains sector coverage gaps and
  account-row reliability gaps.

## Verification

- Unit tests protect deterministic signal contracts.
- Targeted ESLint and web typecheck protect integration.
- Browser QA must cover desktop plus a phone-width viewport and verify no
  horizontal overflow.
- Playwright account/SERUM E2E must prove the existing industry filters and
  account cockpit flows still operate.

## Reuse Rule

Any future CRM account, industry, source, or confidence score should expose a
nearby reason and next action before being considered complete.
