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
| `apps/polo-preview/container/entrypoint.mjs` | Copied the environment, then set `POLO_DATA_MODE` to `demo`, so the operator could not choose. | That assignment is gone. Unset stays unset and the API default is real. An explicit `demo` in the environment is kept. The org switch is not set here. Preview identity stays Cloudflare Access, which this file already turns on. |
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

## Design: one runtime-mode module

Further toggle and entrypoint code is paused. The behavior above is scattered across env parsing, a settings switch, the identity routes, and the web bundle. That scatter is a refactor, and it should be named before more of it is built. This section is the design. It is not implemented.

### Module

One module, `runtime-mode`, shared by the API, the web app, and the container. It is a pure resolver plus two named enums. The API calls it once per boot and once per authenticated request. Nothing else reads `POLO_DATA_MODE`, `DEMO_MODE`, `CF_ACCESS_AUTH`, `CLERK_SECRET_KEY`, or `VITE_AUTH_MODE` to decide a mode.

```ts
type DataMode = 'real' | 'demo';
type AuthMode = 'stub' | 'cf-access' | 'clerk';

type RuntimeMode = {
  /** Process gate. Unset is real. Only the exact env value "demo" is demo. */
  processData: DataMode;
  /** What this org is allowed to show. Real unless an owner or Admin has turned demo data on. */
  effectiveData: DataMode;
  auth: AuthMode;
};
```

`resolveRuntimeMode(env, orgDemoData)` is the only transition function. `orgDemoData` is absent at boot and on the public identity call. It is present after the request has an org.

The server stores the boot result and returns the request result from the identity endpoint that already exists (`GET /identity` and `GET /me` in `apps/api/src/routes/identity.ts`). The web app reads that payload at runtime. It does not decide auth or data mode from `import.meta.env`.

### Why the web must not read `VITE_AUTH_MODE` from the root `.env`

`apps/web/vite.config.ts:54` calls `loadEnv(mode, <repo root>, 'VITE_')` and uses the result only inside the config (the Clerk-key gate at line 56, the dev proxy URL at line 74). Vite's own `envDir` stays `apps/web`. A `VITE_AUTH_MODE` that exists only in the repository root `.env` is therefore visible to `vite.config.ts` and invisible to the bundle.

The bundle reads `import.meta.env.VITE_AUTH_MODE` at:

- `apps/web/src/lib/auth.tsx:597`
- `apps/web/src/main.tsx:101`
- `apps/web/src/pages/LoginPage.tsx:23`
- `apps/web/src/components/layout/Topbar.tsx:72`

Those four lines never see the root `.env` value. PR #363 (`docs/INSTALL-AND-RUN.md`, `apps/web/src/vite-client-env.test.ts`) is the install guide that recorded this. The runtime-mode module replaces those reads with the identity payload.

### States

| State | How it is entered |
| --- | --- |
| `processData = real` | `POLO_DATA_MODE` is unset, blank, or any value other than the exact string `demo`. |
| `processData = demo` | `POLO_DATA_MODE` is exactly `demo`. |
| `effectiveData = real` | The signed-in org's demo-data flag is off, which is the default. Also the boot and public identity snapshot, which have no org. |
| `effectiveData = demo` | `processData` is `demo` and the org flag is on. The flag alone cannot widen a real process into demo. The process flag alone cannot show sample numbers while the org flag is off. |
| `auth = clerk` | `CLERK_SECRET_KEY` is set. |
| `auth = cf-access` | No Clerk key, and `CF_ACCESS_AUTH` is `true`. |
| `auth = stub` | No Clerk key and Cloudflare Access is off, and the process is allowed to use the stub (see the boot guard). |

`DEMO_MODE` is not a data mode and not an auth mode in this enum. It is the separate public passwordless door. It stays a boot guard: it cannot combine with `processData = real`, with Clerk, or with Cloudflare Access.

### Transitions and guards

Boot, evaluated once:

1. Resolve `processData` and `auth` with no org.
2. If `processData` is `real` and `auth` is not `clerk` and not `cf-access`, refuse to boot. Real mode with no auth configured does not start. There is no silent fallthrough to a shared user.
3. `auth = stub` is a named state only where a development or test process has opted into it. It is not the result of a missing variable in production.
4. If `DEMO_MODE=true` and `processData` is `real`, refuse to boot.

Seed:

- The fixture seed runs only when `processData` is `demo` (or the existing break-glass `BIDSTACK_ALLOW_FIXTURE_SEED=true`). A real process uses `db:seed:prod`, which writes the org and the system roles and no fixture rows.

Who may turn demo data on or off:

- The actor is an owner or a system Admin. The check is the dashboard-editor shape already in the API: the system role named `Admin`, or the `settings:write` owner override. An API key cannot change it.
- Everyone else can read neither the switch nor a sample number.

What happens to demo rows when the switch goes off:

- Rows stay in the database. Turning the switch off is a read gate, not a delete.
- While `effectiveData` is `real`, reads omit `sample` rows and `source = fixture` rows, and they do not substitute mock enrichment, sample financial periods, the house account, or the placeholder release score.
- Turning the switch back on shows the same stored rows again. It does not re-seed.

What the container may do:

- The container calls the same resolver. It may pass an environment through. It may not assign `POLO_DATA_MODE` after reading that environment, and it may not write the org flag.
- Preview auth stays `cf-access`. The entrypoint already sets `CF_ACCESS_AUTH` and the team domain. The worker already passes `CF_ACCESS_AUD` and `POLO_ALLOWED_USERS` (`apps/polo-preview/src/container-env.js:27` and `:29`). No new provider.

### Where the mode is read or forced today

Lines are this branch unless a PR head is named.

| Place | Line | What it does | Open PR |
| --- | --- | --- | --- |
| `apps/api/src/lib/polo-mode.ts` | 13–14 | `getPoloDataMode`: exact `demo`, otherwise `real`. | This branch. Not in #353–#363. |
| `apps/api/src/lib/polo-mode.ts` | 29–33 | `resolvePoloAuthProvider`: clerk, else cf-access, else demo door, else stub. | This branch. |
| `apps/api/src/lib/polo-mode.ts` | 44–70 | Boot guards, including real mode without Clerk or Cloudflare Access. | This branch. |
| `apps/api/src/env.ts` | 42 | Schema default `real`. | This branch. |
| `apps/api/src/env.ts` | 61 | `DEMO_MODE` default `false`. | — |
| `apps/api/src/env.ts` | 525–535 | Real cannot combine with `DEMO_MODE`. Production real requires Clerk or Cloudflare Access. | This branch. |
| `apps/api/src/routes/identity.ts` | 52–58, 70–103 | Re-reads the helpers on every identity call. Does not yet apply the org flag. | — |
| `apps/api/src/server.ts` | 227 | Rate limiter fail-closes when the process mode is real. | This branch. |
| `apps/api/src/plugins/auth.ts` | 374, 393 | Stub provisioning when the process mode is real and the seed org is missing. | This branch. |
| `apps/api/src/plugins/demo-auth.ts` | 44 | `DEMO_MODE===true` arms the public door. | — |
| `apps/api/src/routes/health.ts` | 265 | Local disk in production only when `DEMO_MODE` is true. | — |
| `packages/db/src/seed.ts` | 61–63 | Fixture seed refuses unless the env is exactly `demo`. | Also #355 (analytics seed block, not this guard). |
| `apps/api/src/lib/demo-data.ts` | 30–42 | Org flag read, owner/Admin gate. A second resolver beside `polo-mode.ts`. | This branch. Pause here. |
| `apps/api/src/routes/org-settings.ts` | 328–348 | `GET`/`PUT /org-settings/demo-data`. | This branch. |
| `apps/polo-preview/container/entrypoint.mjs` | 85–99 | Copies `process.env`, sets Cloudflare Access, and on this branch does not assign `POLO_DATA_MODE`. | **#353** still assigns `POLO_DATA_MODE: 'demo'` at line 156 of `runtimeEnv` on `cursor/polo-restore-app-role-2896`. That is the overlap. #353 is open and merges first. Rebase after it lands and delete that one assignment if the rebase keeps it. |
| `apps/polo-preview/src/container-env.js` | 27, 29 | Worker supplies `CF_ACCESS_AUD` and `POLO_ALLOWED_USERS`. Does not set data mode. | — |
| `apps/web/vite.config.ts` | 54–56 | Reads root `VITE_AUTH_MODE` for the build gate only. | #363 adds a test that this value does not reach the client. |
| `apps/web/src/lib/auth.tsx` | 597 | Client auth mode from `import.meta.env`. | — |
| `apps/web/src/main.tsx` | 101 | Same. | — |
| `apps/web/src/pages/LoginPage.tsx` | 23–24 | Same, chooses the demo or Access sign-in screen. | — |
| `apps/web/src/components/layout/Topbar.tsx` | 72 | Same, Clerk chrome. | — |
| `apps/web/src/components/identity/DataModeBanner.tsx` | 34, 75 | Renders the identity payload. The loading placeholder defaults to demo (`:10`). | — |
| `apps/web/src/components/login/CfAccessSignIn.tsx` | 49–50 | Prints `dataMode` from the identity payload. | — |
| `apps/web/src/lib/enrichment/client.ts` | 15–16 | Replaces a not-configured enrichment with `mockEnrichment`. Does not read the mode. | **#354** (`cursor/demo-sample-margin-e9da`) edits this file. |
| `apps/web/src/lib/enrichment/live.ts` | 84 | `not_configured` and `not_enriched` count as sample. | **#354**. |
| `apps/api/src/routes/account-financials.ts` | 79, 93–95 | Injects `SAMPLE_FINANCIAL_PERIODS` when a tracked account has no filing. | **#354**. |
| `apps/api/src/services/account-positioning/load.ts` | 124, 364, 393, 495 | Treats `sample` and `fixture` sources as the sample layout. | **#354** and **#356**. On the #354 head the source check is line 135. |
| `packages/db/src/demo-fixture-postings.ts` | 70 on the #356 head | `demoFixtureShifts` returns null unless `POLO_DATA_MODE === 'demo'`. The file is not on this branch. | **#356** (`cursor/demo-open-jobs-fresh-e79d`). |
| `.github/workflows/ci.yml` | 262, 342 | Seed step opts into `POLO_DATA_MODE=demo`. | This branch. |
| `.github/workflows/e2e.yml` | 98, 210 | Same opt-in. The API process those jobs start does not set the variable, so the suite still looks for a demo banner. | This branch. |
| `.env.example` | 85–89 | Documents unset as real. The commented `POLO_DATA_MODE=demo` is the opt-in. | **#363** also edits `.env.example` for the install guide. |

### Refactor to flag before building

Do not add another reader. Replace `polo-mode.ts` and `demo-data.ts` with `runtime-mode`, keep the identity endpoint as the only wire format, and delete the `import.meta.env.VITE_AUTH_MODE` branches once the web app renders from that payload. #353, #354, #356, and #363 should land or be rebased first, because they still edit the entrypoint, the fixture reads, and the install doc.
