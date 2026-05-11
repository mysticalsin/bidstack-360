# Closed Zod enum drifted away from the seed → 500 on read

**Problem:** `POST /api/opportunities` succeeded against Postgres (Prisma
allowed any string for `industry`), but reads returned 500 with a Zod parse
failure on the response serializer. The seeded Logistec row had
`industry: 'transportation'` and MAPFRE had `industry: 'insurance'`, neither
of which were in `Industry` (10 values at the time). The bug only surfaced
once the integration test exercised the read path.

**Diagnosis:** the enum lives in **two places**:

1. The Zod enum at `packages/shared/src/schemas/opportunity.ts` — used by the
   API serializer + MCP tools + frontend client.
2. The string fixtures at `packages/db/src/seed-data.ts` — written directly
   via Prisma, which doesn't validate against the Zod enum.

When the seed grew faster than the schema, the boundary at the API serializer
caught the drift but only at runtime, only on the read path, only if you
happened to fetch a drifted row. Easy to miss in dev, lands in prod.

**Fix:** widened the enum to 16 values (added `insurance`, `transportation`,
`logistics`, `media`, `real_estate`, `professional_services`) **and** added
a parse-the-fixtures unit test at `packages/db/src/seed-data.test.ts`:

```ts
import { Industry, OpportunityStage, Sentiment, TaskStatus } from '@bidstack/shared';
import { fixtureOpps, fixtureContacts, fixtureTasks } from './seed-data.js';

it('every fixtureOpp.industry parses against shared.Industry', () => {
  for (const o of fixtureOpps) {
    const result = Industry.safeParse(o.industry);
    expect(result.success, `${o.code} industry "${o.industry}" not in enum`).toBe(true);
  }
});
```

That test would have failed at `pnpm test` time (no Postgres needed) before
the bug ever reached the integration tier.

**Why it works:** the test pulls the same enum the API serializer uses and
the same fixture array the seed writes — there's literally no way for them to
drift without the test failing. Vitest runs fixture-only assertions in
milliseconds, so it's cheap to keep in CI.

**Prevention rule** (also logged in `MISTAKES.md` 2026-05-10 TESTING):

> When extending a closed enum that constrains an external boundary
> (HTTP / GraphQL / MCP input), grep every fixture, seed, and migration for
> literal values of that enum and add a parse-the-fixtures unit test so the
> build fails on drift. Treat the enum and the seed as one change.

**Where else this pattern applies:** any time we add another closed enum
(`OpportunityStage`, `TaskStatus`, `Sentiment`, future `LeadSource`, etc.),
add a matching `safeParse` loop in `seed-data.test.ts`. The boilerplate is
worth it — the alternative is a 500 in prod and an unhappy stakeholder.
