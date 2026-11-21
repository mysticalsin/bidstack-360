# Polo

Polo is a CRM and bid platform for presales teams. It keeps accounts, the bid pipeline, follow-up tasks, and RFP work in one place, and it puts a widget dashboard on the front of that book of work.

The hosted app is a [Cloudflare Worker](apps/polo-preview/wrangler.toml) in front of a [Cloudflare Container](apps/polo-preview/container/entrypoint.mjs), with [Cloudflare Access](apps/polo-preview/src/worker.js) on the door. This repository is the Polo codebase (`mysticalsin/bidstack-360`).

The clips below were recorded from a local stub session and fictional records only. No customer export and no external API key was used.

## Contents

- [Accounts](#accounts)
- [Pipeline](#pipeline)
- [Dashboard widgets](#dashboard-widgets)
- [Tasks](#tasks)
- [CSV import](#csv-import)
- [RFP flow](#rfp-flow)
- [How it is hosted](#how-it-is-hosted)
- [Local quick start](#local-quick-start)
- [Runtime modes](#runtime-modes)
- [Testing](#testing)
- [Contributing](#contributing)
- [Documentation](#documentation)

## Accounts

Open an account and the cockpit is the account: pipeline, contacts, files, and the public signals the product already knows how to show when they are empty.

<img src="docs/media/accounts.gif" alt="Accounts list of fictional companies, then the Lumen and Lark cockpit" width="720">

`/accounts` builds its cards from the CRM dashboard snapshot (recent opportunities and enrichments). `/accounts/:accountId` opens that account's cockpit.

## Pipeline

The board is the bid stages configured for the org: S1 Lead through Closed Won and Closed Lost. A card opens the opportunity. With write access, the left and right arrow keys move the focused card a stage.

<img src="docs/media/pipeline.gif" alt="Pipeline board with fictional bids, then a keyboard move into the next stage" width="720">

The stage list is created on read in `apps/api/src/routes/pipeline-stages.ts`. The board is `/pipeline`.

## Dashboard widgets

`/` redirects to `/dashboard`. The home screen is a widget layout: a KPI row (companies, pipeline, tasks, and the rest of the org summary), a pipeline chart, what needs attention, and recent activity. Choosing a number opens the matching list.

<img src="docs/media/dashboard.gif" alt="Home dashboard widgets for a fictional book of work" width="720">

`/analytics` is a second surface: a saved widget grid. Adding or deleting a widget calls `/api/dashboards/:id/widgets` and requires `reports:write`.

## Tasks

Tasks are the follow-ups on the book of work: open, in progress, blocked, and done, with due dates and an overdue filter. Anyone with `tasks:write` can add one from the list.

<img src="docs/media/tasks.gif" alt="Task list, overdue filter, and creating a fictional follow-up" width="720">

The list is `/tasks`. A row opens `/tasks/:id`.

## CSV import

Settings → Data import (`/settings?tab=data-import`) takes a CSV or Excel file for companies, contacts, leads, opportunities, or account financials. You map columns, preview the rows, then confirm. The worker queue writes the rows.

<img src="docs/media/csv-import.gif" alt="CSV import wizard mapping fictional company columns and previewing the rows" width="720">

The wizard is `apps/web/src/components/import/CsvImportWizard.tsx`. The field catalog is `apps/web/src/lib/import-fields.ts`.

## RFP flow

RFP work on this branch has three doors:

- `/intake` receives documents in four steps: Receive, Extract, Review, Publish.
- `/proposals` is the proposal workspace. A proposal has a status and sections.
- `/rfp/:id/pipeline` is the automation pipeline for one opportunity. At rest it shows the upload zone (extract, story match, draft, compliance, approval).

The clip opens a fictional proposal, then the pipeline upload for that bid. It does not call a model. Live drafting needs a provider configured outside this repository, and nothing here ships a key.

<img src="docs/media/rfp.gif" alt="A fictional proposal and the RFP pipeline upload zone" width="720">

`/rfp-response` redirects to `/proposals`.

## How it is hosted

On the checked Worker config, a browser hits Cloudflare Access, then the `polo-preview` Worker. The Worker verifies the Access JWT and, when the `PREVIEW` binding is present, forwards the request to one Container named `main`. That container's entrypoint listens on port 8080, serves the built web app, and proxies `/api`, `/health`, `/readyz`, `/livez`, `/metrics`, and `/webhooks` to Fastify on port 4020. Postgres and Redis run in the same container. The Worker cron asks the container for a snapshot when data has changed and stores it in the `BACKUPS` R2 bucket, because the container disk is wiped on restart.

```mermaid
flowchart LR
  browser[Browser]
  access[Cloudflare Access]
  worker[Worker polo-preview]
  r2[(R2 snapshots)]
  subgraph container [Container PreviewOrigin]
    front["entrypoint :8080"]
    api["Fastify :4020"]
    jobs[BullMQ worker]
    pg[(Postgres)]
    redis[(Redis)]
  end
  browser --> access --> worker
  worker --> front
  front --> api
  api --> pg
  api --> redis
  jobs --> pg
  jobs --> redis
  worker -.-> r2
```

If `PREVIEW` is not bound, the same Worker relays HTTP to a box through the Relay durable object instead of the container. The checked `wrangler.toml` binds `PREVIEW`. WebSocket upgrades on that front door return 501. The Worker is not deployed by CI.

Local `pnpm dev` does not start the Worker or the container. It runs the Vite app, the API, the BullMQ worker, and the MCP server against Postgres and Redis.

`docs/ARCHITECTURE.md` still describes that local Fastify shape. It was last reviewed on 2026-05-24. The hosted path above is the one in `apps/polo-preview/` on this branch.

## Local quick start

The long install, including the real-mode edit and the Worker, is not on `main`. It is in review as [pull request #363](https://github.com/mysticalsin/bidstack-360/pull/363) (`docs/INSTALL-AND-RUN.md`). This section is only the local demo path that matches the files on `main` today. It does not repeat that guide.

You need Node 24 (`.nvmrc`), pnpm 10.27.0 (`packageManager` in `package.json`), and Docker.

```bash
pnpm install --frozen-lockfile
docker compose up -d postgres redis
```

Compose publishes Postgres on host port **5433** and Redis on **6380**, with user, password, and database `bidstack` (`docker-compose.yml`). Copying `.env.example` does not produce a working URL: `DATABASE_URL` contains `${POSTGRES_USER}` and the password is empty, and the apps load env with `dotenv-flow`, which does not expand those references. Write the URLs literally:

```bash
cat > .env <<'EOF'
DATABASE_URL=postgres://bidstack:bidstack@127.0.0.1:5433/bidstack
REDIS_URL=redis://127.0.0.1:6380
POLO_DATA_MODE=demo
EOF

pnpm db:generate
pnpm --filter @bidstack/shared build
pnpm db:migrate:deploy
pnpm db:seed
pnpm dev
```

`pnpm db:migrate` is `prisma migrate dev`. Use it when you are creating a migration. `pnpm db:migrate:deploy` applies the migrations already in the tree and does not prompt.

`pnpm db:seed` loads the prototype fixtures in `packages/db/src/seed-data.ts` (named companies and people) into the demo org `org_seed_mantu`. Do not point it at a database that holds real accounts. With `POLO_DATA_MODE=real` the command refuses unless `BIDSTACK_ALLOW_FIXTURE_SEED=true`. A real tenant, system rows only, is `pnpm db:seed:prod`.

Then open:

| Surface | URL |
| --- | --- |
| Web (Vite) | http://127.0.0.1:38081 |
| API | http://127.0.0.1:4000 |
| API health | http://127.0.0.1:4000/health |
| MCP | http://127.0.0.1:4001 |

The web dev server port is `38081` in `apps/web/vite.config.ts`, not 5173. `pnpm dev` also starts the other workspace `dev` scripts, including the marketing site on Vite's default port. `pnpm dev:web` and `pnpm dev:api` start one app. Both web scripts set `VITE_AUTH_MODE=stub`.

## Runtime modes

Two switches are independent: what data the API will accept, and who the API believes you are.

### Data

`POLO_DATA_MODE` is `demo` or `real`. The default in `apps/api/src/env.ts` is **`demo`**.

| | `demo` (default) | `real` |
| --- | --- | --- |
| Fixture seed | Allowed outside production | Refused, unless `BIDSTACK_ALLOW_FIXTURE_SEED=true` |
| Stub sign-in | Allowed in development and test | Refused |
| `DEMO_MODE=true` | Allowed, with its own rules below | Refused |
| Rate limit when Redis errors | Fail open | Fail closed |

The container entrypoint sets `POLO_DATA_MODE` to `demo` in the environment it hands the API and the worker, after it has read the process environment. A container built from this branch stays on demo data until that line changes.

The web shows a banner while the API reports demo data (`apps/web/src/components/identity/DataModeBanner.tsx`).

### Auth

`apps/api/src/lib/polo-mode.ts` picks one provider. Clerk wins if `CLERK_SECRET_KEY` is set, then Cloudflare Access, then the public demo door, then the stub.

| Provider | API | Web |
| --- | --- | --- |
| Stub | No Clerk key, `CF_ACCESS_AUTH` is not `true`, `DEMO_MODE` is not `true`, and `NODE_ENV` is `development` or `test`. Loopback only. The session is the first user in org `org_seed_mantu`. | `VITE_AUTH_MODE=stub`, which `pnpm dev` and `pnpm dev:web` force. The header label is the built-in stub user. |
| Clerk | `CLERK_SECRET_KEY` set. Cannot run beside `DEMO_MODE` or `CF_ACCESS_AUTH=true`. | `VITE_AUTH_MODE=clerk` (`pnpm --filter @bidstack/web build:prod`). Requires `VITE_CLERK_PUBLISHABLE_KEY`. |
| Public demo | `DEMO_MODE=true`, no Clerk key, Access off. Any email gets its own org. In production the process also requires `DEMO_PUBLIC_DEPLOYMENT_ACK=true` and `DEMO_SESSION_SECRET`. | `VITE_AUTH_MODE=demo` (`pnpm --filter @bidstack/web build:demo`). |
| Cloudflare Access | `CF_ACCESS_AUTH=true`, no Clerk key. The API checks the Access JWT (`CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`). | `VITE_AUTH_MODE=cf-access`. The login page is the Access card. |

`NODE_ENV=production` refuses to boot with none of Clerk, Access, or the demo door. The hosted Worker verifies Access before the container sees the request. The one-time email code path exists in the Worker, and the `send_email` binding in `wrangler.toml` is commented out, so the checked config does not send codes.

## Testing

| Command | What it runs |
| --- | --- |
| `pnpm test` | Hermeticity check, package builds, then Vitest across the workspace |
| `pnpm --filter @bidstack/web test` | Web unit tests |
| `pnpm --filter @bidstack/web e2e:smoke` | Playwright smoke (`e2e/smoke.spec.ts`, Chromium) |
| `pnpm --filter @bidstack/web e2e` | Playwright suite under `apps/web/e2e` |

Pull requests to `main` run `.github/workflows/ci.yml` in order: unit (typecheck, lint, tests, build, bundle guard), then integration against Postgres 16 and Redis 7, then the Playwright smoke. The same workflow also runs a full-tree secret scan. `.github/workflows/e2e.yml` runs the broader Playwright suite. `.github/workflows/gitleaks.yml` scans history.

Integration tests expect `DATABASE_URL` and `REDIS_URL`. They fail if Postgres is missing, rather than skipping.

## Contributing

Work lands on `main` through a pull request. The flow used for changes in this repository:

1. **Red first.** Add a test that fails for the behavior you are changing, in the same pull request as the fix. That is the pattern recorded in `docs/solutions/` (for example `docs/solutions/worker-production-env-fail-fast.md`). CI does not have a separate job that rejects a pull request for skipping it.
2. **Draft while it is moving.** Open the pull request as a draft so the gates run before you ask for review. Mark it ready when the red test is green and you want a reviewer.
3. **Gates before merge.** The unit job has to pass before integration, and integration has to pass before the smoke. `docs/BRANCH_PROTECTION.md` is the checklist a maintainer applies so GitHub also requires those checks, one review, and resolved conversations. The workflows themselves run on every pull request to `main`.

Do not force-push `main`. Do not deploy the `polo-preview` Worker from CI.

`packages/twenty-bidstack/` is preserved for a later Twenty migration. `packages/db/prisma/migrations/` is generated. Do not hand-edit either.

## Documentation

| Document | What it is |
| --- | --- |
| [Pull request #363](https://github.com/mysticalsin/bidstack-360/pull/363) | Install and real-mode guide (`docs/INSTALL-AND-RUN.md`). Not on `main` yet. |
| [`SPEC.md`](SPEC.md) | Product spec. The brand line in the spec still says BidStack 360°. |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Local Fastify topology, reviewed 2026-05-24. |
| [`apps/polo-preview/README.md`](apps/polo-preview/README.md) | Worker, Access, and the box relay. |
| [`docs/solutions/polo-cloudflare-preview.md`](docs/solutions/polo-cloudflare-preview.md) | Why the preview is shaped this way. |
| [`docs/BRANCH_PROTECTION.md`](docs/BRANCH_PROTECTION.md) | Required checks and reviews for `main`. |
| [`docs/RUNBOOK.md`](docs/RUNBOOK.md) | Deploy, rollback, key rotation. |
| [`DEPLOY.md`](DEPLOY.md) | Public demo on Vercel and Railway, plus the Access preview. |
| [`docs/enterprise-readiness.md`](docs/enterprise-readiness.md) | Data-mode and identity gates. |
| [`docs/PRODUCTION_DATA_BOOTSTRAP.md`](docs/PRODUCTION_DATA_BOOTSTRAP.md) | Bootstrapping a real tenant. |
| [`docs/GO-LIVE-SELFHOST.md`](docs/GO-LIVE-SELFHOST.md) | Self-hosted go-live notes. |
| [`docs/RFP_RESPONSE_OPERATING_MODEL.md`](docs/RFP_RESPONSE_OPERATING_MODEL.md) | How an RFP response is operated. |
| [`docs/DUST.md`](docs/DUST.md) | Dust integration. |
| [`docs/MCP.md`](docs/MCP.md) | MCP server. |
| [`docs/DESIGN.md`](docs/DESIGN.md) | Design principles. |
| [`CHANGELOG.md`](CHANGELOG.md) | Feature changelog. |

There is no `LICENSE` file at the repository root.

Refresh the clips with `pnpm exec tsx scripts/record-readme-media.mts` after Postgres, Redis, and `pnpm install`. The script refuses any database name other than `bidstack_readme`, and it inserts fictional rows instead of running `pnpm db:seed`.
