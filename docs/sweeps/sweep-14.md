# Sweep 14 — concurrency

Lens: double-submit, lost updates, import and queue races, stage transitions, cache invalidation, multi-tab sessions, unique-constraint errors, transaction isolation, worker shutdown.

Base: `main` at `40b13242`. Stack: local Postgres 16.15 (port 5432, database `bidstack`, pgvector) and Redis 7.0.15 (port 6380). Synthetic orgs only, via `createIsolatedOrg` (the same generator the API integration suites use). No Clerk key, no paid API, no deploy. `polo-preview`, R2, and Cloudflare were not touched.

Proofs are `Promise.all` of real Fastify requests against that Postgres and Redis. Each finding has a red run recorded below, then a green run on the fix.

## Already covered, not redone

| PR | What it owns |
| --- | --- |
| #411 | L3 race test waited on a one-second poll instead of the enqueue mock |
| #412 | CSV Redis rows left behind on cancel, and a RUNNING import whose key expired |
| #383 | `settings:write` on import start and undo |
| #390 | RFP orchestration from-state table |
| #423 | Stub and demo sign-out across tabs |
| #410 | Stress harness and its measurements |

None of the fixes below edit files those PRs own. None are stacked.

## Findings

| # | Severity | What | PR | Head |
| --- | --- | --- | --- | --- |
| 1 | HIGH | Two company parent edits can point the companies at each other | #495 | `1d500b24ebe07f3c5cc70d8f5b8f2ee37b5c5812` |
| 2 | HIGH | Two mark-done clicks record `task.completed` twice | #496 | `fb45196f58544121b2c8cc8b7ccbd964952ee9a2` |
| 3 | MEDIUM | Two widget saves from one loaded version overwrite each other | #498 | `658d6b022edb0485e82cdd98ce2353311e1ec10e` |
| 4 | HIGH | A cached read that overlaps an invalidation is stored and served | #500 | `861fdaeb5ff40eaee6184e71af6770717b71f6b6` |

## Measurements

### 1. Company parent cycle

`parallel parent edits cannot point two companies at each other`

Red, both writes 200, cycle stored:

```
PATCH /api/v1/companies/b9f20eb4-... 200 in 32ms
PATCH /api/v1/companies/ed12f407-... 200 in 30ms
expected true to be false
expect(parentCycle(stored)).toBe(false)
```

Green:

```
PATCH 400 in 29ms
PATCH 200 in 34ms
Test Files  1 passed
```

`companies.test.ts` plus this file: 6 passed. The second writer takes `pg_advisory_xact_lock` for the org and walks the chain again.

### 2. Task completion

`two parallel mark-done requests record task.completed once`

Red, two outbox rows (`49dc09e4-…`, `75dbe2ea-…`), both `duplicate: false`:

```
PATCH /api/v1/tasks/f0dade74-... 200
PATCH /api/v1/tasks/f0dade74-... 200
expected 2 to be 1
```

Green: one outbox row (`f8a4e8a9-…`). A later patch that sets the title on the already-done task stays at one row. `tasks.integration.test.ts` plus this file: 14 passed. KAM task patch uses the same compare-and-set.

### 3. Widget version

`parallel analytics config saves from one version keep the first and reject the second`
`parallel CRM layout saves from one version keep the first and reject the second`

Red: both pairs returned `[200, 200]`.

Green: both pairs returned `[200, 409]`. With `widgets.test.ts` and `analytics-dashboards.integration.test.ts`: 10 passed. A save that omits `expectedUpdatedAt` still replaces the row.

### 4. Cache fill after invalidation

`does not store a read that was in flight when the org cache was invalidated`

Redis `PONG` on port 6380.

Red: the GET after the mutation returned `{ value: 1 }`. 1 failed, 5 passed.

Green: `{ value: 2 }`, handler ran again. 6 passed.

## Looked at, not filed

- `P2002` in the API error handler is already 409. Opportunity codes and service-case numbers retry that collision inside the request. No path found that turns a unique violation into a 500, and no new 500 was produced by the parallel writes above.
- Opportunity stage moves already compare-and-set `stage` and `pipelineStageId`. #390 covers RFP runs. #410 already measured two stage moves as 200 and 409.
- CSV start, cancel, and undo races are #411, #412, and #383. Migration chunk retry already resumes from the chunk cursor instead of reinserting.
- Whitespace accept already locks the agreement row before creating the action and the opportunity.
- The idempotency plugin takes the in-flight key with Redis `SET NX`.
- Worker shutdown calls `worker.close()` on the registered workers and then exits, with `WORKER_SHUTDOWN_TIMEOUT_MS` defaulting to 120s. No mid-job double apply was reproduced beyond the task and cache cases above.
- Multi-tab sign-out is #423.
