# Pipeline KPI insertion shifts the loading board

## Evidence (2026-11-04)

`main` remained at `5dbb2bf4351a7c96d91c94fbbea94c55c3b44d13` when inspected.
Its latest E2E run was [41547375073](https://github.com/mysticalsin/bidstack-360/actions/runs/41547375073),
with shard 2 failing `/pipeline` CLS at **0.0818279504** and **0.0814702175**.
The other shards and build/seed passed. PRs #291/#292 are already in this commit.

The retry trace from artifact `13188909700` shows opportunities resolving before
pipeline-stage definitions. `PipelinePage` mounts the KPI row once opportunities
arrive, while the stage query keeps `KanbanSkeleton` visible underneath it.
The skeleton is pushed down by **97 CSS pixels**.

A local production build of the unchanged page, replaying the trace's API
responses and response delays, reproduced **0.0896673193 CLS**. The browser's
`layout-shift` observer attributed **0.0410307448** to the skeleton heading/grid
moving from y=207/271 to y=304/368. This is a real loading-layout defect, not
evidence of a database failure or a reason to relax the quality budget.

## Correction

Render the existing four KPI cards while opportunities are loading, using the
existing ellipsis values until their data is ready. The loaded card markup,
branding, two/four-column responsive grid, controls and keyboard behavior stay
the same. The existing CLS threshold and full-load measurement remain **0.05**.

The performance report now includes shift sources and their rectangles, and
records an exceeded CLS budget as `fail` rather than `pass`.

The new browser regression holds opportunities and stage definitions separately.
It verifies four pending KPI values, releases opportunities first, requires the
loading board's vertical position to remain within one pixel, then releases
stages and verifies the real board. It checks the data-loading transition's CLS
at 1280px and 390px; the existing route test continues to measure full-load CLS.
The regression fails on the original page because the pending KPI row is absent.

## Verification

Local environment: Node 24.22.1, pnpm 10.27.0, Playwright 1.59.1, headless
Chromium 153.0.8010.0, production Vite build, captured CI API responses.
CI used Chromium 147; these local results are not a fresh full-stack CI pass.
The standard browser download returned invalid archives, so the local browser
was supplied by `@sparticuz/chromium` outside the repository. No dependency or
workflow configuration was changed.

| Check | Result |
| --- | --- |
| Original page, local observer | CLS 0.0896673193; KPI shift 0.0410307448 |
| Fixed page, local observer | CLS 0.0409936449 |
| Fixed existing pipeline CLS test | CLS 0.0406851874, passed |
| Fixed existing pipeline LCP test | 1740ms, passed (2000ms budget) |
| Desktop loading transition regression | Passed; transition CLS 0.0000128573 |
| Mobile loading transition regression | Passed; transition CLS 0 |
| Pipeline page/card/caption unit tests | 8 passed across 3 files |
| Web TypeScript and focused E2E TypeScript | Passed |
| Focused ESLint and diff whitespace check | Passed |
| Shared build and production Vite build | Passed; existing chart/vendor circular-chunk warning remains |

Commands: `pnpm --filter @bidstack/shared build`,
`BIDSTACK_ALLOW_STUB_AUTH=true VITE_AUTH_MODE=stub pnpm --filter @bidstack/web exec vite build`,
`pnpm --filter @bidstack/web exec tsc --noEmit`,
`pnpm --filter @bidstack/web exec vitest run src/pages/PipelinePage.test.tsx src/pages/pipelineBoard/PipelineCard.test.tsx src/pages/pipelineBoard/pipeline-board-caption.test.ts`,
and Playwright `performance/core-web-vitals.spec.ts --grep 'pipeline:'` with a
temporary local config pointing to the replay server and installed browser.

## Remaining limits

- Retrying the failed hosted jobs was authorized and attempted. Attempt 2 stopped
  in checkout: `fatal: No url found for submodule path 'BIDCRM-design' in .gitmodules`.
  It never ran Playwright and supplies no new CLS measurement.
- Mobile full-navigation CLS was 0.086425 and 0.118608 in local probes, before
  the gated data transition. Attribution points to the initial body offset and
  the late app-shell banner. The mobile transition regression does not certify
  full-navigation mobile CLS. Those separate startup shifts remain unresolved.
- The correction needs a successful hosted E2E run before it can be described
  as fully verified. This is not a production-readiness claim.
