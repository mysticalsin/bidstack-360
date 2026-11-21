# Sweep 01 — physical end-to-end

Lens: drive Polo in a real browser against the local stack. Static review does not count.

## How this was run

- Postgres 16 with `pgvector` on `127.0.0.1:5432`, Redis 7 on `127.0.0.1:6380`.
- API `127.0.0.1:4000`, worker, Vite `127.0.0.1:5173`.
- `VITE_AUTH_MODE=stub`, `VITE_ENABLE_E2E_ROLE_HEADER=true`, `BIDSTACK_ALLOW_STUB_ROLE_HEADER=true`.
- No Clerk key, no Dust/Apollo/LLM keys, no deploy, polo-preview not started.
- Data is synthetic only: org "Northwind Presales (synthetic)", users `avery.north@example.com` and `casey.quinn@example.com`, companies Northwind Labs and Contoso Rail, fictional filings and job posts. The prototype fixture seed (`CI Financial`, `Siemens`, and the rest) was not loaded.
- Browser: Playwright Chromium. Desktop project `1280×800`. Mobile project `390×844`.
- Gate: `pnpm e2e:journeys` (`e2e/journeys/sweep.spec.ts`). Final run: both projects passed (desktop 23.9s, mobile 27.0s).

Screenshots below are from that physical pass (the first failing pass, where a bug is easier to see, or the green rerun). Console, network, and server logs for every step were written beside each screenshot during the run (`screenshot.png`, `console.log`, `network.log`, `server.log`, `page.txt`).

## Counts

| Severity | New (not a duplicate) | Fixed here | Duplicate of an open PR | Blocked | Still open |
| --- | ---: | ---: | ---: | ---: | ---: |
| High | 1 | 1 | 0 | 0 | 0 |
| Medium | 3 | 2 | 5 | 1 | 0 |
| Low | 0 | 0 | 4 | 0 | 0 |

Journeys that behaved correctly are not counted as findings.

## Journey results

| # | Journey | 1280 | Mobile | Notes |
| --- | --- | --- | --- | --- |
| 1 | Sign in (stub) | Pass | Pass | "Enter workspace" opens the dashboard |
| 2 | Dashboard + add a widget | Pass | Pass | Widget saves. On a phone the button sits outside the viewport (finding 12) |
| 3 | Accounts list, filter, company | Pass | Pass | Search "Northwind" opens the cockpit |
| 4 | Revenue, margin, open jobs | Pass | Pass | EUR 480m, operating margin 15.0%, 3 open jobs from the synthetic filing and postings |
| 5 | Pipeline drag | Pass | Pass | Card moves and the toast confirms the stage. Columns are sliced at 1280 (finding 4) |
| 6 | Opportunity create, edit, close | Pass | Pass | Pick a company, edit the name, Mark Won (desktop) or Mark Lost (mobile). The create form used machine strings before the fix (finding 1) |
| 7 | Tasks create, today, complete, badge | Pass | Pass | Create, due today, complete. Badge does not match the page (finding 6) |
| 8 | CSV map, preview, start, complete | Pass | Pass | Map step fits a 390px width. A one-row import finishes before Cancel is offered. Complete shows "2 / 2" rather than 100 (finding 9) |
| 9 | Proposal | Pass | Pass | Create and open. On a phone the stage cell covers the name link (finding 3) |
| 10 | Settings, demo toggle, member vs admin | Pass | Pass | Data mode badge is Demo. No toggle (finding 7). A member does not get Data import |
| 11 | Integrations "Not connected" | Pass | Pass | Main content includes "Not connected". Nothing renders as Connected |
| 12 | Logout | Pass | Pass | Was impossible on a phone before finding 2 |

## Findings

### 1. Medium — Create opportunity shows storage keys and a schema sentence

- **Status:** fixed in the opportunity-create PR.
- **Steps:** Opportunities → New opportunity. Read the Stage and Industry menus. Submit with a name and no chosen customer.
- **Expected:** Stage reads "S1 Lead" / "S1 Ongoing", industry reads "Financial Services", and an empty customer says "Choose a customer."
- **Actual:** Options were `s1_lead`, `s1_ongoing`, `financial_services`. The alert was `String must contain at least 1 character(s)`.
- **Evidence:** `docs/sweeps/sweep-01-evidence/desktop-opportunity-create.png`

### 2. High — Sign out is removed on a phone

- **Status:** fixed in the mobile sign-out PR.
- **Steps:** Open the app at 390px (or any width under 768px) and look for Sign out.
- **Expected:** A signed-in person can sign out.
- **Actual:** `.tb-signout { display: none }` under `max-width: 767px` and between 768px and 900px hides Sign out along with the other icon buttons. The control is not in the accessibility tree. After the fix, Sign out keeps the class `tb-signout-keep` and stays available. The green mobile run signed out and landed on Enter workspace.
- **Evidence:** `docs/sweeps/sweep-01-evidence/mobile-after-sign-out.png` (after the fix). The pre-fix mobile dashboard text had no Sign out control.

### 3. Medium — Proposal name cannot be clicked on a phone

- **Status:** fixed in https://github.com/mysticalsin/bidstack-360/pull/407 (`4b415c0f`). The shared table grows to its columns (`w-max min-w-full`) and scrolls, so the name column is no longer 0px wide and a normal click opens the proposal.
- **Steps:** At 390px, Proposals → click the new proposal's name.
- **Expected:** The click hits the proposal link.
- **Actual:** Playwright reports the Draft cell intercepts the pointer. The link's box is covered.
- **Evidence:** mobile step `09-proposal` page text lists the proposal and Draft on the same visual row.

### 4. Medium — Pipeline columns are sliced at 1280 — covered by #361

- **Steps:** Open Pipeline at 1280×800.
- **Expected:** Each stage column is fully on screen or the board scrolls without clipping a column in half.
- **Actual:** "S3 Technical Iteration" is cut to "S3 Technical Iterati". S4 and the closed columns sit past the board edge.
- **Evidence:** `docs/sweeps/sweep-01-evidence/desktop-pipeline-1280.png`

### 5. Medium — Account filters stack and push the cards down — covered by #362

- **Steps:** Open Accounts at 1280×800.
- **Expected:** Filters sit on one row so the account cards are the thing on screen.
- **Actual:** Industry, technology, MSA leverage, and sort are full-width rows. The first card (the injected Mantu row, finding 8) sits under them.
- **Evidence:** `docs/sweeps/sweep-01-evidence/desktop-accounts-filters.png`

### 6. Medium — Tasks badge is not the page count — covered by #375

- **Steps:** With 4 tasks on the Tasks page (3 open, 1 done, 1 of the open tasks overdue), read the Tasks nav badge.
- **Expected:** The badge and the page describe the same count.
- **Actual:** The nav badge is `1`. The page heading says "4 active follow-ups" and the list has 4 rows. The summary API returns `{ total: 4, open: 3, overdue: 1 }`.
- **Evidence:** desktop step `07-tasks` page text and `GET /api/v1/tasks/summary`.

### 7. Medium — No demo-data toggle — covered by #364

- **Steps:** Settings → Identity & roles, as an admin.
- **Expected:** An admin can turn demo data on or off.
- **Actual:** A Data mode badge reads "Demo". There is no switch. Members do not see Data import, Identity, or the other admin sections; that part works.
- **Evidence:** desktop step `10-settings-demo-and-roles` page text.

### 8. Medium — Every dashboard grows a Mantu account — covered by #364 and #367

- **Steps:** Load Accounts with only the synthetic companies in Postgres.
- **Expected:** The list is Northwind Labs, Contoso Rail, and anything the CSV import added.
- **Actual:** `buildCompanies` inserts `fallbackCompany('Mantu')` whenever the name is absent (`apps/api/src/services/crm/company-enrichment.service.ts`). The card shows mantu.com, 12,000 employees, 99% confidence. Both open PRs already edit that function.
- **Evidence:** `docs/sweeps/sweep-01-evidence/desktop-accounts-filters.png`

### 9. Low — A finished CSV import shows a fraction, not 100 — covered by #351

- **Steps:** Settings → Data import → map → preview → Confirm import, for a one- or two-row file.
- **Expected:** A completed import reads 100.
- **Actual:** The screen says "Import complete" and "2 / 2". Cancel and Retry never appear because the worker finishes before the button is painted. That race is the subject of #349 and #350.
- **Evidence:** desktop step `08-csv-import` page text.

### 10. Low — Deal amounts say the currency was not recorded, while the board shows CAD — covered by #374

- **Steps:** Read an opportunity value and the pipeline card for the same deal.
- **Expected:** One currency story.
- **Actual:** The list says `1,250,000 (currency not recorded; not a euro forecast)`. The board card shows `CA$1.97M` because the header currency is CAD. The org default currency is CAD. #374 owns the money formatters.
- **Evidence:** desktop step `06-opportunity-create-edit-close` page text and `desktop-pipeline-1280.png`.

### 11. Low — Opportunity list weighted total is the page, not the book — covered by #378 (#58)

- **Steps:** Read the opportunities header after four open deals.
- **Expected:** The weighted total matches the open book, or it says it is only this page.
- **Actual:** Open pipeline is `5,010,000` (the four values added). "WR (PAGE)" is `2,374,000`.
- **Evidence:** desktop opportunities page text in step `06`.

### 12. Medium — Add widget sits off the phone screen — blocked, file owned by #355

- **Steps:** At 390px, open Analytics and try to click Add widget.
- **Expected:** The button can be scrolled into view and clicked.
- **Actual:** The button has a box, scrolling does not bring it into the viewport, and a normal click fails. A DOM click still opens the dialog. `AnalyticsDashboardPage.tsx` is already edited by #355, so this sweep did not touch it.
- **Evidence:** mobile step `02-dashboard-add-widget` (Playwright: "element is outside of the viewport" after scroll).

### 13. Low — Pipeline still prints the drag instructions — covered by #366

- **Steps:** Open Pipeline.
- **Expected:** No how-to line under the title.
- **Actual:** "Drag a card between columns, or focus a card and use ← / → to move stages."
- **Evidence:** `desktop-pipeline-1280.png`

## Checked and not a new defect

- Revenue, operating margin, and open jobs on Northwind Labs render the synthetic filing (EUR 480m, 15.0%, 3). Not the sample-margin or stale-posting bugs (#354, #356).
- Task dates render as calendar dates (Nov 18, Nov 21, Dec 2), not a shifted day.
- Company create and the rest of the session did not hang on Redis (#376).
- Integrations are Not connected when no provider keys are set.
- Member vs admin: an account executive is sent away from Data import and does not see the admin settings groups.
- CSV mapping table at 390px stayed inside the viewport (`table.right` 365 vs width 390).
- polo-preview was not booted, so the snapshot-restore and database-boot PRs (#353, #365) were not exercised.

## Fixes

| Finding | PR | Head | What changed |
| --- | --- | --- | --- |
| 1 | https://github.com/mysticalsin/bidstack-360/pull/401 | `021d420e` | Stage and industry options use `formatStage`. An empty customer says "Choose a customer." |
| 2 | https://github.com/mysticalsin/bidstack-360/pull/402 | `12562855` | Sign out keeps `tb-signout-keep` so the phone and tablet rules no longer set `display: none` on it |
| 3 | https://github.com/mysticalsin/bidstack-360/pull/407 | `4b415c0f` | The shared table uses `w-max min-w-full`, so the name column keeps a width and a normal click hits the link |

The journey gate is `pnpm e2e:journeys`.
