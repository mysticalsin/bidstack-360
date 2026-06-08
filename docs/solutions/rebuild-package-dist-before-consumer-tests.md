# Rebuild Workspace Package Dist Before Consumer Tests

## Problem

Consumer packages import workspace libraries through each package's exported
entry point. For `@bidstack/db`, that is `packages/db/dist/index.js`.

The root `pnpm test` script built `@bidstack/shared`, `@bidstack/dust-client`,
and `@bidstack/odoo-mcp-client`, but not `@bidstack/db`. API tests could
therefore run against stale DB package output even after DB source changes.

## Solution

Build `@bidstack/db` before worker/API/MCP/web tests in the root test gate:

```bash
pnpm --filter @bidstack/db build
```

This makes `pnpm test` validate the code that downstream packages actually
import.

## Verification

- `pnpm --filter @bidstack/db build`
- Full root `pnpm test`
- Full root `pnpm typecheck`
- Full root `pnpm build`

## Rule

If a workspace package has `"main": "./dist/index.js"`, root gates that test
consumer packages must either build that package first or use a test resolver
that points to source. Do not trust consumer tests after source-only edits until
the exported dist has been refreshed.
