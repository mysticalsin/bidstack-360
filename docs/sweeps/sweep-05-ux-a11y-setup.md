# Sweep 05 — things that are not finished

Lens: buttons that do nothing, dead routes, placeholder copy, missing translations, settings that do not stick, install and config gaps, accessibility, console noise, and rough speed.

Date: 2026-11-21. Base: `main` at `40b13242ebf18d715b67bb6133a9774bbd7d0c78`.

Synthetic only. `POLO_DATA_MODE=demo`, fixture seed org “Mantu (seed)”, no Clerk key, no Dust key, no deploy. Browser: Playwright Chromium 147, viewport 1280×800. API `http://127.0.0.1:4000`, web `http://127.0.0.1:38081`.

94 routes were opened, screenshotted, and scanned with axe-core (`wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa`). Theme and workspace timezone were changed and reloaded. French and Arabic were forced through `bidstack-locale`. Keyboard Tab was sampled on the dashboard, opportunities, pipeline, and appearance settings.

## Install log (README on this main)

The README quick start was followed on a VM with no `node_modules`, no `.env`, and no Docker.

| Step | What happened |
| --- | --- |
| `node -v` | `v22.23.4`. `package.json` engines require `>=24 <25`. `.nvmrc` is `24`. |
| `pnpm install` | Exit 1. `ERR_PNPM_UNSUPPORTED_ENGINE`. `.npmrc` sets `engine-strict=true`. |
| `nvm use 24` | Installed `v24.22.3`, but `node` stayed `/exec-daemon/node` (`v22`) until that directory was put first on `PATH`. |
| `corepack` | pnpm was not on the Node 24 PATH until `corepack enable` and `corepack prepare pnpm@10.27.0 --activate`. |
| Docker | `docker` was not installed. After `apt-get install docker.io`, systemd refused to start the daemon (`policy-rc.d`). `sudo dockerd` worked. |
| `psql` | Not installed until `postgresql-client` was added. |
| `cp .env.example .env` then `source .env.example` | Exit 2. UTF-8 BOM on line 1 (`﻿#: command not found`). Line 283, `NOTIFICATION_FROM_EMAIL=BidStack <notifications@bidstack.app>`, is a syntax error. Later lines also break a shell source: `YJS_COMPACT_CRON=0 */6 * * *` and the unquoted labels `Tech Intel MCP`, `BuiltWith MCP`, `Wappalyzer MCP`. |
| `pnpm db:migrate` | Exit 1. `Environment variable not found: DATABASE_URL`. Prisma runs with cwd `packages/db` and does not read the repo-root `.env`. The example URL is `postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@...`. dotenv does not expand that, and `POSTGRES_PASSWORD` is empty while `docker-compose.yml` hardcodes password `bidstack`. |
| `docker compose up -d` | The comment says Postgres and Redis. The file also builds `migrate`, `api`, `web`, `worker`, and `mcp-server` and publishes ports 4000 and 80, which then collide with `pnpm dev`. |
| README URLs | Web is documented as `http://localhost:5173`. Vite uses port `38081` with `strictPort: true`. |
| Working path used for the walk | Node 24 on `PATH`, `pnpm install`, `docker compose up -d postgres redis`, a local `.env` with `postgres://bidstack:bidstack@localhost:5433/bidstack` (not committed), `pnpm db:generate`, `pnpm db:migrate:deploy` (146 migrations), workspace package builds, `pnpm db:seed`, `pnpm dev:api`, `pnpm dev:web`. Seed printed “Seed complete” for the Mantu fixture org. |

Pull request #363 already rewrites this guide and quotes the `.env.example` lines above. Those rows are covered. Two snags are still worth adding to that guide, and this sweep does not edit its files:

1. `nvm use 24` is not enough when another `node` binary is earlier on `PATH`. The check has to be `command -v node`.
2. A host without systemd does not start `dockerd` after `apt-get install docker.io`.

## What was already covered

| Topic | Where |
| --- | --- |
| Rail tagline “Mantu · Bid & presales”, including the `title` on `.sb-tag` | #358 |
| Task row date, “N active follow-ups”, calendar toolbar height | #359 |
| Dashboard chart how-to lines, HEMA sentence, performance tagline | #360 |
| Pipeline columns sliced at 1280, drag sentence | #361 |
| Accounts filters stacked, summary said three times, card essay | #362 |
| Helper lines on Pipeline, Opportunities, and Accounts; missing `crm.pipelineCardMoveTitle`; leftover subtitles; `title` on non-focusable account coverage and “11 logos / 11 tech” | #366. The same `title`-on-a-`div` pattern is also on `.tb-user` (the email) and the breadcrumb `.here` span. Treated as that follow-up, not a new fix. |
| Install rewrite, BOM, concrete `DATABASE_URL`, `pnpm db:migrate:deploy`, Vite port 38081, `source` quoting | #363 |
| README screenshot placeholder and `docs/media` (the directory is not in this tree; README still says screenshots will be added when production is provisioned) | README agent |

No visible “coming soon”, lorem, or TODO copy turned up on the 94 routes. Theme (`bidstack-theme`) survived reload. Saving the workspace timezone to `America/New_York` returned 200 from `PUT /api/v1/org-settings/locale` and was still selected after reload. Tab from the dashboard shows a 2px solid focus ring, starting at “Collapse sidebar”, then the section buttons.

## Findings

### 1. High — public booking sits inside the CRM shell

`/book/test-slug` rendered the sidebar, the demo banner, and Jane Smith around a public scheduling page. `/sign/:token` already opts out. `/login/factor-two` also stays in the shell because `App.tsx` only special-cases the exact path `/login`.

![Booking page inside the workspace shell](sweep-05/booking-inside-shell.png)

Fixed in draft #392, head `be973f1e70636bb93ba840a2cbb3b63465d28c79`. After that change the same URL is only the scheduling page.

![Booking page without the shell](sweep-05/booking-without-shell.png)

### 2. High — axe critical and serious failures on pages the list scan skips

`e2e/a11y/axe.spec.ts` already scans the list routes and those were clean. These were not in that list. Counts are critical or serious only.

| Route | Rule | What was on screen |
| --- | --- | --- |
| `/forecasts` | `aria-valid-attr-value` (critical) | Period controls are tabs. `aria-controls` pointed at `radix-…-content-monthly` and the quarter ids. Those elements were not in the document. |
| `/settings?tab=crm` | `select-name` (critical) | Custom-field entity `<select class="input text-sm">` had no label. |
| `/settings?tab=data-import` | `label` (critical) | The hidden file input had no accessible name. |
| `/book/test-slug` | `aria-required-children` (critical) | The day list was `role="grid"` and its children were buttons, not rows or grid cells. |
| `/contacts/:id`, `/leads/:id`, `/opportunities/:id` | `aria-input-field-name` (serious) | The notes ProseMirror `role="textbox"` had no name. |
| `/contacts/:id` | `link-in-text-block` (serious) | The company link used brand color and underlined only on hover. |
| `/references` | `aria-conditional-attr` (serious) | Expandable `<tr>` elements had `aria-expanded`. |
| `/settings?tab=identity` | `dlitem` (serious) | “Data mode” and the other rows were `dt`/`dd` inside a `div`, not a `dl`. |
| `/settings?tab=webhooks` and `/webhooks` | `scrollable-region-focusable` (serious) | The signature `<pre class="max-h-[420px] overflow-auto">` could not be focused. |
| `/accounts/:id` | `target-size` (serious) | Timeline marks (`.sg-mark`) overlap. The button box is 28×28 and `::after { inset: -8px }` widens the hit area past the neighbours. Not changed. Axe does not count the pseudo-element as the target. |

![Forecast period tabs](sweep-05/forecasts.png)

![Contact detail, unnamed notes field and color-only company link](sweep-05/contact-detail.png)

![Unlabeled custom-field entity select](sweep-05/settings-crm.png)

![Identity rows that were not a definition list](sweep-05/settings-identity.png)

![Reference rows with aria-expanded on the tr](sweep-05/references.png)

![Account timeline marks axe flagged for target size](sweep-05/account-detail.png)

Fixed, except the timeline marks, in draft #398, head `d492f8bfc95f2541d340348131068f7db25f2f38`. The ten new axe tests passed against this seeded app. `tsc --noEmit` for `@bidstack/web` exited 0.

The same color-only link class (`hover:underline` with brand color) is still on win/loss, toolkits, the report builder, admin RFP, company detail, cross-sell, report pickers, and three dashboard cards. Only the contact link axe actually failed was changed.

### 3. Medium — Agreements and Meetings stay in English in three locales

`nav.agreements`, `nav.meetings`, `breadcrumbs.agreements`, and `breadcrumbs.meetings` are missing from French, Spanish, and Italian `common.json`. The rail calls `t(labelKey, englishFallback)`, so the raw key is not shown. The English word sits next to translated labels. Portuguese and Chinese already have the keys.

A French dashboard still translated the page title. The missing keys are the rail section and the breadcrumb, not the whole page.

![French dashboard](sweep-05/fr-dashboard.png)

Fixed in draft #395, head `aaed1f836c5ba4bfcc3f8f9c3a06e4d431a72cf0`. The new test requires every English `common.json` key in `fr`, `es`, `pt`, `it`, and `zh`. It was red with those twelve keys, then green.

Not fixed, and called out so the test is not read as “every string is translated”:

- Arabic is in `SUPPORTED_LOCALES` and is hidden in the switcher until RTL is reviewed. Five namespaces are `{}` (`ai`, `auth`, `onboarding`, `reports`, `signatures`). About 5,113 English keys are absent. Forcing `bidstack-locale=ar` left the UI in English via fallback. No raw keys.
- French, Spanish, Portuguese, Italian, and Chinese are still missing on the order of 180–230 keys outside `common.json` (examples: `settings.appearance.accentTitle`, `crm.accounts.paginationLabel`). Those calls that pass an English default do not show a raw key.
- Settings → Modules and Signing entities are not in the `itemLabel` switch, so they always render the English string from the group list.

### 4. Low — routes that 404 and are not in the nav

| URL | Result |
| --- | --- |
| `/invoices`, `/sales`, `/sales/orders` | “Page not found”. Nothing in the nav links here. `useDocumentTitle` still maps `/sales`. The older axe list includes `/invoices` and `/sales`, so that scan is scoring the 404. |
| `/dashboards/da5b0000-0000-4000-8000-000000000001` | 404. The list route `/dashboards` renders. There is no `:id` route. |
| `/this-route-does-not-exist` | 404, as expected. Two console 404s for the missing chunk or asset. |

![Invoices 404](sweep-05/invoices-404.png)

Not fixed. They are not linked from the rail.

### 5. Low — console noise on otherwise working pages

| Where | Message |
| --- | --- |
| Opportunity detail | `GET /api/v1/bid-scores/9e962498-dfe1-4006-953c-6e48f932d56d/latest` returned 404. The page still rendered. |
| Many routes | `manifest.json` was preloaded and not used within a few seconds. |
| Org chart | React Flow: attribution hidden, Pro subscription warning. |
| Agreements whitespace | Recharts: chart width and height were `-1`. |

No other `pageerror`s. Audit log text that looks like `msa.view` is the permission code stored on the event, not a missing translation.

### 6. Low — map zoom buttons are named only by `title`

Sector view and territories render three `h-7 w-7` buttons (zoom in, zoom out, reset) whose only name is the `title` attribute. Axe did not fail `button-name`, because `title` counts. They do zoom. They are not dead. A name via `aria-label` would survive when `title` is not exposed.

![Sector view zoom controls](sweep-05/sector-view.png)

Not fixed.

### 7. Info — rough Lighthouse, dev server only

Lighthouse 13 against the Vite dev server, dashboard, headless Chromium, one run:

| Metric | Value |
| --- | --- |
| Performance | 39 |
| Accessibility (Lighthouse’s subset) | 100 |
| LCP | 84.9 s |
| Speed index | 32.0 s |
| TBT | 1,290 ms |
| CLS | 0.011 |

This is the dev server compiling modules on request, not a production build. CLS is the number that is meaningful here. The Lighthouse accessibility score did not see the failures in finding 2, because those routes were not the URL under test.

![Dashboard used for the Lighthouse run and the main walk](sweep-05/dashboard.png)

## Fix pull requests

| Class | PR | Head |
| --- | --- | --- |
| Public shell | https://github.com/mysticalsin/bidstack-360/pull/392 | `be973f1e70636bb93ba840a2cbb3b63465d28c79` |
| Locale key completeness (`common.json`) | https://github.com/mysticalsin/bidstack-360/pull/395 | `aaed1f836c5ba4bfcc3f8f9c3a06e4d431a72cf0` |
| Axe names and ARIA on the pages the list scan missed | https://github.com/mysticalsin/bidstack-360/pull/398 | `d492f8bfc95f2541d340348131068f7db25f2f38` |

All three are drafts from `main`.
