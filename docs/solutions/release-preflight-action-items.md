# Release preflight action items

## Problem

Release preflight blockers were machine-checkable but operator-hostile: the
console and artifact promoted blocker ids, while the actionable env var names
were buried in `environmentChecks`.

## Contract

`deploy:evidence:preflight:*` writes:

- `preflightSummary`: failed check counts grouped by operator area.
- `preflightActionItems`: one row per failed required input with `id`,
  `category`, `label`, `requiredEnv`, `present`, `source`, `sensitive`, and
  non-secret `detail`.

The console prints category counts and the first required inputs; the JSON
artifact remains the complete checklist.

## Verification

- `node --check scripts/run-deploy-evidence-bundle.mjs`
- `pnpm deploy:evidence:bundle:selftest`
- `pnpm deploy:evidence:preflight:production` expected block in a shell without
  live release inputs, now with grouped action summary.
