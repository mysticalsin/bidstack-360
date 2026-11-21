# Polo ask list

Audit date: 2026-11-21. Base: `main` at `40b13242` (merge of pull request #70). Nothing in this list is merged past that commit. Open pull requests were read from GitHub on that date. No customer or company records were used.

Tony, t2040u–t2042u: "full port these and build them" / "make sure they sitll make sense with the apps before merging" / "get shit done".

## How to read a row

| Status | Meaning |
| --- | --- |
| Done-main | The behavior is on `main` at `40b13242`, with a file or test that shows it. |
| In PR #N | An open pull request already owns the change. It is not rebuilt here. |
| Partial | Some of the ask is on `main` or in a pull request, and a named piece is still open. |
| Not started | No matching code or pull request on this base. |

APP-FIT is judged against the apps as they are on `main`, plus the open pull requests that would change that behavior before a merge.

| Rating | Meaning |
| --- | --- |
| FIT | The ask still matches a screen, boot path, or document the apps actually have. |
| ADAPT | The ask still belongs, and the note says what has to change so it stays true after the other open pull requests land. |
| STALE | The ask no longer matches the apps. The reason is in the row. |

## Summary

| Ask | Status | APP-FIT | Where it lives |
| --- | --- | --- | --- |
| P-01 Real mode, demo toggle, install guide | Partial | FIT | [#364](https://github.com/mysticalsin/bidstack-360/pull/364), [#363](https://github.com/mysticalsin/bidstack-360/pull/363), [#367](https://github.com/mysticalsin/bidstack-360/pull/367) |
| P-02 Analytics Add widget | In PR #355 | FIT | [#355](https://github.com/mysticalsin/bidstack-360/pull/355), phone follow-ups [#468](https://github.com/mysticalsin/bidstack-360/pull/468), [#469](https://github.com/mysticalsin/bidstack-360/pull/469) |
| P-03 Company revenue, margin, open jobs | Partial | ADAPT | [#67](https://github.com/mysticalsin/bidstack-360/pull/67), [#354](https://github.com/mysticalsin/bidstack-360/pull/354), [#356](https://github.com/mysticalsin/bidstack-360/pull/356) |
| P-04 Preview container boot | In PR #353 | FIT | [#353](https://github.com/mysticalsin/bidstack-360/pull/353), state machine [#365](https://github.com/mysticalsin/bidstack-360/pull/365) |
| P-05 README with clips | In PR #388 | ADAPT | [#388](https://github.com/mysticalsin/bidstack-360/pull/388) |
| P-06 Floor plan before a new screen | In PR #486 | FIT | [#486](https://github.com/mysticalsin/bidstack-360/pull/486). No owner in #348–#441 before this audit. |
| P-07 Deep sweeps, physical E2E, stress | Partial | FIT | Twelve sweep docs in open pull requests. None are on `main`. |
| P-08 Arabic catalogs | Partial | FIT | Catalogs and `isRtl` are on `main`. Finish and the switcher are [#418](https://github.com/mysticalsin/bidstack-360/pull/418). |
| P-09 Review comments | Partial | FIT | Inventory [#408](https://github.com/mysticalsin/bidstack-360/pull/408). Dockerfile rows are [#409](https://github.com/mysticalsin/bidstack-360/pull/409). Chart rows are [#487](https://github.com/mysticalsin/bidstack-360/pull/487) and [#489](https://github.com/mysticalsin/bidstack-360/pull/489). |

## P-01 — Real mode, a demo toggle, and an install guide

Source, t35u: "I dont want demo mode anymore (maybe havae a toggle for that in settings but I need this to be real and work end to end with a detialled document on how to run it and install it)".

Card t1804s7435: the demo toggle is hidden from members and enforced on the server, stub login exists only on local or preview, and providers stay "Not connected" until approved.

**Status: Partial.** Not Done-main.

On `main`, unset `POLO_DATA_MODE` is demo. `getPoloDataMode` in `apps/api/src/lib/polo-mode.ts` returns `real` only when the variable is exactly `real`. The preview container writes demo again in `apps/polo-preview/container/entrypoint.mjs` (`POLO_DATA_MODE: 'demo'`). There is no install guide: `docs/INSTALL-AND-RUN.md` is not on `main`. `README.md` is the short quick start and still tells the reader to fill `CLERK_SECRET_KEY`.

| Piece | Evidence |
| --- | --- |
| Demo data switch, real as the default, sample rows hidden when the switch is off | [#364](https://github.com/mysticalsin/bidstack-360/pull/364) `cursor/real-mode-default-557a`, head `18b0c058`. Adds `docs/real-mode.md`, `docs/real-mode-audit.md`, `apps/api/src/lib/demo-data.ts`, `apps/web/src/components/settings/DemoDataSection.tsx`, and `packages/db/prisma/migrations/20261120120000_org_settings_demo_data/migration.sql`. Tests named in the pull request: `apps/api/src/lib/real-mode-default.test.ts`, `apps/api/src/lib/demo-data.test.ts`, `apps/web/src/components/settings/IdentitySection.test.tsx`, `apps/polo-preview/src/entrypoint-data-mode.test.ts`. The pull request says the shared runtime-mode module is a design in the audit and is not built on that branch, and that Postgres was not running for the browser check. |
| Install and run document | [#363](https://github.com/mysticalsin/bidstack-360/pull/363) `cursor/install-and-run-542e`. Files: `docs/INSTALL-AND-RUN.md`, `.env.example`, `README.md`, `apps/web/src/env-example-source.test.ts`, `apps/web/src/vite-client-env.test.ts`. |
| Card t1804s7435 in one module | [#367](https://github.com/mysticalsin/bidstack-360/pull/367) `cursor/polo-runtime-mode-79a1` (draft). `packages/shared/src/runtime-mode` is the only transition function. Stub is refused for real data and for production. Providers stay "Not connected" until an approval flag. The pull request stacks on #353 and overlaps the toggle and entrypoint already edited by #364. |

**APP-FIT: FIT.** The API, the web Settings page, and the preview container still exist, and `main` still boots demo. The ask is the change those three apps need.

**Before merge:** rebase #367 onto one of #364 or #353. Do not merge both toggle implementations. #364 also edits `apps/polo-preview/container/entrypoint.mjs`, which #353 and #365 edit.

**Needs Tony:** which enrichment provider to connect, whether public filings are in scope, and whether the free exchange-rate feed stays. Those are named in #364. This audit does not add a provider or a key. Deploying the preview is out of scope.

## P-02 — Analytics "Add widget" does not work

Source, t1661u.

**Status: In PR #355.** Not Done-main.

On `main` the button is real: `apps/web/src/pages/AnalyticsDashboardPage.tsx` opens `WidgetConfigModal`, and `useAddWidget` in `apps/web/src/hooks/useDashboards.ts` POSTs `/api/dashboards/:id/widgets`. The API in `apps/api/src/routes/analytics-dashboards.ts` stores a widget with `reportId` null when the body omits it. The modal offers "None (static demo)" (`apps/web/src/components/widgets/WidgetConfigModal.tsx`). A widget saved that way has no report run to draw.

[#355](https://github.com/mysticalsin/bidstack-360/pull/355) `cursor/shared-dashboard-widgets-1143` (ready) makes POST without `reportId` return 400, seeds two synthetic reports with finished runs (`packages/db/src/seed-analytics-dashboard.ts`), and shows Add widget only to the owner or a system admin who also has `reports:write`. Tests on that branch include `apps/api/src/routes/analytics-dashboards.integration.test.ts`, `apps/web/src/components/widgets/WidgetConfigModal.test.tsx`, and `packages/db/src/seed-analytics-dashboard.test.ts`.

Phone layout of the same dialog is [#468](https://github.com/mysticalsin/bidstack-360/pull/468) and [#469](https://github.com/mysticalsin/bidstack-360/pull/469). Sweep 13 ([#472](https://github.com/mysticalsin/bidstack-360/pull/472)) already screenshots the 390px dialog. Those three sit outside #348–#441 and already own the phone screen, so this audit does not add another one.

**APP-FIT: FIT.** `/analytics` is still a primary nav item (`apps/web/src/components/layout/navConfig.ts`, label "Analytics & Reports").

## P-03 — Company revenue, margin, and open jobs

Source, t1662u. The customer/company section's revenue, margin, and open-jobs data is missing or wrong.

**Status: Partial.** The three tiles exist on `main`. The wrong-number fixes are open pull requests.

`loadKeyNumbers` in `apps/api/src/services/account-positioning/load.ts` builds `revenue`, `margin`, and `open_jobs`. The strip is `apps/web/src/components/positioning/KeyNumbersStrip.tsx`. Tests on `main`: `apps/api/src/routes/account-positioning.integration.test.ts` (expects `open_jobs` value 5 for the fixture) and `apps/web/src/components/positioning/positioning.test.tsx`.

| Tile | Open pull request | What it changes |
| --- | --- | --- |
| Revenue compact digit | [#67](https://github.com/mysticalsin/bidstack-360/pull/67) | Keeps cockpit revenue when one compact digit would move the amount. |
| Margin | [#354](https://github.com/mysticalsin/bidstack-360/pull/354) `cursor/demo-sample-margin-e9da` | Labels a sample margin on demo key numbers. Touches `load.ts`, `apps/api/src/routes/account-financials.ts`, and `KeyNumbersStrip.tsx`. |
| Open jobs | [#356](https://github.com/mysticalsin/bidstack-360/pull/356) `cursor/demo-open-jobs-fresh-e79d` | Keeps demo fixture job postings open after a snapshot restore. Test: `apps/api/src/services/account-positioning/demo-fixture-open-jobs.test.ts`. |

**APP-FIT: ADAPT.** The tiles belong on the account page. Sample margin and fixture job postings are demo data. After #364 or #367, a real org with the demo switch off must keep showing the missing state (`No public revenue figure found yet`, `No margin in the filed numbers`, `No job postings tracked yet`) instead of those fixtures. #364 already blanks a sample key number when the switch is off. Merge #354 and #356 only onto that rule.

**Needs Tony:** an approved filings or enrichment source, if the tiles should fill in real mode. No provider is added here.

## P-04 — Preview container boot failures

Source: container boot failures on the preview Worker and Container. See #353 and #365.

**Status: In PR #353.** Follow-up state machine is #365. Not Done-main. Not deployed from this audit.

[#353](https://github.com/mysticalsin/bidstack-360/pull/353) `cursor/polo-restore-app-role-2896`, head `f1f8cae6` (ready). The boot was dying on `could not set the app role password` because a snapshot restore does not bring cluster roles back. The pull request creates `app_role`, restores with `--no-privileges`, and refuses `ready` unless the audit-log grants and triggers match. Tests: `apps/polo-preview/src/restore-migrated-snapshot.integration.test.ts`, `apps/polo-preview/src/database-boot.test.ts`, `apps/api/src/security/audit-log-app-role.integration.test.ts`. The pull request says the drill used a local dump, not the live R2 object.

[#365](https://github.com/mysticalsin/bidstack-360/pull/365) `cursor/polo-database-boot-state-0000` (draft) turns that boot into an explicit state machine. It edits the same `apps/polo-preview/container/entrypoint.mjs` and `apps/polo-preview/src/database-boot.js` as #353. Rebase it onto #353. Do not merge it beside #353.

**APP-FIT: FIT.** `apps/polo-preview` is still the Worker plus the container image (`apps/polo-preview/README.md`). The boot bug is that app's boot path.

**Needs Tony:** a deploy. `apps/polo-preview/README.md` says CI must not `wrangler deploy` this Worker. This audit does not deploy, does not read R2, and does not edit the Worker deploy config.

## P-05 — README with GIFs or animations

**Status: In PR #388.** Not Done-main.

`README.md` on `main` is the feature matrix and a ten-line quick start. It has no clips.

[#388](https://github.com/mysticalsin/bidstack-360/pull/388) `cursor/polo-readme-59a1` (draft), head `535facf1`. It rewrites `README.md` and adds six clips under `docs/media/` (`accounts.gif`, `pipeline.gif`, `dashboard.gif`, `tasks.gif`, `csv-import.gif`, `rfp.gif`) plus `scripts/record-readme-media.mts`. The script refuses any database whose name is not `bidstack_readme`. The pull request names fictional companies only (Lumen and Lark, Harborline Instruments, and four others).

**APP-FIT: ADAPT.** The six flows it records are on `main` (accounts, pipeline, dashboard, tasks, CSV import, proposals). The data-mode section correctly says `POLO_DATA_MODE` defaults to demo, which is what `polo-mode.ts` does today. After #364, that section has to say that an unset variable is real. The pull request already leaves the install guide to #363 instead of copying it.

## P-06 — Floor plan before any new screen

**Status: In PR #486.** Not on `main`. At audit time, pull requests #348–#441 and the tree had no floor plan. [#486](https://github.com/mysticalsin/bidstack-360/pull/486) `cursor/polo-floor-plan-81b9` adds `docs/floor-plans/polo-app-floor-plan.md` and `apps/web/src/components/layout/navConfig.floor-plan.test.ts`. Red commit `53091acb` (the plan file was missing). Green commit `aa4a0b7b` (the test passed).

**APP-FIT: FIT.** `NAV_SECTIONS` in `apps/web/src/components/layout/navConfig.ts` is the shell. New screens are still landing (the open UI pull requests from #358 through #472). A floor plan of that shell is the artifact Tony asked for before another screen is drawn. It is a document, not a new product route, so it does not collide with those pull requests.

The pull request is [#486](https://github.com/mysticalsin/bidstack-360/pull/486).

## P-07 — 10–20 deep sweeps, physical E2E, and stress

**Status: Partial.** `docs/sweeps/` does not exist on `main`. Twelve sweep write-ups are open, which is inside the 10–20 range. Sweep 11 and sweeps 14–20 were not found. They are not required to meet the range, and a second series would duplicate this one.

| Sweep | Pull request | Doc on that branch |
| --- | --- | --- |
| 01 physical journeys | [#403](https://github.com/mysticalsin/bidstack-360/pull/403) `cursor/sweep-01-e2e-journeys-88cf` | `docs/sweeps/sweep-01-e2e.md`, `e2e/journeys/sweep.spec.ts` |
| 02 stress | [#410](https://github.com/mysticalsin/bidstack-360/pull/410) `cursor/stress-sweep-02-843e` | `docs/sweeps/sweep-02-stress.md`, `stress/run.mjs` |
| 03 security | [#391](https://github.com/mysticalsin/bidstack-360/pull/391) | `docs/sweeps/sweep-03-security.md` |
| 04 logic | [#397](https://github.com/mysticalsin/bidstack-360/pull/397) | `docs/sweeps/sweep-04-logic.md` |
| 05 UX, accessibility, fresh install | [#399](https://github.com/mysticalsin/bidstack-360/pull/399) | `docs/sweeps/sweep-05-ux-a11y-setup.md` |
| 06 error paths | [#441](https://github.com/mysticalsin/bidstack-360/pull/441) | `docs/sweeps/sweep-06.md` |
| 07 API contract | [#457](https://github.com/mysticalsin/bidstack-360/pull/457) | `docs/sweeps/sweep-07.md` |
| 08 auth, session, roles | [#425](https://github.com/mysticalsin/bidstack-360/pull/425) | `docs/sweeps/sweep-08.md` |
| 09 empty, large, edge data | [#456](https://github.com/mysticalsin/bidstack-360/pull/456) | `docs/sweeps/sweep-09.md` |
| 10 install and operations | [#446](https://github.com/mysticalsin/bidstack-360/pull/446) | `docs/sweeps/sweep-10.md` |
| 12 import and export | [#483](https://github.com/mysticalsin/bidstack-360/pull/483) | `docs/sweeps/sweep-12.md` |
| 13 mobile, touch, motion | [#472](https://github.com/mysticalsin/bidstack-360/pull/472) | `docs/sweeps/sweep-13.md` |

**APP-FIT: FIT.** The sweeps name routes the web app still serves (accounts, pipeline, settings, CSV import, analytics). Fix pull requests that came out of them (#398, #401, #405, and the rest of that band) should merge with the sweep that found them, not as a new sweep.

**Needs Tony:** nothing to start another sweep. Merging the twelve is a review decision.

## P-08 — Arabic catalogs

**Status: Partial.** Catalogs are on `main`. The switcher and RTL layout are not finished. The finish is [#418](https://github.com/mysticalsin/bidstack-360/pull/418).

On `main`:

- `apps/web/public/locales/ar/` has `ai`, `auth`, `common`, `crm`, `integrations`, `onboarding`, `reports`, `rfp`, `settings`, and `signatures`.
- `apps/web/src/i18n/index.ts` lists `ar` in `SUPPORTED_LOCALES` and in `RTL_LOCALES`. `apps/web/src/i18n/i18n.test.ts` expects `isRtl('ar')` to be true.
- `apps/web/src/components/settings/LanguageSwitcher.tsx` says AR is deferred from the picker until RTL layout is QA'd. `DISPLAY_LOCALES` is `en`, `fr`, `es`, `pt`, `it`, `zh`. `persistLocale` sets `document.documentElement.lang` and does not set `dir`.

[#418](https://github.com/mysticalsin/bidstack-360/pull/418) `cursor/arabic-locale-rtl-331c` (draft) is titled "Finish the Arabic catalogs and right-to-left layout". It adds `apps/web/src/i18n/locale-ar-completeness.test.ts`, `apps/web/e2e/rtl-arabic.spec.ts`, and edits `LanguageSwitcher.tsx` plus the layout components that hard-code left edges. That pull request owns the screen. This audit does not open a second Arabic UI.

**APP-FIT: FIT.** The i18n pipeline and the Settings language card are the right place. The switcher comment is the ask, still open.

## P-09 — GitHub and Codex review comments

**Status: Partial.** The inventory is [#408](https://github.com/mysticalsin/bidstack-360/pull/408) `cursor/review-comment-inventory-e5f8`, file `docs/sweeps/review-comment-inventory-20261121.md`. It scanned 64 open pull requests on 2026-11-21: 214 items, 7 addressed, 21 unaddressed, 186 not-actionable (CI scores, Codex receipts, dependency-graph notices).

Of the 21 unaddressed items, 12 sit on pull requests Tony parked (#189 and #280). The active remainder:

| Inventory row | Where | What this audit does |
| --- | --- | --- |
| 5, 16, and the later-head part of 6 | `apps/marketing/Dockerfile` has no `USER`. `apps/api/Dockerfile` has no `HEALTHCHECK`. The API image on current `main` already has `USER bidstack` (`apps/api/Dockerfile`). | Owned by [#409](https://github.com/mysticalsin/bidstack-360/pull/409) `cursor/preview-image-scan-fixes-ffb6`. Not copied. |
| 7 | [#73](https://github.com/mysticalsin/bidstack-360/pull/73) comment on `apps/web/src/components/viz/charts.tsx`: stage bars still format `Number(value)` and ignore `amount`. | [#487](https://github.com/mysticalsin/bidstack-360/pull/487) `cursor/stage-bar-exact-labels-81b9`, stacked on #73. Red `413eb22c`. Green `df9d5363`. |
| 8 | [#74](https://github.com/mysticalsin/bidstack-360/pull/74) comment on `apps/web/src/components/viz/bklit-adapters.tsx`: forecast tooltips still format `Number(won)` and `Number(weighted)`. | [#489](https://github.com/mysticalsin/bidstack-360/pull/489) `cursor/forecast-tooltip-labels-81b9`, stacked on #74. Red `d4527cf2`. Green `248ebc51`. |
| 9 | [#64](https://github.com/mysticalsin/bidstack-360/pull/64). Codex asked to keep EUR conversion on the open-pipeline tile. The reply on that thread says `Opportunity` has no currency column, so the sum stays unspecified until a source currency exists. | Not changed. Doing what Codex asked would invent a currency. |
| 11–13 | [#389](https://github.com/mysticalsin/bidstack-360/pull/389) Semgrep on a Google OAuth prefix in `apps/api/src/lib/oauth-failure.test.ts`. | Already answered on the thread: commit `7370356f2f6f9d4d11b21c92c262e1d2d768ce09` replaced the prefix with `fixture-oauth-access-not-a-credential`. The review threads are outdated (`line` is null). |

**APP-FIT: FIT** for rows 7 and 8. Account stage bars and the forecast chart are still the visuals those pull requests edit. **STALE** as a reason to edit #189: Tony parked it, the P0 is `POSTGRES_PASSWORD` baked into `apps/polo-preview/Dockerfile`, and this run does not touch preview deploy config.

**Needs Tony:**

- Parked #189, including the P0 image `ENV` and the non-root `USER` / `HEALTHCHECK` comments on `apps/polo-preview/Dockerfile` and `Dockerfile.runtime`.
- Parked #280, including the restore-script comments on `scripts/lib/postgres-client.sh`. #280 also mentions R2, which this run does not touch.
- A currency column, or another source of truth, before anyone restores EUR conversion on the pipeline tile (#64).
