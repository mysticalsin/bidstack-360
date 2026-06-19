# Pipeline Drag-And-Drop QA Gate

## Problem

The pipeline board is a revenue-critical workflow. Keyboard stage movement had
coverage, but pointer/native drag-and-drop could still regress without a focused
browser proof. A broken drop path would make the board feel premium visually but
fail the core Salesforce-class interaction.

## Pattern

- Keep keyboard movement as the accessible path: focus a card and use left/right
  arrows.
- Keep native drag-and-drop as the pointer path: card writes `text/plain`
  opportunity id, column dropzone reads it, then stage mutation persists it.
- Prove both paths against a real API-backed fixture in Playwright.
- Prove failed stage moves roll back both list and detail React Query caches.

## Implementation

- `apps/web/src/hooks/useStageMutation.test.tsx` now covers failed stage moves:
  list cache, detail cache, and count cache stay coherent after rollback.
- `apps/web/e2e/flows/pipeline.spec.ts` now creates a fixture opportunity,
  dispatches native `dragover`/`drop` with `DataTransfer`, asserts the card
  renders in the target stage, and polls the API for the persisted stage id.

## Verification

```powershell
pnpm --filter @bidstack/web exec vitest run src/hooks/useStageMutation.test.tsx --reporter=dot
pnpm --filter @bidstack/web exec eslint --no-ignore --no-warn-ignored src/hooks/useStageMutation.ts src/hooks/useStageMutation.test.tsx src/pages/PipelinePage.tsx src/pages/pipelineBoard/PipelineCard.tsx src/pages/pipelineBoard/StageColumn.tsx e2e/flows/pipeline.spec.ts e2e/pages/PipelinePage.ts
pnpm --filter @bidstack/web exec tsc --noEmit --pretty false
$env:E2E_PORT_OFFSET='130'; pnpm --filter @bidstack/web e2e -- e2e/flows/pipeline.spec.ts --project=chromium-desktop
```

Current proof on 2026-06-18:

- Stage mutation Vitest: 3/3 pass, no React act warning noise.
- Targeted ESLint: pass.
- Web TypeScript: pass.
- Pipeline Playwright on fresh production-preview build: 7 passed, 1 skipped
  for an already-terminal seeded card.

## Release Rule

Do not claim critical controls are QA-complete unless the pipeline browser suite
proves both keyboard and pointer stage movement against API-backed data.
