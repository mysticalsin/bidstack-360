# Pipeline Outcome Buttons QA Gate

## Context

Opportunity detail pages need explicit terminal outcome controls. A user should
not have to infer that closing revenue is hidden inside a generic stage picker,
and QA should not depend on whichever seeded deal happens to render first.

## Problem

The pipeline browser suite had coverage for board rendering, card navigation,
keyboard movement, and pointer drag/drop, but the "mark won" path could skip when
the first seeded card was already terminal. The detail page object expected
`Mark Won` and `Mark Lost` buttons, while the product screen only exposed the
stage selector.

This left two risks:

- Revenue terminal actions were not first-class UI controls.
- Browser proof for won/lost depended on seed data instead of deterministic
  fixture setup.

## Pattern

- Put critical revenue outcomes in explicit action buttons.
- Route terminal moves through the domain stage-transition endpoint so
  `pipelineStageId` remains coherent with custom pipeline stages.
- Disable terminal controls once an opportunity is won or lost.
- Surface mutation failures with a toast.
- Use API-backed fixtures for browser tests, then delete them in `finally`.
- Assert durable semantics (`pipelineStageId` plus `pipelineStage.isWon` or
  `pipelineStage.isLost`), not display labels such as "Closed Won".

## Implementation

- `apps/web/src/pages/OpportunityDetailPage.tsx`
  - Adds `Mark Won` and `Mark Lost` buttons to the opportunity header.
  - Uses `useStageMutation` with `closed_won` and `closed_lost` so the API
    resolves the default terminal pipeline stage.
  - Shows disabled `Won` or `Lost` terminal status buttons after closure.
  - Shows an error toast when the terminal move fails.
- `apps/web/e2e/pages/DealDetailPage.ts`
  - Keeps the page object API for terminal actions.
  - Scopes optional confirmation clicks to actual dialogs so the action button
    is not clicked twice.
- `apps/web/e2e/flows/pipeline.spec.ts`
  - Creates deterministic opportunities in an open stage.
  - Verifies both won and lost terminal paths through real UI buttons.
  - Polls the API until pipeline-stage semantics are persisted.

## Verification

- `pnpm --filter @bidstack/web exec vitest run src/hooks/useStageMutation.test.tsx --reporter=dot`:
  3/3 pass.
- `pnpm --filter @bidstack/web exec eslint --no-ignore --no-warn-ignored src/pages/OpportunityDetailPage.tsx src/hooks/useStageMutation.ts e2e/flows/pipeline.spec.ts e2e/pages/DealDetailPage.ts e2e/pages/PipelinePage.ts`:
  pass.
- `pnpm --filter @bidstack/web exec tsc --noEmit --pretty false`: pass.
- `$env:E2E_PORT_OFFSET='133'; Remove-Item Env:E2E_AUTH_MODE -ErrorAction SilentlyContinue; pnpm --filter @bidstack/web e2e -- e2e/flows/pipeline.spec.ts --project=chromium-desktop`:
  fresh production-preview run, 9/9 pass.
- `$env:E2E_PORT_OFFSET='134'; Remove-Item Env:E2E_AUTH_MODE -ErrorAction SilentlyContinue; pnpm --filter @bidstack/web e2e -- e2e/flows/pipeline.spec.ts --project=chromium-desktop --grep "mark deal as (won|lost)"`:
  fresh production-preview run, 2/2 pass after adding the failure toast.

## Release Rule

Do not claim critical-control readiness while terminal revenue actions depend on
seed data, skip paths, or generic stage controls. Every terminal outcome needs
explicit UI, a domain-route mutation, and deterministic browser proof.
