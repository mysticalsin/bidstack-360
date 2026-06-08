# Settings admin reads must be bounded and schema-valid

**Problem:** Settings can look visually healthy while background admin panels fail. The lead rot config, email template, and tag panels returned 400s because their API routes used unbounded `findMany` calls. Lead rot also returned invalid synthetic ids for fallback rows, which caused response serialization to fail with a 500.

## Fix

- Add explicit `take` limits to tenant-scoped settings reads:
  - Lead rot config: `take: LeadStatus.options.length`
  - Email templates: `take: 200`
  - Tags: `take: 250`
- Keep fallback rows schema-valid. If a route returns deterministic placeholder records, their ids must still match the public response schema.
- Add an API regression test that hits every Settings support read used by the frontend.

## Prevention rule

The development unbounded-query guard is a product-quality tool, not noise. Do not bypass it. Every admin read must declare its maximum shape, and Settings smoke must capture network responses because a rendered settings shell can hide broken panels.

## Validation

- `pnpm --filter @bidstack/api typecheck`
- `vitest run src/routes/settings-support.integration.test.ts src/routes/opportunities.integration.test.ts`
- Browser smoke for `/settings`
- Broad route smoke across CRM navigation with no 4xx/5xx responses

## Files affected

- `apps/api/src/routes/lead-rot.ts`
- `apps/api/src/routes/email-templates.ts`
- `apps/api/src/routes/tags.ts`
- `apps/api/src/routes/settings-support.integration.test.ts`
