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
| P-01 Real mode, demo toggle, install guide | In PR #364, #363, #367. Held (needs Tony: which enrichment provider, whether filings are in scope, and whether the free exchange-rate feed stays) | FIT | [#364](https://github.com/mysticalsin/bidstack-360/pull/364), [#363](https://github.com/mysticalsin/bidstack-360/pull/363), [#367](https://github.com/mysticalsin/bidstack-360/pull/367) |
| P-02 Analytics Add widget | In PR #355, #468, #469, #470 | FIT | Desktop save persists on `main`. Empty chart is [#355](https://github.com/mysticalsin/bidstack-360/pull/355). Sweep 13 is [#468](https://github.com/mysticalsin/bidstack-360/pull/468), [#469](https://github.com/mysticalsin/bidstack-360/pull/469), [#470](https://github.com/mysticalsin/bidstack-360/pull/470). |
| P-03 Company revenue, margin, open jobs | In PR #67, #354, #356, #491, #492. Held (needs Tony: an approved real filings or enrichment feed) | ADAPT | Figures are a synthetic seed. Leftovers are [#491](https://github.com/mysticalsin/bidstack-360/pull/491) and [#492](https://github.com/mysticalsin/bidstack-360/pull/492). |
| P-04 Preview container boot | In PR #353, #365. Held (needs Tony: a human deploy of the preview Worker) | FIT | [#353](https://github.com/mysticalsin/bidstack-360/pull/353), [#365](https://github.com/mysticalsin/bidstack-360/pull/365) |
| P-05 README with clips | In PR #388 | ADAPT | [#388](https://github.com/mysticalsin/bidstack-360/pull/388) |
| P-06 Floor plan before a new screen | In PR #486 | FIT | [#486](https://github.com/mysticalsin/bidstack-360/pull/486) |
| P-07 Deep sweeps, physical E2E, stress | In PR #403, #410, #391, #397, #399, #441, #457, #425, #456, #446, #483, #472 | FIT | Twelve sweep docs. None are on `main`. |
| P-08 Arabic catalogs | In PR #418 | FIT | [#418](https://github.com/mysticalsin/bidstack-360/pull/418) |
| P-09 Review comments | In PR #408, #409, #487, #489. Held (needs Tony: parked #189 and #280, and a currency on Opportunity before #64 converts the pipeline tile) | FIT | Inventory [#408](https://github.com/mysticalsin/bidstack-360/pull/408). Docker [#409](https://github.com/mysticalsin/bidstack-360/pull/409). Charts [#487](https://github.com/mysticalsin/bidstack-360/pull/487), [#489](https://github.com/mysticalsin/bidstack-360/pull/489). |

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

**Status: Partial.** Desktop add-and-persist is on `main`. The empty chart and the sweep 13 layout bugs are open pull requests. This audit does not open another one, and it does not stack a second dialog fix on #468.

### Desktop add and persist, checked on `main`

Saving a widget on a desktop session does create a row and the next read returns it.

| Step | Evidence |
| --- | --- |
| Save waits for the POST | `apps/web/src/components/widgets/WidgetConfigModal.tsx` awaits `onSave`. `apps/web/src/components/widgets/WidgetConfigModal.test.tsx` keeps the dialog open when that promise rejects. |
| The page sends the body | `handleAddWidget` in `apps/web/src/pages/AnalyticsDashboardPage.tsx` calls `useAddWidget` (`apps/web/src/hooks/useDashboards.ts`), which POSTs `/api/dashboards/:id/widgets` and invalidates the widget query on success. A rejection toasts the server message (`apps/web/src/hooks/useDashboards.test.tsx`). |
| The API stores the row | `POST /dashboards/:id/widgets` in `apps/api/src/routes/analytics-dashboards.ts` inserts `analytics_dashboard_widgets`. `position` defaults in `packages/db/prisma/schema.prisma` (`AnalyticsDashboardWidget`). |
| The row is still there on the next read | `apps/api/src/routes/analytics-dashboards.integration.test.ts`, case `widget CRUD + computed config.latestRunId merge`. It expects 201, reads the row with Prisma, lists it on GET, patches it, and sees it gone after DELETE. The case is `skipIfNoDb`, so it runs when CI has Postgres. This environment has no Postgres, so that file was read and not re-executed here. |
| The stub user may write the seeded board | `resolveStubAuth` uses the earliest user in the seed org. `packages/db/src/seed.ts` gives that user `Pre-sales Command Center` (`ownerId: seedUserId`, `isShared: true`). `requireDashboardEditor` allows the owner. |

A saved widget with no report still draws "No data available" (`apps/web/src/components/widgets/WidgetRenderer.tsx`, empty when there is no run). The modal's "None (static demo)" option sends no `reportId`. The row is real. The chart is empty. That is the gap [#355](https://github.com/mysticalsin/bidstack-360/pull/355) closes: POST without `reportId` returns 400, and the seed writes two synthetic reports with finished runs (`packages/db/src/seed-analytics-dashboard.ts`). Head `cursor/shared-dashboard-widgets-1143`.

### Sweep 13, already in pull requests

| Pull request | Head | What it owns |
| --- | --- | --- |
| [#468](https://github.com/mysticalsin/bidstack-360/pull/468) | `cursor/widget-dialog-onscreen-3d79` at `7ce59169` | Add widget dialog opened below the screen and scroll was locked. The form is the fixed scroller. Test `apps/web/e2e/responsive/widget-dialog-viewport.spec.ts`. |
| [#469](https://github.com/mysticalsin/bidstack-360/pull/469) | `cursor/analytics-toolbar-phone-3d79` at `e858c8cb` | Add widget sat past the right edge at 390px. The header wraps. Test `apps/web/e2e/responsive/analytics-toolbar-phone.spec.ts`. |
| [#470](https://github.com/mysticalsin/bidstack-360/pull/470) | `cursor/dashboard-delete-touch-3d79` at `0cf01488` | Delete dashboard was hover-only, so a touch screen never saw it. Test `apps/web/e2e/responsive/dashboard-delete-touch.spec.ts`. |

#468, #469, and #470 are independent drafts from `main`. They do not change the POST. Sweep 13's write-up is [#472](https://github.com/mysticalsin/bidstack-360/pull/472).

**APP-FIT: FIT.** `/analytics` is still a primary nav item (`apps/web/src/components/layout/navConfig.ts`, label "Analytics & Reports"). The dashboard list that #470 edits is the same analytics area.

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

### Where sweep 09's 1,700,000,000 EUR came from

[#456](https://github.com/mysticalsin/bidstack-360/pull/456) `docs/sweeps/sweep-09.md` says Sweep Sentinel (`3e99d956-fdfd-4658-85b8-2e2e4b8fe9c6` in that run) "matched its filings": FY2024 revenue 1,700,000,000 EUR, operating margin 18% (19.1% the year before), four job postings seen in 45 days. `GET /api/v1/accounts/{id}/key-numbers` returned revenue 1700000000 EUR, margin 18, open jobs 4.

That read is a seed fixture. It is not a provider call and not a scrape of a public filing.

| | |
| --- | --- |
| Writer | `packages/db/scripts/seed-sweep-09.ts` on [#456](https://github.com/mysticalsin/bidstack-360/pull/456) (`cursor/sweep-09-report-2258`). The file is not on `main`. |
| Company | `Sweep Sentinel`, entity id `LEI-SWEEP-SENTINEL`. The script refuses `NODE_ENV=production` and `POLO_DATA_MODE=real`. |
| Revenue and margin | Hardcoded `account_financial_periods` rows. FY2024 revenue `1_700_000_000` EUR, operating income `306_000_000` (18%). FY2023 revenue `1_500_000_000`, operating income `286_500_000` (19.1%). `source` is the string `esef`. `source_url` is `https://example.test/sweep09/sentinel`. Nothing fetches filings.xbrl.org or EDGAR. |
| Open jobs | Four `company_job_postings` rows titled `Open role 0`–`Open role 3`, `source` string `greenhouse`, `last_seen_at` set to now. Two older rows are outside the 45-day window. Nothing calls Greenhouse. |
| Reader | `loadKeyNumbers` in `apps/api/src/services/account-positioning/load.ts` via `loadAccountFinancials` in `apps/api/src/routes/account-financials.ts`. The route reads stored periods. The worker can pull EDGAR or ESEF on a schedule, and this seed does not go through that worker. |
| Not the figure on screen | The same seed writes `company_firmographics.annual_revenue_usd` of `125_000_000_000` for Sweep Sentinel. Filings rank above that cache, so the key-numbers read stays on the 1.7bn EUR row. |

**Not needs Tony for these three numbers.** They are synthetic. New UI for this ask stays on seed values like these. Do not replace them with a live ESEF, EDGAR, or Greenhouse pull.

**Needs Tony:** an approved filings or enrichment source, if the tiles should fill from a real feed in real mode. No provider is added here.

### Sweep 09 leftovers

[#456](https://github.com/mysticalsin/bidstack-360/pull/456) recorded these and did not change them. They are not the Sweep Sentinel filing. The fixes use synthetic seed values only.

| Leftover | APP-FIT | Where |
| --- | --- | --- |
| Territories and Service desk empty states are a title and nothing else | FIT | In PR [#491](https://github.com/mysticalsin/bidstack-360/pull/491) `cursor/sweep09-empty-and-due-81b9`. Red `35688b3e`. Green `25e1b7b3`. |
| A year-0001 task reads as 739,940 days late | FIT | Same pull request. `taskDueChip` names the date past ten years. |
| Monthly bars under the hero are still the latest 100 bids | FIT | In PR [#492](https://github.com/mysticalsin/bidstack-360/pull/492), stacked on [#453](https://github.com/mysticalsin/bidstack-360/pull/453). Red `b3196a22`. Green `afdf2932`. The caption says the bars are the latest 100 bids. |

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

## QA pass, 2026-11-21

Local API on port 4000 and web on port 38081, stub auth, the fixture seed, plus the two new branches merged only in the local checkout (`cursor/qa-pass-81b9`, not pushed). Playwright opened 28 routes at 1280×800. Every document returned HTTP 200. No page error was recorded.

| Check | Result |
| --- | --- |
| Territories empty copy | The sentence "Territories group the countries you sell in." was on the page. |
| Service desk | New case was visible. Saving subject "Synthetic QA case" put that subject on the list. `GET /api/v1/service-cases` returned it. |
| Hero bars | The page included "latest 100 bids". |
| Add widget | The button was on screen (x=1109, y=139). Save widget's box was y=1341, below an 800px viewport. After the click, Pre-sales Command Center had 3 widgets (the seed has 2). The row persisted. The off-screen form is the same defect as [#468](https://github.com/mysticalsin/bidstack-360/pull/468). No second fix was opened. |
