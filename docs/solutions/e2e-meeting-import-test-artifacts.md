# E2E Meeting Import Test Artifacts

## Problem

Meeting-import browser and API tests use production-like flows against the shared seed organization. When those tests create contacts, notes, risks, tasks, or enrichment rows and do not clean them up, later list-view and visual baseline tests read polluted CRM data.

The failure can look like a UI regression, especially in responsive screenshots, because rows such as `E2E Buyer`, `Attendees: ...`, `Risk: ...`, or `Meeting Import ...` appear in otherwise curated seed-data views.

## Rule

Before updating screenshots, rule out shared test-data pollution.

Any test that writes into the shared seed org must clean up its own explicit fingerprints before and after the test. Prefer exact or prefix-based test markers, never broad deletes.

## Pattern

- Use a browser-side cleanup helper for E2E flows that can call the public API with the same test auth context.
- Use Prisma cleanup only inside API tests, and only for records with explicit test fingerprints.
- Run cleanup both before and after mutating tests so old artifacts do not poison a fresh run and new artifacts do not poison the next suite.
- Keep visual snapshot updates limited to genuine UI changes after data pollution has been removed.

## Verification

For the current fix:

- Full web E2E passed via `pnpm --filter @bidstack/web e2e`.
- Web typecheck and lint passed.
- API typecheck passed.
- `pnpm --filter @bidstack/api exec vitest run src/routes/notes.test.ts --reporter=dot` passed 7/7.

## Follow-Up

The long-term enterprise-grade fix is isolated test tenants or a safe E2E reset endpoint. The current cleanup is intentionally narrow because destructive cleanup of shared CRM data is not acceptable.
