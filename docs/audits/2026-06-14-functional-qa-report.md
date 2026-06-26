# Functional QA Report - 2026-06-14

## Scope

Deep functional QA for high-risk CRM flows: dashboard shell, topbar controls,
opportunities list actions, import/export, create dialogs, pipeline kanban,
drag/drop, keyboard stage movement, mobile toolbar fit, service worker reload,
and long-lived cache/session freshness.

## Issues Fixed

1. Browser HTTP cache could serve stale authenticated API JSON.
   - `apps/web/src/lib/api.ts` now sends `cache: 'no-store'` for API and export fetches.
   - `apps/web/src/hooks/useOpportunities.ts` refetches when mounted over cached opportunity data.
   - Regression: `apps/web/e2e/flows/pipeline.spec.ts` warms the list, creates a deal through the API, opens pipeline, and requires the new card to render.

2. Service worker intercepted sensitive API/export traffic after the page had been open.
   - `apps/web/public/sw.js` now bypasses API/data/auth/export requests and cross-origin requests.
   - App shell cache version aligned in `apps/web/src/main.tsx`.

3. CSV export streamed outside Fastify response handling.
   - `apps/api/src/routes/opportunities.export.ts` now streams through Fastify so CORS/security headers stay attached.

4. Pipeline board did not preserve configured empty stages and could keep stale nested stage data after moves.
   - Pipeline/list stage options now use configured stages as source of truth.
   - Stage mutation now keeps `pipelineStage`, `pipelineStageId`, and legacy `stage` coherent.

5. Pipeline drag/drop and keyboard QA lacked stable selectors and fixture isolation.
   - Stage columns/dropzones/cards now expose stable `data-testid` and stage/opportunity ids.
   - E2E creates and cleans its own pipeline fixture instead of mutating seed data.

6. Opportunity code allocation was lexicographic and could collide past `OP-9999`.
   - API allocation now reads the numeric suffix and mints `OP-10001` after `OP-10000`.

7. Responsive opportunity screenshots were polluted by persistent test artifacts and live relative-time text.
   - Responsive specs clean known E2E artifacts and stabilize dynamic screenshot text.
   - Mobile opportunity header actions wrap instead of clipping the primary action.

## Verification

- API typecheck: pass
- API lint: pass
- API focused opportunities integration: 12 passed
- API full test suite: 620 passed, 2 skipped
- Web typecheck: pass
- Web lint: pass
- Web unit suite: 45 files, 287 passed
- Focused E2E controls/pipeline: 8 passed, 1 skipped
- Full Playwright E2E: 241 passed, 30 skipped
- Manual Chromium QA against production preview: pass
  - Topbar theme/help/notifications/currency/quick-add
  - Opportunity import validation, CSV export, new-opportunity dialog
  - Cached-list to pipeline freshness
  - Pipeline drag/drop with API persistence
  - Reload with service worker controlled and API fetches healthy
  - Mobile new-opportunity button visible and inside viewport

## Remaining Risk

This is functional and regression QA, not a 100k-concurrent-user capacity test.
Before a 100k-user launch, run load tests against the deployed topology for API,
Postgres, Redis, asset CDN, Clerk, and export/download paths.

