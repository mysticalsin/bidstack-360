# Sweep 17 — deep accessibility

Lens: WCAG 2.2 AA, in Chromium, on the running app. Not a static read of the source.

Date: 2026-11-21. Base: `main` at `40b13242ebf18d715b67bb6133a9774bbd7d0c78`.

Synthetic only. `POLO_DATA_MODE=demo`, fixture seed org “Mantu (seed)”, stub auth, no Clerk key, no Dust key, no deploy. API `http://127.0.0.1:4000`, web `http://127.0.0.1:38081` (Vite). Browser: Playwright Chromium.

axe-core tags: `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa`. Critical and serious are the failing set. Each route was opened at 1280×800 and 390×844, in light and in dark (`bidstack-theme`). Animations were allowed to finish before the scan, because a label mid fade-in reads as a contrast failure.

## Routes

Dashboard, Quick Start, Forecasts, Win/Loss, Sales Toolkits, Accounts, KAM, Companies, Sector View, Cross-sell, Contacts, Meetings, References, Agreements, Leads, Opportunities, Pipeline, Territories, Bid/No-Bid, Proposals, Tasks, Team Workload, Calendar, Workflows, Custom Objects, Intake, Analytics, CRM Insights, Settings, Search, Dashboards, Service Desk, Audit log, Login.

Detail pages from the seed: opportunity `46154b62-b971-4357-886c-5413ad12137f` (DNB Bank — Cloud landing zone), contact `8a7b76f2-1b4c-4746-8fb9-b4f10666d806`, company `c0000000-0000-4000-8000-0000000000bc` (Pfizer Ltd UK), lead `00000000-0000-4000-8000-000000000102`, task `00000000-0000-4000-8000-000000010006`.

Keyboard, in addition to the scan: first Tab stops on the dashboard, Skip to content, the new-opportunity dialog (focus, trap, Escape, return), Add widget, the dashboards delete control, `prefers-reduced-motion`, and reflow at 320px CSS width (the 400% equivalent of 1280).

## Counts

| Severity | New | Fixed in a draft here | Already open, not redone |
| --- | --- | --- | --- |
| High | 1 | 1 | 0 new |
| Medium | 3 | 3 | the #398 and #468 set, still open |
| Low | 0 | 0 | map zoom names (#405), timeline target size (sweep 05, left) |

Light list pages were already clean of critical and serious axe hits, except Forecasts and References, which #398 already covers. The new high finding is dark mode.

## Already open, not redone

| What this walk still saw | Where |
| --- | --- |
| Forecast period tabs point `aria-controls` at panels that are not mounted. Notes fields on a contact, a lead, and an opportunity have no accessible name. Reference rows put `aria-expanded` on a `tr`. The company link on a contact underlines only on hover. | #398 |
| Map zoom controls are named only by `title`. `/invoices` and `/sales` are not routes. | #405 |
| Add widget’s dialog starts at y = viewport height. At 1280×800 the panel top was 800 and the height was 611, so the form is below the screen. Focus is inside it, Tab does not leave it, and Escape closes it. The same positioning bug #468 fixes for a phone. | #468 |
| Add widget itself is past the right edge at 390. | #469 |
| Delete dashboard is not in the accessibility tree until hover. At 1280 with no hover, `getByRole('button', { name: /Delete dashboard/i })` found nothing. | #470 |
| Sign out is `display: none` on a phone. | #402 |
| The proposal name is not the click target at 390. | #407 |
| Arabic `dir=rtl` is not on this main. This sweep did not edit those files. | #418 |
| Account timeline marks at 28×28. Sweep 05 left them because the pseudo hit area overlaps the neighbours. | sweep 05 |

#511 and #512 both edit `apps/web/src/index.css`, in different rules (the dark active-item color, and `.skip-link`). #471 appends a phone top-bar rule in the same file. The hunks do not share lines, so these drafts are not stacked.

## Findings fixed here

### 1. High — dark theme uses the fill green as text

`--brand-primary` in dark mode is `#00805e`, documented as a fill (white on it is 4.94:1; the green on the page is about 4:1). `--brand-deep` (`#3fbe93`) is the foreground accent. The active rail item and the account segment counts used the fill.

| Text | Colors | Ratio |
| --- | --- | --- |
| Active “Dashboard” | `#00805e` on `#132a23` | 3.07:1 |
| “All” count | `#00805e` on `#0b1816` | 3.67:1 |
| Other segment counts | `#00805e` on `#0c0c0e` | 3.95:1 |

Normal text needs 4.5:1. At 390 the rail is `display: none`, so the nav failure disappears and the account counts remain.

The existing contrast spec stored the theme under `theme`. The pre-paint script reads `bidstack-theme`, and Playwright’s storageState drops keys set in an init script, so that spec was scanning light mode.

Fixed in draft #511, head `2656698b66ec48970e9c09fe3d75c91777719639`. Red `072351a5b70243d8c870392e09e804cc38e9f89b`. The contrast spec, including `/accounts`, is 15 passed. The active label computes to `rgb(63, 190, 147)`.

### 2. Medium — Skip to content is the 12th tab stop

The link lived in the top bar. The rail is earlier in the DOM. The first Tab on the dashboard at 1280 was Collapse sidebar. Enter on the skip link does move focus to `#main`, once you reach it.

Fixed in draft #512, head `64425dad103f6ca014f68e7f04618842cb005a48`. Red `8a7e9b973c9a0157583f3dc69cad80609dcb76f4`. The link is the first child of the shell, `position: fixed`, and it stays focused for 250ms before Enter. 1 passed.

### 3. Medium — the forecast owner table cannot be scrolled from the keyboard at 390

`TableScrollArea` is `overflow-x-auto` with no tab stop. At 390×844 the weighted-pipeline-by-owner table is wider than the screen. axe `scrollable-region-focusable` reported `.overflow-x-auto`. The desktop forecast list is hidden below `md`; this is the projection table that stays visible.

Fixed in draft #513, head `e2aff40dcea87fdf207d33715b2570c575fa08d6`. Red `4fd32a1738240e663ed1fb1111b33be882744eb4`. The scroll box defaults to `tabIndex={0}` and picks up the global 2px focus ring. Vitest 4 passed. Playwright 1 passed.

### 4. Medium — headings jump from h1 to h3

| Page | Next heading |
| --- | --- |
| `/win-loss` | “Wins vs losses by quarter” |
| `/analytics` | “Pipeline by Stage” (seeded widget title) |
| Lead `…0102` | “Status & scoring” (BANT is the same rank, with no h2 in between) |

Fixed in draft #514, head `e68434b67c645eaf08777bbf9f0ac63f2c14ee64`. Red `2e9a6e4e0cf4f3b18c47cb76b96e3f0be57ef21f`. Chart titles and those two lead cards are h2. The classes are unchanged, so the size is the same. 3 passed.

## Ratchet

Draft #520, head `bfe46c0b36cb95db00b01ba756d43a3b9c0749b6`.

`e2e/a11y/axe-ratchet.spec.ts` scans 15 routes at both viewports and both themes. A critical or serious violation that is not in `axe-ratchet.baseline.json` fails. The baseline has 41 rows from this main: the dark contrast rows (#511), the forecast scroll row (#513), and the #398 rows (forecast tabs, reference rows, unnamed notes, the contact’s company link). A row that stops failing does not fail the test. Delete it when the fix is on main, or that regression will not be caught.

The recorded run, and a second run against the file, each passed in 2.4 minutes.

## What held

- Light theme, list routes other than Forecasts and References: no critical or serious axe violations. Landmarks: a `main`, a banner, and a nav were present.
- Top-bar icon buttons (menu, Jarvis, theme, help, sign out) have accessible names. The only title-only buttons this walk found are the map zoom controls, already in #405.
- Charts on the scanned routes did not fail an image-name or svg-name rule. Dashboard chart widgets expose a text alternative.
- New opportunity dialog: focus starts inside, 15 Tabs stay inside, Escape closes it and returns focus to “+ New opportunity”.
- `prefers-reduced-motion: reduce` on a navigation from the dashboard to Opportunities: the media query matched, no CSS animation was running, and no transformed element was left in `main`.
- Reflow at 320×640 (400% of a 1280-wide layout): `documentElement.scrollWidth` did not exceed `clientWidth` on the dashboard, opportunities, analytics, settings, pipeline, accounts, contacts, or tasks.
- At 390, page-level horizontal overflow was 0 on the routes that reported any other issue. Tables scroll inside their own boxes.
- Login renders without the shell. The public sign page already has its own skip link.

## Left

- The #398, #405, #468, #469, #470, #402, and #407 rows in the table above. They are open drafts. This sweep did not edit their files.
- Arabic layout. #418. Not on this main, and not touched.
- The account timeline marks sweep 05 left alone.
- Create-opportunity field errors. The dialog computes an error id and does not set `aria-describedby` on the inputs. Submitting with an empty name is stopped by the input’s `required` attribute before the Zod messages render, so this walk did not see an unannounced error. Not filed.
- Settings `?tab=data-import` opened the settings overview, not the import wizard, from the URL alone. The unlabeled file input is already in #398. The wizard’s focus trap was not re-proven here.
- The axe ratchet baseline still allows the dark contrast and the forecast scroll box, because those fixes are drafts. Remove those rows when #511 and #513 land on main.
