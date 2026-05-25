# Playwright Resolution Under pnpm

**Problem:** Web E2E specs failed before collection with `@playwright/test does not provide an export named 'test'`. The E2E `tsconfig.json` pinned `@playwright/test` through a pnpm internal `.pnpm/...` path, bypassing normal package export resolution.

**Fix:** Let Node and Playwright resolve `@playwright/test` through the package dependency graph. Do not alias test-runner packages to pnpm internals in `paths`.

**Why it works:** pnpm's internal store layout is an implementation detail. Direct aliases can point the TypeScript/transpilation layer at the wrong module entry and break ESM named exports even when `node` can import the package normally.

**Validation:**

- `pnpm --filter @bidstack/web e2e -- leads.spec.ts opportunities.spec.ts tasks.spec.ts --project=chromium-desktop --reporter=list --trace=off`
- Keep E2E specs asserting the intended accessibility contract, not stale ARIA roles.
