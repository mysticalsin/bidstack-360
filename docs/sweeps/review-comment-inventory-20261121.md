# Open PR review-comment inventory (2026-11-21)

Read-only sweep of every open pull request on `mysticalsin/bidstack-360`. Collected with the GitHub API on 2026-11-21: review threads, review bodies, issue comments, and code-scanning annotations from the head commit's check runs. No review was resolved, and no existing pull request was edited.

Pull requests **#189** and **#280** are parked by Tony. Their findings are listed and counted, and each row is marked parked.

## Totals

| | |
| --- | ---: |
| Open PRs scanned | 64 |
| Items classified | 214 |
| Addressed | 7 |
| Unaddressed | 21 |
| Not-actionable | 186 |

Unaddressed by priority:

| Priority | Count | Of which are on a parked PR |
| --- | ---: | ---: |
| P0 | 1 | 1 (#189) |
| P1 | 8 | 6 (#189 has 5, #280 has 1) |
| P2 | 12 | 5 (#189 has 4, #280 has 1) |

The other 9 unaddressed items sit on active pull requests. Two of the three whole-tree Checkov findings also appear on the parked heads; they are counted once, under the active set, because the same annotation is on many open heads.

10 of the 64 pull requests had no review, no review thread, and no issue comment: #342, #396, #399, #400, #401, #402, #403, #405, #406, #407. #399 still carries the whole-tree Checkov annotations below.

## How an item was classified

An item is one review thread, one non-empty review body, one issue comment, or one distinct code-scanning finding that was not already posted as a review thread.

- **Addressed** when the thread is resolved, GitHub marks it outdated (a later commit changed the cited lines), a reply links the fix, or a later commit on the same pull request changes the cited behavior and the current head shows the fix.
- **Not-actionable** when the text is praise, a status line, a Codex receipt or usage-limit note, a CI score report, or a gate/config notice. Nine empty review bodies are envelopes for inline threads and are not items.
- **Unaddressed** is everything else that asks for a change.

Priority is the author's P0/P1/P2 or the scanner severity when the comment states one (Trivy CRITICAL = P0, HIGH = P1, LOW = P2). Checkov and Semgrep comments that state no severity are assigned here: missing container user is P1, the same class as Trivy's HIGH finding; a missing HEALTHCHECK is P2, the same class as Trivy's LOW finding; a synthetic token in a redaction test is P2.

Copilot, CodeQL, Devin, Inspector, and Sentinel left no review, no issue comment, and no check run on these 64 pull requests. The code-scanning alerts API returned 403, so Semgrep severity is taken from the comment text only.

The 214 items are 23 review threads, 139 issue comments, 4 non-empty review bodies, 3 distinct Checkov findings, and 45 dependency-graph or Node 20 status annotations. The Checkov job repeats those 3 findings as 82 failure annotations (the same files on many heads). Security check runs also attach runner notices (`git` exit 128, the `ubuntu-latest` migration banner). Those notices are status lines and are not given rows.

## The 20 most important unaddressed items

Parked rows are marked. Duplicate-scanner rows are the same defect as an earlier row, posted by a second tool.

| # | PR | Author | Priority | Where | Summary | Link |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | [#189](https://github.com/mysticalsin/bidstack-360/pull/189) parked | github-advanced-security | P0 | `apps/polo-preview/Dockerfile:58` | Trivy DS-0031 CRITICAL: `POSTGRES_PASSWORD` is still baked into an image `ENV` | [comment](https://github.com/mysticalsin/bidstack-360/pull/189#discussion_r4437286029) |
| 2 | [#280](https://github.com/mysticalsin/bidstack-360/pull/280) parked | mysticalsin | P1 | `scripts/lib/postgres-client.sh:47` | A failed restore with empty stderr is reported as success, and any `transaction_timeout` substring is treated as the known SET diagnostic | [comment](https://github.com/mysticalsin/bidstack-360/pull/280#discussion_r4504680201) |
| 3 | [#189](https://github.com/mysticalsin/bidstack-360/pull/189) parked | github-advanced-security | P1 | `apps/polo-preview/Dockerfile:1` | Trivy DS-0002 HIGH: the preview image never sets a non-root `USER` | [comment](https://github.com/mysticalsin/bidstack-360/pull/189#discussion_r4437286022) |
| 4 | [#189](https://github.com/mysticalsin/bidstack-360/pull/189) parked | github-advanced-security | P1 | `apps/polo-preview/Dockerfile.runtime:1` | Trivy DS-0002 HIGH: the runtime image never sets a non-root `USER` | [comment](https://github.com/mysticalsin/bidstack-360/pull/189#discussion_r4437286031) |
| 5 | 39 heads, including parked #280 | github-actions | P1 | `apps/marketing/Dockerfile:1` | Checkov CKV_DOCKER_3: the marketing image has no container user. The job still concludes success | [check on #399](https://github.com/mysticalsin/bidstack-360/pull/399/checks?check_run_id=136707201020) |
| 6 | #58, #61, #67, and parked #280 | github-actions | P1 | `apps/api/Dockerfile:1` | Checkov CKV_DOCKER_3: these four heads still have no container user. Later heads no longer raise this one | [check on #58](https://github.com/mysticalsin/bidstack-360/pull/58/checks?check_run_id=124867890537) |
| 7 | [#73](https://github.com/mysticalsin/bidstack-360/pull/73) | mysticalsin | P2 | `apps/web/src/components/viz/charts.tsx:65` | Account stage bars still format `Number(value)` and never read the exact micros `amount` label | [comment](https://github.com/mysticalsin/bidstack-360/pull/73#issuecomment-6716222662) |
| 8 | [#74](https://github.com/mysticalsin/bidstack-360/pull/74) | mysticalsin | P2 | `apps/web/src/components/viz/bklit-adapters.tsx:83` | Forecast tooltips still format `Number(won)` and `Number(weighted)` and drop the exact or "amount not readable" labels | [comment](https://github.com/mysticalsin/bidstack-360/pull/74#issuecomment-6716220081) |
| 9 | [#64](https://github.com/mysticalsin/bidstack-360/pull/64) | chatgpt-codex-connector | P2 | `apps/web/src/components/positioning/positioning-format.ts:51` | Codex asks to keep EUR conversion on the open-pipeline tile. The reply rejects that: Opportunity has no currency column, and later commits left the sum unspecified | [comment](https://github.com/mysticalsin/bidstack-360/pull/64#discussion_r4435982682) |
| 10 | [#280](https://github.com/mysticalsin/bidstack-360/pull/280) parked | mysticalsin | P2 | `scripts/lib/postgres-client.sh:41` | The timeout-only fixture omits pg_restore's `errors ignored on restore: 1` summary, so the parser rejects the PG17-to-PG16 fallback it claims to allow | [comment](https://github.com/mysticalsin/bidstack-360/pull/280#discussion_r4504680207) |
| 11 | [#389](https://github.com/mysticalsin/bidstack-360/pull/389) | github-advanced-security | P2 | `apps/api/src/lib/oauth-failure.test.ts:8` | Semgrep flags a synthetic Google OAuth access token in the redaction fixture. Severity was not stated | [comment](https://github.com/mysticalsin/bidstack-360/pull/389#discussion_r4650212637) |
| 12 | [#389](https://github.com/mysticalsin/bidstack-360/pull/389) | github-advanced-security | P2 | `apps/api/src/lib/oauth-failure.test.ts:20` | Same rule, on the assertion that the rendered failure must not contain that fixture token | [comment](https://github.com/mysticalsin/bidstack-360/pull/389#discussion_r4650212660) |
| 13 | [#389](https://github.com/mysticalsin/bidstack-360/pull/389) | github-advanced-security | P2 | `apps/api/src/lib/oauth-failure.test.ts:27` | Same rule, on a second fixture whose error value is the token string | [comment](https://github.com/mysticalsin/bidstack-360/pull/389#discussion_r4650212675) |
| 14 | [#189](https://github.com/mysticalsin/bidstack-360/pull/189) parked | github-advanced-security | P2 | `apps/polo-preview/Dockerfile:1` | Trivy DS-0026 LOW: no `HEALTHCHECK` in the preview Dockerfile | [comment](https://github.com/mysticalsin/bidstack-360/pull/189#discussion_r4437286036) |
| 15 | [#189](https://github.com/mysticalsin/bidstack-360/pull/189) parked | github-advanced-security | P2 | `apps/polo-preview/Dockerfile.runtime:1` | Trivy DS-0026 LOW: no `HEALTHCHECK` in the runtime Dockerfile | [comment](https://github.com/mysticalsin/bidstack-360/pull/189#discussion_r4437286043) |
| 16 | 39 heads, including parked #280 | github-actions | P2 | `apps/api/Dockerfile:1` | Checkov CKV_DOCKER_2: no `HEALTHCHECK` on the API image. Same 39 heads as row 5. The job still concludes success | [check on #399](https://github.com/mysticalsin/bidstack-360/pull/399/checks?check_run_id=136707201020) |
| 17 | [#189](https://github.com/mysticalsin/bidstack-360/pull/189) parked | github-advanced-security | P1 | `apps/polo-preview/Dockerfile:60` | Checkov repeat of row 3: no container user | [comment](https://github.com/mysticalsin/bidstack-360/pull/189#discussion_r4437286118) |
| 18 | [#189](https://github.com/mysticalsin/bidstack-360/pull/189) parked | github-advanced-security | P1 | `apps/polo-preview/Dockerfile:60` | Semgrep repeat of row 3: last `USER` is root | [comment](https://github.com/mysticalsin/bidstack-360/pull/189#discussion_r4437288085) |
| 19 | [#189](https://github.com/mysticalsin/bidstack-360/pull/189) parked | github-advanced-security | P1 | `apps/polo-preview/Dockerfile.runtime:5` | Checkov repeat of row 4: no container user | [comment](https://github.com/mysticalsin/bidstack-360/pull/189#discussion_r4437286131) |
| 20 | [#189](https://github.com/mysticalsin/bidstack-360/pull/189) parked | github-advanced-security | P2 | `apps/polo-preview/Dockerfile:60` | Checkov repeat of row 14: no `HEALTHCHECK` | [comment](https://github.com/mysticalsin/bidstack-360/pull/189#discussion_r4437286126) |

One further duplicate is not in the twenty: Checkov also repeats row 15 on `apps/polo-preview/Dockerfile.runtime:5` ([comment](https://github.com/mysticalsin/bidstack-360/pull/189#discussion_r4437286134)). It is the 21st unaddressed item, P2, parked with #189.

Heads that carry rows 5 and 16: #58, #61, #67, #280, #348, #349, #350, #351, #353, #354, #355, #356, #357, #358, #359, #360, #361, #362, #363, #364, #365, #366, #367, #374, #375, #376, #379, #380, #383, #384, #385, #387, #388, #389, #390, #391, #394, #395, #399.

## Addressed

These seven threads are addressed. GitHub still shows the #59, #189 MIME, and #189 worker threads as open.

| PR | Author | Priority | Where | Why it is addressed | Link |
| --- | --- | --- | --- | --- | --- |
| [#189](https://github.com/mysticalsin/bidstack-360/pull/189) parked | chatgpt-codex-connector | P1 | `apps/polo-preview/src/preview-entrypoint.sh:348` | The reply on the worker thread says this head's `types` map already sets the SPA MIME types. The map is in the current entrypoint | [comment](https://github.com/mysticalsin/bidstack-360/pull/189#discussion_r4437295185) |
| [#189](https://github.com/mysticalsin/bidstack-360/pull/189) parked | chatgpt-codex-connector | P2 | `apps/polo-preview/src/preview-entrypoint.sh:456` | A reply at `9fd77cda` said the worker was still missing. Commit `432ff814` after that reply builds and starts `@bidstack/worker`, and the current entrypoint requires `apps/worker/dist/main.js` | [comment](https://github.com/mysticalsin/bidstack-360/pull/189#discussion_r4437295191) |
| [#59](https://github.com/mysticalsin/bidstack-360/pull/59) | chatgpt-codex-connector | P2 | `apps/web/src/pages/accountsPage/AccountsAllSegment.tsx:300` | A reply at `4867a8d` said the latest-100 label still counted older account deals. Later commits keep `deals` equal to the org sample and leave older account rows on `accountDeals` only (`013c9cb`, head `b8a2060`) | [comment](https://github.com/mysticalsin/bidstack-360/pull/59#discussion_r4435933803) |
| [#348](https://github.com/mysticalsin/bidstack-360/pull/348) | github-advanced-security | severity not stated | `apps/api/src/lib/provider-upstream-body.test.ts:10` | Resolved, and outdated | [comment](https://github.com/mysticalsin/bidstack-360/pull/348#discussion_r4631417527) |
| [#348](https://github.com/mysticalsin/bidstack-360/pull/348) | github-advanced-security | severity not stated | `apps/api/src/routes/migrations.public-error.test.ts:12` | Resolved, and outdated | [comment](https://github.com/mysticalsin/bidstack-360/pull/348#discussion_r4631417699) |
| [#348](https://github.com/mysticalsin/bidstack-360/pull/348) | github-advanced-security | severity not stated | `apps/api/src/routes/migrations.public-error.test.ts:76` | Resolved, and outdated | [comment](https://github.com/mysticalsin/bidstack-360/pull/348#discussion_r4631417790) |
| [#367](https://github.com/mysticalsin/bidstack-360/pull/367) | github-actions | severity not stated | `apps/api/src/env.test.ts:8` | Outdated. The cited line on the current head is a `clerk-test-key` fixture, not the stripe-access-token hit | [comment](https://github.com/mysticalsin/bidstack-360/pull/367#discussion_r4648634919) |

The three Semgrep annotations on the #389 head check are the same three open threads in the unaddressed table, so they are not a second set of items.

## Not-actionable

141 conversation items and 45 check annotations. None of them ask for a code change on their own.

| Kind | Count | What it is | Example |
| --- | ---: | --- | --- |
| TSDoc coverage report | 49 | Issue comment. Coverage did not drop against the base | [#189](https://github.com/mysticalsin/bidstack-360/pull/189#issuecomment-6563911257) |
| Lighthouse CI scores | 38 | Issue comment. Score table against the posted thresholds | [#348](https://github.com/mysticalsin/bidstack-360/pull/348#issuecomment-7014589921) |
| Codex review summary | 30 | Issue comment. 18 say the review failed, 12 say it completed. Where a review had findings, those findings are the threads above | [#189](https://github.com/mysticalsin/bidstack-360/pull/189#issuecomment-6563693676) |
| Codex usage limit | 19 | Issue comment. The review did not run | [#280](https://github.com/mysticalsin/bidstack-360/pull/280#issuecomment-6584144667) |
| Codex review receipt | 3 | Review body that only introduces the inline findings on #59, #64, and #189 | [#189](https://github.com/mysticalsin/bidstack-360/pull/189#pullrequestreview-5730215271) |
| Review summary pointer | 1 | #280 review body. It names the two inline defects and adds none of its own | [#280](https://github.com/mysticalsin/bidstack-360/pull/280#pullrequestreview-5816160473) |
| Install notes, author says not a guide change | 1 | `cursor` on #363. `nvm use` loses to an earlier `node` on `PATH`, and Docker does not start without systemd. The comment says this is not a change to the guide | [#363](https://github.com/mysticalsin/bidstack-360/pull/363#issuecomment-7056449912) |
| Dependency graph not enabled or unknown | 42 | Check annotation on `.github`. 37 say the graph is unknown, 5 say dependency review is unsupported | [#348](https://github.com/mysticalsin/bidstack-360/pull/348/checks?check_run_id=135818235636) |
| Node.js 20 deprecation notice | 3 | Check annotation. Actions are forced onto Node 24 | same class of check notice |

49 + 38 + 30 + 19 + 1 = 137 issue comments. Plus 4 review bodies and 45 annotations is 186.

## Pull requests scanned

Thread, issue-comment, and review counts. Titles are the pull request titles on 2026-11-21.

| PR | State | Threads | Issue comments | Reviews | Title |
| --- | --- | ---: | ---: | ---: | --- |
| 58 | ready | 0 | 2 | 0 | Total a filtered opportunity list from every matching row |
| 59 | ready | 1 | 2 | 2 | Label the account pipeline when the deal sample is full |
| 61 | ready | 0 | 2 | 0 | Keep a financial amount when the compact label moves it |
| 64 | ready | 1 | 2 | 2 | Stop labelling an unrecorded amount as US dollars |
| 67 | ready | 0 | 2 | 0 | Keep cockpit revenue when one compact digit moves it |
| 71 | ready | 0 | 2 | 0 | Keep a live lost stage out of the open charts |
| 72 | ready | 0 | 2 | 0 | Show a named open stage on the pipeline chart |
| 73 | ready | 0 | 3 | 0 | Print chart totals from integer micros |
| 74 | ready | 0 | 3 | 0 | Read forecast bars from integer micros |
| 75 | ready | 0 | 1 | 0 | Keep a filing signal amount when compact moves it |
| 189 | ready, parked | 12 | 2 | 5 | Keep the Polo preview running on Cloudflare |
| 280 | ready, parked | 2 | 2 | 1 | Backups: R2 offsite and PG17/16 restore skew |
| 342 | ready | 0 | 0 | 0 | chore(deps): Bump the minor-and-patch group across 1 directory with 52 updates |
| 348 | ready | 3 | 4 | 1 | Keep setup failures as 503 and stop tests sharing one tenant |
| 349 | ready | 0 | 4 | 0 | Fix CSV import mapping on a phone, and make Cancel and Retry finish cleanly |
| 350 | draft | 0 | 2 | 0 | Drop Redis rows when a CSV start loses its claim |
| 351 | draft | 0 | 2 | 0 | Show 100 when a CSV import is complete |
| 353 | ready | 0 | 4 | 0 | fix(polo): boot after a snapshot restore |
| 354 | ready | 0 | 4 | 0 | Show a labelled sample margin on demo key numbers |
| 355 | ready | 0 | 4 | 0 | Show Add widget only to the owner or an admin, and give every widget a report |
| 356 | ready | 0 | 4 | 0 | Keep demo fixture job postings open after a snapshot restore |
| 357 | ready | 0 | 4 | 0 | Keep the open total on the tile, including a deal the latest 500 page drops |
| 358 | ready | 0 | 4 | 0 | Show Polo PreSales as a one-line lockup in the rail and the drawer |
| 359 | ready | 0 | 4 | 0 | Show the task date beside the title |
| 360 | ready | 0 | 4 | 0 | fix(dashboard): drop the how-to lines under the home charts |
| 361 | ready | 0 | 4 | 0 | Show whole pipeline stages at 1280 instead of a sliced column |
| 362 | ready | 0 | 4 | 0 | Put the account filters on one row so the cards are on screen |
| 363 | ready | 0 | 5 | 0 | Document how to install Polo and run it in real mode |
| 364 | ready | 0 | 4 | 0 | Run Polo in real mode unless an admin turns demo data on |
| 365 | draft | 0 | 2 | 0 | Make Polo's database boot an explicit state machine |
| 366 | ready | 0 | 4 | 0 | Drop the helper lines on Pipeline, Opportunities, and Accounts |
| 367 | draft | 1 | 2 | 1 | feat(runtime-mode): explicit data, auth, and deployment guards |
| 374 | ready | 0 | 4 | 0 | Show each amount in its own currency |
| 375 | ready | 0 | 4 | 0 | Fix Tasks badge so it matches the Tasks page |
| 376 | ready | 0 | 4 | 0 | Bound company create when Redis is down |
| 378 | draft | 0 | 2 | 0 | Total a filtered opportunity list from every matching row |
| 379 | draft | 0 | 2 | 0 | Fix date-only values shifting a day west of UTC |
| 380 | draft | 0 | 2 | 0 | Label the account pipeline when the deal sample is full |
| 381 | draft | 0 | 2 | 0 | Keep a live lost stage out of the open charts |
| 382 | draft | 0 | 2 | 0 | Show a named open stage on the pipeline chart |
| 383 | draft | 0 | 2 | 0 | Require settings:write to run or undo an import |
| 384 | draft | 0 | 2 | 0 | Count closes in the org quarter, not UTC edits |
| 385 | draft | 0 | 2 | 0 | Neutralize spreadsheet formulas in org chart and audit CSV exports |
| 386 | draft | 0 | 1 | 0 | Count every closed bid in the win/loss total |
| 387 | draft | 0 | 2 | 0 | Refuse caller-supplied email click redirects |
| 388 | draft | 0 | 1 | 0 | Rewrite the Polo README with how it works and short clips |
| 389 | draft | 3 | 2 | 1 | Keep OAuth token responses out of logs and errors |
| 390 | draft | 0 | 2 | 0 | Guard RFP orchestration transitions |
| 391 | draft | 0 | 1 | 0 | Record security sweep 03 |
| 392 | draft | 0 | 2 | 0 | Keep public booking and login steps out of the CRM shell |
| 393 | draft | 0 | 1 | 0 | Count task-report overdue by the UTC due day |
| 394 | draft | 0 | 1 | 0 | Refuse to delete an account that still has open deals |
| 395 | draft | 0 | 1 | 0 | Fill the Agreements and Meetings strings in French, Spanish, and Italian |
| 396 | draft | 0 | 0 | 0 | Weight the open pipeline in integer micros |
| 397 | draft | 0 | 1 | 0 | Record sweep 04 logic findings |
| 398 | draft | 0 | 2 | 0 | Fix critical and serious axe failures on the pages the list scan missed |
| 399 | draft | 0 | 0 | 0 | Sweep 05: UX, accessibility, and fresh-install findings |
| 400 | draft | 0 | 0 | 0 | Reject unreadable spreadsheets with 400 and flag a cut-off parse |
| 401 | draft | 0 | 0 | 0 | Show words on the new-opportunity form |
| 402 | draft | 0 | 0 | 0 | Keep Sign out on a phone |
| 403 | draft | 0 | 0 | 0 | Add the physical journey gate and sweep 01 log |
| 405 | draft | 0 | 0 | 0 | Close the dead routes, the no-score error, and the unnamed map controls |
| 406 | draft | 0 | 0 | 0 | Fail CI when French, Spanish, or Italian is missing an English key |
| 407 | draft | 0 | 0 | 0 | Let a phone tap the proposal name |
