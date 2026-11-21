# Sweep 04 — business logic, edges, and numbers

Lens: totals, rates, stages, money math, calendars, empty values, names, deleted parents, and implicit state machines.

Base: `main` at `40b13242` (merge of #70). Synthetic data and unit tests only. This environment has no Docker and no Postgres, so the API and web app were not booted and no database integration test was run. Evidence is the failing assertion before the fix, the file and line, and the unit test that is green on the head SHA.

Stage classification is not reimplemented here. #381 adds `stageOutcome` in `packages/shared/src/stage-outcome.ts`. #382 uses it for named open stages on the chart. #378 uses it for `GET /api/opportunities/summary`. Those files were not edited.

## Fixed

### 1. High — "Closed this quarter" counted edits, on a UTC quarter

The dashboard detail is "N closed this quarter" (`OrgCommandHero`). `getPipelineKpis` counted `closed_won` rows with `updatedAt >= quarterStart()`. `quarterStart` is UTC month arithmetic (`packages/shared/src/utils/index.ts`).

A win from last year that was edited today counted. A loss closed this quarter did not. `2026-01-01T02:00:00.000Z` is still 31 Dec 2025 23:00 in America/Sao_Paulo, but the UTC quarter called it 2026-Q1.

Win/loss date filters used `T00:00:00.000Z` through `T23:59:59.999Z`, and quarter labels used `getUTCMonth`. The same instant was filed in 2026-Q1 and dropped from a "recorded to 2025-12-31" filter.

Fix: `quarterBounds` and `dateOnlyRange` use `org_settings.timezone` (default America/Toronto). The count is `closedAt` inside that quarter, for `closed_won` and `closed_lost`.

Red: with the UTC month, that instant returned `2026-Q1`. Expected `2025-Q4`.

- PR: https://github.com/mysticalsin/bidstack-360/pull/384
- Head: `8e9e3719db327e229b23632531bd3f6c5af98b6f`
- Tests: `packages/shared/src/utils/org-calendar.test.ts` (6 passed, including a 400-day hour walk in America/Sao_Paulo). `apps/api/src/services/reports/funnel.service.test.ts` (the São Paulo close window is `2025-10-01T03:00:00.000Z` inclusive to `2026-01-01T03:00:00.000Z` exclusive).

The close count still uses the enum terminals, not `stageOutcome`. A custom lost stage in that count is covered by #381/#382. A follow-up can stack on #381. This PR does not add a stage predicate.

### 2. High — Win/loss totals stopped at 1,000 rows

`GET /api/win-loss/analysis` took 1,000 rows and aggregated that page (`ANALYSIS_SCAN_CAP` in `apps/api/src/routes/win-loss.ts`). `GET /api/win-loss/patterns` grouped every row. Past 1,000 recorded outcomes the win rate, quarter buckets, and reason totals were short. The page never read `truncated`.

The query guard still caps one `findMany` at 1,000. The read now walks pages until a short page. Totals, quarters, reasons, competitors, and cycle days include every matching record. The recent table is still the newest 50. `truncated` stays on the wire and is false.

`winRatePct` is locked for the empty and closed-only books: null when nothing is decided, 100 for one win, 0 for only losses, 33.3 for 1 of 3, 66.7 for 2 of 3. Those four results were already what the formula produced. The bug was the page, not the formula. The tests now fail if a stuck cursor is counted twice or the 1,001st row is dropped.

- PR: https://github.com/mysticalsin/bidstack-360/pull/386
- Head: `5c46c69adb1e4e9a88ad9bb928ea30663b0716fb`
- Tests: `apps/api/src/routes/win-loss.helpers.test.ts` (5 passed). `win-loss-truncation.integration.test.ts` expects `totalLost` 1001, `winRatePct` 0, and quarter buckets that sum to 1001. That test skips without Postgres.

#384 and #386 both edit `win-loss.ts` (calendar versus paging). They are separate drafts from `main`.

### 3. High — RFP orchestration could rewind a gate

Three writes had no from-state.

- Approve-drafting set `running` by id (`apps/api/src/routes/rfp-pipeline.ts`). A concurrent final approval, or a pipeline already through `qa_review`, was pulled back to drafting.
- A second start for the same RFP request rewrote `approved`, `completed`, and `awaiting_approval` to `running` (`ON CONFLICT` in `apps/worker/src/queues/rfp-orchestrator.ts`).
- A failed job set `failed` with no from-state, so the mark could land on a terminal row.

`rfpTransition` is the table. Resume drafting is `awaiting_approval` without `qa_review`. Final approval is that status with `qa_review`. Restart is only `queued`, `running`, or `failed`. Fail is only `queued` or `running`. An unknown stored value is refused and not rewritten. The writes compare-and-set. A restart that does not match does not retry.

- PR: https://github.com/mysticalsin/bidstack-360/pull/390
- Head: `3bea60874a3344885ad2cfca2f7de288e15ddca5`
- Tests: `packages/shared/src/state-machines/rfp-orchestration.test.ts` (4 passed, full state × event × `qa_review` cross product). Worker orchestrator tests: 10 passed.

Other phase workers (section planning, legal scan, requirement extract) still assign a state without a from-list. Those were not changed.

Opportunity stage is not a machine. The inventory says it stays open. No stage guard was added.

### 4. Medium — The tasks report marked a due-today task overdue

`getTasksReport` used `dueDate < now`. `due_date` is a date. A task due today was overdue from 00:00 UTC. The task summary already uses `due_date <` the UTC day (`buildTaskSummary` in `apps/api/src/routes/tasks.ts`). The two overdue numbers disagreed.

`2026-11-21T02:00:00.000Z` is still 20 Nov in America/Sao_Paulo. The report was using the timestamp. It now uses midnight UTC of the current UTC day, the same cut as the summary. A task due that UTC day is not overdue.

This does not change the Tasks badge, `openTasksForUserWhere`, or `apps/web/src/lib/format.ts`. Those are #375.

- PR: https://github.com/mysticalsin/bidstack-360/pull/393
- Head: `f50aff4feff70dc67ea49b1190bff0b158de2a85`
- Tests: `packages/shared/src/utils/task-overdue.test.ts` (3 passed). `apps/api/src/services/reports/funnel.tasks.test.ts` (the cut at 02:00 UTC is `2026-11-21T00:00:00.000Z`, not 02:00).

### 5. Medium — Deleting an account left its open deals on the pipeline

`DELETE /api/v1/companies/:id` set `deletedAt` and did not look at deals (`apps/api/src/routes/companies.ts`). The account left the account list. The deals stayed. The delete now returns 409 while the account has open deals. A won or lost deal does not block it.

The count uses the enum terminals `closed_won` and `closed_lost`, which is what the pipeline KPI already uses. It does not add a stage predicate. Custom lost stages are #381.

The opportunity list was not filtered. #378 and #381 own that route. An account that was deleted before this guard still has its open deals on the list and in the pipeline KPI.

- PR: https://github.com/mysticalsin/bidstack-360/pull/394
- Head: `7d60de20827c51153bbd0e65aea5dec5d0d51033`
- Tests: `apps/api/src/routes/companies.delete-guard.test.ts` (2 passed).

### 6. Medium — Weighted pipeline rounded in float, then to the cent

`getPipelineKpis` summed `(value_micros::float8 / 1e6) * (probability::float8 / 100)` and then `Math.round(weighted * 100) / 100`. 1% of 1.50 (1,500,000 micros) became 0.02. A sum past 2^53 rounded before the probability was applied.

The SQL sum is now `value_micros * probability / 100` in integer micros, returned as text, then `microsToUnits` once. Probability 0 adds nothing. Probability 100 keeps the value. 1% of 1.50 stays 0.015.

This is the pipeline KPI. It is not the filtered-list weighted total in #378, and it does not change money formatters (#374).

- PR: https://github.com/mysticalsin/bidstack-360/pull/396
- Head: `db5c290c16b0ef9f5a6f45d68fc35b72f4f165a4`
- Tests: `packages/shared/src/utils/money.test.ts` (19 passed). `funnel.service.test.ts` reads `weightedMicros: "15000"` as `0.015`.

#384, #393, and #396 each edit `funnel.service.ts` from `main` (close window, overdue cut, weighted sum). Expect a conflict when more than one merges.

## Covered

| # | Finding | Status |
| --- | --- | --- |
| 7 | Filtered opportunity totals were the current page. | Covered by #378 (`GET /api/opportunities/summary`). Supersedes #58. |
| 8 | Account pipeline summed a 100-deal sample and presented it as the book. | Covered by #59 (sample-full label). |
| 9 | Account open total dropped a deal outside the latest 500 and overflowed int64. | Covered by #357. |
| 10 | A live lost stage still looked open. A named open stage was missing from the chart. Both flags set: lost wins. A deleted stage row stays open. | Covered by #381 and #382 (`stageOutcome`). Supersede #71 and #72. |
| 11 | Tasks badge and Tasks page counted different sets, and a date-only due day shifted in America/Sao_Paulo. | Covered by #375. Date formatters and the open-tasks predicate were not edited. |
| 12 | Amounts were labelled in the header currency, and mixed currencies were summed on display. | Covered by #374 (`Money`, no silent conversion). Formatters were not edited. |
| 13 | #353–#367 | Reviewed. Boot, copy, layout, demo mode, and runtime guards. Not this lens, except #354 (sample margin label) and #357 (open total), which are covered above. |

Dashboard win rate for zero closed deals is already null ("no closed bids") in `deriveWinRate`. The account header shows an em dash when `closedCount` is 0 (`PageHead`). `WinLossCard` renders nothing when won + lost is 0. One win is 100. A closed-only book is 0. Those paths were not given a second implementation. The win/loss formula is now tested on #386.

Integer dashboard win rate versus one decimal on the win/loss page (33 versus 33.3 for 1 of 3) is the two existing contracts. Not changed.

## Recorded, not changed

### 14. Low — Non-latin account names collapse to one key

`normalizeAccountName` (`packages/shared/src/utils/index.ts`) keeps only `a-z` and `0-9`. "São" becomes `s-o`. A name in Arabic or Hebrew becomes an empty key, so two different accounts share it. The key is stored. Changing it would split existing joins. Not changed.

### 15. Low — RFP phase workers other than start, fail, and approve-drafting

`rfp-section-planning.ts`, `rfp-legal-scan.ts`, and `rfp-requirement-extract` still assign `rfp_orchestrations.state` without the from-list. #390 guards the three moves that rewind a gate. The others are still open.

## How this was checked

Unit tests listed on each PR, run with Node 24 and pnpm 10.27. No Postgres, so `win-loss-truncation.integration.test.ts` was not executed. The web app was not started.
