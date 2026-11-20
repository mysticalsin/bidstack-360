# Real mode audit

Date: 2026-11-20. Baseline: `main` at `40b13242`. This is the state before the foundation in this PR, plus what that foundation changes.

Polo has two switches that used to be one.

- `POLO_DATA_MODE` is the process switch. Unset used to mean demo. It now means real. The only demo value is the exact string `demo`.
- Settings → Demo data is the org switch. It is off until an owner or a system Admin turns it on. While it is off, fixture and sample numbers are not shown.

## Process switch

| Place | What it did when unset | Real mode now |
| --- | --- | --- |
| `apps/api/src/lib/polo-mode.ts` `getPoloDataMode` | Anything other than `real` was demo. | Anything other than `demo` is real. |
| `apps/api/src/env.ts` schema default | `demo`. Real mode refused to boot without Clerk or Cloudflare Access, including in development. | Default `real`. Development and test boot with the existing stub. Production still refuses the stub. |
| `apps/api/src/server.ts` rate limit | Fail-open unless the variable was exactly `real`. | Fail-closed in real mode, which is now the default. Demo stays fail-open. |
| `apps/api/src/plugins/auth.ts` stub | Looked up `org_seed_mantu` and 503'd with "run pnpm db:seed" when the org or user was missing. | In real mode, first local sign-in creates an empty workspace, the system roles, and one admin user. No companies. |
| `packages/db/src/seed.ts` | Refused the fixture seed only when the variable was exactly `real`. Unset still loaded Mantu, CI Financial, and the rest. | Refuses unless the variable is exactly `demo` (or `BIDSTACK_ALLOW_FIXTURE_SEED=true`). |
| `apps/polo-preview/container/entrypoint.mjs` | Sets `POLO_DATA_MODE=demo` on purpose. | Unchanged. That file is in open PR #353. The preview still opts into demo. The org switch still starts off, so sample numbers stay hidden until an admin turns them on. |
| `apps/web` identity banner and Settings → Identity | Reads `dataMode` from `GET /api/v1/identity`. | Shows Real when the variable is unset. |
| `.env.example` | Set `POLO_DATA_MODE=demo`. | The line is commented. Copying the example no longer opts into demo. |
| `docs/enterprise-readiness.md` | Said the default stays demo. | The two sentences that said that now point here. |

`DEMO_MODE` is a different door: the public passwordless sign-in. It stays off unless set, and it still cannot run together with real mode.

## Sample numbers and where they went

| Place | Real mode before | With Demo data off |
| --- | --- | --- |
| `company-enrichment.service.ts` `buildCompanies` | Always appended a Mantu company with 12,000 employees and a made-up revenue. | Omitted. |
| `dashboard.service.ts` | Preferred CI Financial or Mantu, and if the book was empty invented bids (SAM-DEMO, readiness 78, USD 4.2bn), insights at confidence 0.78 and 0.71, and a release score of 95. | Those fallbacks are skipped. Release score is `recorded: false` and the sidebar says Not connected. |
| `dashboard.cockpit.ts` | Merged a sample technology catalog (Microsoft 365, Salesforce, and so on) into an empty stack. | Skipped. A stack the operator saved is kept. |
| `dashboard.queries.ts` `getReleaseScore` | Returned the 95-point sample when no row existed. | Returns the unrecorded score. |
| `account-financials.ts` `loadAccountFinancials` | When a tracked account had no filing, the response was `SAMPLE_FINANCIAL_PERIODS` (EUR 1.2bn revenue) and sample signals. | The route file is in open PR #354, so this PR does not edit it. A `preSerialization` hook clears `sample: true` bodies to an empty list and `statusCopy: "Not connected"`. |
| `account-positioning/load.ts` | Copies those sample financials into the brief and key numbers. | The file is in open PRs #354, #356, and #357. The positioning and key-number routes blank `sample: true` items to "Not connected" and drop sample plays. |
| `apps/web/src/lib/enrichment/client.ts` | `not_configured` and `not_enriched` are replaced with `mockEnrichment` (invented revenue and headcount). | The client file is in open PR #354. The API now returns `not_connected` with null figures, which that client does not treat as sample. The firmographics, hiring, and projects cards say Not connected. |
| Enrichment hiring and projects | Fixture postings (`source: fixture` or `sample: true`) were counted. | Excluded while Demo data is off. |
| Account timeline | Sample watchdog rows stayed until a live signal existed. | Hidden while Demo data is off. |
| FX `GET /api/v1/exchange-rates` | Upstream failure is HTTP 502/503. The selector showed `HTTP 503`. | The selector says Not connected. No rate is invented. |
| `defaultProviderHealth` | Already says unverified, not a fake latency. | Kept. |
| `defaultQueueHealth` | Zeros, not a business total. | Kept. |

## Seeded orgs

| Seed | What it writes | Real mode |
| --- | --- | --- |
| `pnpm db:seed` | Fixture org `org_seed_mantu` ("Mantu (seed)"), users, companies, opportunities, tasks, sample financials. | Refuses unless `POLO_DATA_MODE=demo`. |
| `pnpm db:seed:prod -- --clerk-org <id> --name "..."` | One org, system roles, signing entities. No users and no companies. Refuses `org_seed_mantu` and `demo_org_`. | The production bootstrap. |
| `pnpm db:seed:demo` | Visitor orgs for the public demo door. | Not the real path. |
| First local stub sign-in | Used to require the fixture seed. | Creates an empty Workspace org on `org_seed_mantu` plus Jane Smith as Admin. No CRM rows. |

## Core flows on an empty database

Walked by reading the handlers and the empty-state components. A live browser walk needs Postgres, which this environment did not have running, so the breaks below are the ones in the code.

| Flow | Before | After this PR |
| --- | --- | --- |
| Sign-in | Development with `POLO_DATA_MODE=real` did not boot. Unset booted as demo. An empty database 503'd the stub with "run pnpm db:seed". | Development boots. First sign-in creates the empty workspace. Production still needs Clerk or Cloudflare Access. |
| Create org | No in-app "create org" for the stub. The org is the one auth resolves. | The empty workspace above. A Clerk org still comes from `db:seed:prod`. |
| Add an account | Companies page already has "Add company" and a CSV link. | Unchanged. No Mantu row is invented on the dashboard. |
| Add a contact | Contacts page already has "Add first contact". | Unchanged. |
| Add a deal | Opportunities page already has the create dialog. | Unchanged. |
| Add a task | Tasks page already says "Nothing on the bid clock" and can create one. | Unchanged. The task row layout is in open PR #359 and was not edited. |
| Pipeline | Empty book already says "No opportunities yet" and links to Opportunities. | Unchanged. The board layout is in open PR #361. |
| Dashboard | Empty org already shows Getting started (add an account, open an opportunity). The CRM snapshot underneath still invented Mantu and a 95 release score. | Getting started stays. The invented company, bids, insights, tech catalog, and release score do not. |
| Analytics | Empty list already says "No dashboards yet". | Unchanged. The analytics files are in open PR #355. |
| Customer financials | Sample EUR 1.2bn layout when nothing was filed. | Not connected, no sample periods. |

## Needs an external provider

These degrade. This PR does not add a provider, a key, or a company dataset.

- Company enrichment (Apollo, Seamless). No key: Not connected, no mock revenue.
- Public financials (SEC EDGAR, ESEF). No filing stored: Not connected, no sample statements.
- Foreign exchange (`open.er-api.com`). Provider down: Not connected, cached rates if the browser already has them.
- Dust, MERX/Sovra, and the other provider-health rows. They already say unverified or disabled.
- Release score. No recorded row: Not connected, not 95/100.
- Cloudflare Access or Clerk. Required in production. Not required for local development.
