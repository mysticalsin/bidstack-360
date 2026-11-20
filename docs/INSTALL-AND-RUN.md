# Install Polo and run it

Polo is the BidStack 360° CRM in this repository. This page is for someone who has never opened it. It was checked by cloning `main` at `40b13242ebf18d715b67bb6133a9774bbd7d0c78` into an empty directory and running the commands below. A step that was not run is marked **Not verified**, with the reason.

Production deploys need Tony's approval. Do not run `wrangler deploy` from CI, and do not put a real secret in git, in this file, or in a screenshot.

## 1. Prerequisites

`.nvmrc` is `24`. `package.json` says Node `>=24.0.0 <25` and pnpm `10.27.0` (`packageManager`). Postgres is the `pgvector/pgvector:pg16` image. Redis is `redis:7-alpine`. `pnpm db:backup:selftest` also needs the `psql` client on the host.

If `node -v` does not print `v24`, install Node 24 with nvm. The installer and the version check are the official ones: [nvm](https://github.com/nvm-sh/nvm#installing-and-updating). [fnm](https://github.com/Schniz/fnm) is the other installer that reads `.nvmrc` (`fnm install` && `fnm use`).

```bash
# https://github.com/nvm-sh/nvm#installing-and-updating
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
# Open a new shell so nvm is on PATH, then:
nvm install 24
nvm use 24
node -v    # must print v24.x.x. v22 fails pnpm install with ERR_PNPM_UNSUPPORTED_ENGINE.
corepack enable
corepack prepare pnpm@10.27.0 --activate
pnpm -v    # 10.27.0
```

Docker is not installed by the repo. Use the official packages: [Docker Engine](https://docs.docker.com/engine/install/). Then:

```bash
docker --version
docker compose version
```

Both commands must print a version. This clone used Docker `29.1.3` and Compose `2.40.3`.

`pnpm db:backup` and `pnpm db:backup:selftest` run `pg_dump` and `psql`. The server inside Compose is Postgres 16. Install a 16 client. On Ubuntu or Debian:

```bash
sudo apt-get update
sudo apt-get install -y postgresql-client
psql --version    # PostgreSQL 16.x
```

On macOS the official packages are [Postgres.app](https://postgresapp.com/) or `brew install libpq`, and `psql --version` is the same check. Without `psql` on `PATH`, the selftest exits before it creates a database.

| Tool | Required by the repo | Check |
| --- | --- | --- |
| Node.js 24 | `.nvmrc`, `engines.node` | `node -v` prints `v24` |
| pnpm 10.27.0 | `packageManager` | `pnpm -v` |
| Docker Engine + Compose | `docker-compose.yml` | `docker --version` and `docker compose version` |
| PostgreSQL 16 server | image `pgvector/pgvector:pg16`, started by Compose | `docker compose exec postgres postgres -V` |
| Redis 7 | image `redis:7-alpine` | `docker compose exec redis redis-server --version` |
| `psql` / `pg_dump` 16 | `scripts/backup-postgres.sh`, `scripts/backup-restore-selftest.sh` | `psql --version` |
| Wrangler | not a dependency; `apps/polo-preview/wrangler.toml` | **Not verified.** No pinned version. |

## 2. Clone, install, and environment

```bash
git clone --branch main --single-branch https://github.com/mysticalsin/bidstack-360.git
cd bidstack-360
pnpm install --frozen-lockfile
```

`pnpm install --frozen-lockfile` completed on the fresh clone. The API, worker, and database scripts load the repo-root `.env` through dotenv-flow. The Prisma CLI does not. It reads `packages/db/.env` or the variables already exported in the shell. A root `.env` alone makes `prisma migrate deploy` fail with `Environment variable not found: DATABASE_URL`.

```bash
cp .env.example .env
set -a
source .env
set +a
```

`docker-compose.yml` does not read `POSTGRES_PASSWORD` from `.env`. It hardcodes user `bidstack`, password `bidstack`, database `bidstack`, host port `5433`, and Redis host port `6380`. Those are local defaults already committed in the compose file. dotenv does not expand `${POSTGRES_USER}` inside `.env`, so `.env.example` now uses a concrete local URL:

```text
DATABASE_URL=postgres://bidstack:bidstack@localhost:5433/bidstack
REDIS_URL=redis://localhost:6380
```

Replace both for any database that is not this local compose file. Never commit the production URL.

### Real mode on a laptop

Copying `.env.example` leaves `POLO_DATA_MODE=demo`. That is still the default on this `main` (`apps/api/src/env.ts`). [Pull request #364](https://github.com/mysticalsin/bidstack-360/pull/364) is the separate foundation change that makes real mode the default. Until that lands, run this after `cp .env.example .env`. It rewrites the copied file. It does not append a second `POLO_DATA_MODE` line.

```bash
cp .env.example .env
for pair in \
  POLO_DATA_MODE=real \
  CF_ACCESS_AUTH=true \
  CF_ACCESS_TRUST_LOOPBACK_EMAIL=true \
  POLO_ALLOWED_USERS=owner@example.test:Admin \
  POLO_REAL_ORG_CLERK=org_local_example
do
  key="${pair%%=*}"
  val="${pair#*=}"
  grep -v "^${key}=" .env > .env.tmp || true
  printf '%s=%s\n' "$key" "$val" >> .env.tmp
  mv .env.tmp .env
done
```

Real mode refuses the shared Jane Smith stub. It boots only with Clerk (`CLERK_SECRET_KEY`) or with Cloudflare Access (`CF_ACCESS_AUTH=true`). Those two cannot be set together. `DEMO_MODE=true` cannot be set with either, and cannot be set with `POLO_DATA_MODE=real`.

`CF_ACCESS_TRUST_LOOPBACK_EMAIL=true` is accepted only when `NODE_ENV` is `development` or `test`. Production boot refuses it. The API then accepts `Cf-Access-Authenticated-User-Email` from `127.0.0.1` only. `POLO_ALLOWED_USERS` is `email:Role` or `@domain:Role`. The role is one of Admin, Sales Manager, Account Executive, SDR, Customer Success, Read-Only.

`POLO_DATA_MODE=demo` is only for a demo. It is the fixture tenant, the demo banner, and sample filings. Do not load real accounts, revenue, or signed MSAs in that mode. Putting `VITE_AUTH_MODE=cf-access` in the repo-root `.env` does not change the browser. Vite does not read that file. Section 4 is the file Vite does read.

### Settings does not flip the mode

Settings → Identity & roles shows **Data mode** as a badge, Real or Demo, from `GET /api/v1/identity`. There is no switch on that screen that writes `POLO_DATA_MODE`. Changing the mode means changing the environment and restarting the API and the worker.

Two other controls are easy to confuse with that badge:

- The sample-data banner (`Sample data is on` / `Remove sample data`) deletes onboarding rows tagged as samples. It does not change the data mode.
- Settings → SERUM shows a demo-mode flag (`SERUM_DEMO_MODE_ENABLED`). That flag defaults to `false`, and production boot refuses `true`. It is not Polo's data mode.

### What the processes read

`.env.example` lists every name the API schema validates, plus the web, worker, and container names that were missing from the example on this commit. Blank means unset. Example values are synthetic.

The API refuses to start if `DATABASE_URL` is missing. Everything else in `apps/api/src/env.ts` has a default or is optional in development. In `NODE_ENV=production` the API also requires:

- `PUBLIC_BASE_URL` as `https://` and not a loopback host
- `DATABASE_URL_APP` (a Postgres URL whose login is `app_role` on Polo), and it refuses `DATABASE_URL_OWNER` on the API
- `REDIS_URL` as `redis://` or `rediss://`, not localhost
- `STORAGE_DRIVER=s3` with `S3_BUCKET`, unless `DEMO_MODE=true` or `BIDSTACK_ALLOW_LOCAL_STORAGE=true` (local disk is wiped on restart)
- `INTEGRATION_TOKEN_KEY` and `PII_ENCRYPTION_MASTER_KEY`, each 64 hex characters (`openssl rand -hex 32`)
- `PII_FIELD_ENCRYPTION=true`
- `BIDSTACK_JOB_SIGNING_SECRET` or `JOB_SIGNING_SECRET` (the same value on the API and the worker)
- `BIDSTACK_TENANT_SCOPE_GUARD` of `warn` or `enforce`

The worker in production requires `DATABASE_URL`, `DATABASE_URL_APP`, `DATABASE_URL_OWNER` (different login from the app URL), `REDIS_URL` (not loopback), the same two 64-hex keys, `PII_FIELD_ENCRYPTION` exactly `true`, the job-signing secret, and the tenant-scope guard.

The browser reads `import.meta.env.VITE_*` from Vite. `apps/web/vite.config.ts` does not set `envDir`, so that directory is `apps/web`, not the repo root. `pnpm dev:web` is `cross-env VITE_AUTH_MODE=stub vite`, and a variable already in the process wins over the env file. Section 4 is the working command.

The container (`apps/polo-preview/container/entrypoint.mjs`) reads `POLO_INTERNAL_KEY`, `POLO_APP_DB_PASSWORD`, and optionally `POLO_INTEL_USER_AGENT` and `API_RATE_LIMIT_MAX`. It then forces `POLO_DATA_MODE=demo`, `CF_ACCESS_AUTH=true`, and a private Redis URL. That forced demo mode is the container as configured on this commit. See Known limits.

Worker secrets are names only. Set them with `wrangler secret put <NAME>`. Do not write the values into `wrangler.toml`.

| Secret name | What it is |
| --- | --- |
| `POLO_INTERNAL_KEY` | Worker to container control calls |
| `POLO_INTEGRATION_TOKEN_KEY` | Becomes `INTEGRATION_TOKEN_KEY` (64 hex) |
| `POLO_PII_ENCRYPTION_MASTER_KEY` | Becomes `PII_ENCRYPTION_MASTER_KEY` (64 hex) |
| `POLO_JOB_SIGNING_SECRET` | Becomes `BIDSTACK_JOB_SIGNING_SECRET` |
| `POLO_APP_DB_PASSWORD` | Password for the `app_role` login |
| `RELAY_KEY` | Box relay, if the container binding is absent |
| `SESSION_SECRET` | One-time-code sign-in. Off until `OTP_FROM` and the email binding exist |

`ACCESS_AUD`, `ALLOWED_EMAILS`, `POLO_ADMIN_EMAILS`, and `PUBLIC_ORIGIN` are Worker vars in `wrangler.toml`, not secrets. The two encryption keys must not be rotated casually: R2 snapshots hold ciphertext from them.

Test-only names (`E2E_*`, `CI`, `AUDIT_SHOT_DIR`, `TZ`) are read by Playwright and Vitest. They are not in `.env.example`.

## 3. Database

Start only the data services. The full compose file also builds the app images and binds port 4000 and port 80.

```bash
docker compose up -d postgres redis
```

Verified: both containers became healthy, Postgres 16.16 on `localhost:5433`, Redis 7.4.12 on `localhost:6380`.

```bash
set -a && source .env && set +a
pnpm db:generate
pnpm --filter @bidstack/shared build
pnpm db:migrate:deploy
```

`pnpm db:generate` wrote the Prisma client (Prisma 5.22.0). `pnpm db:migrate:deploy` applied 146 migrations, including `CREATE EXTENSION` for vector, and printed `All migrations have been successfully applied.` The safe-migrate wrapper skips the backup proof gate when `NODE_ENV=development`.

`pnpm db:seed:prod` imports `@bidstack/shared` from `dist/`. Its script does not build that package. Without the build above it exits `ERR_MODULE_NOT_FOUND`. After the build:

```bash
pnpm db:seed:prod -- --clerk-org org_local_example --name "Example Sales"
```

Verified output: one org, 14 system roles, and the line `Zero fixture/demo data was created.` The command refuses `org_seed_mantu` and any id that starts with `demo_org_`. Re-running it updates the same org.

`pnpm db:seed` is the fixture seed (the Mantu demo companies). With `POLO_DATA_MODE=real` it exits 1 and prints `Refusing to run the FIXTURE seed`. That is the correct refusal. Use `pnpm db:seed` only for a demo, with `POLO_DATA_MODE` unset or `demo`.

`pnpm db:migrate` (`prisma migrate dev`) is **not** the install command. On this tree, in a non-interactive shell, it exited 1 with `Prisma Migrate has detected that the environment is non-interactive`. It also warned that the Prisma schema has unique constraints that are not yet migrations (`activities.idempotency_key`, `crew_agents (org_id, agent_key)`). Do not let it create a migration during install.

### Real mode and the demo

| | Real | Demo |
| --- | --- | --- |
| How you get it on this commit | `POLO_DATA_MODE=real` | Unset, or `POLO_DATA_MODE=demo` |
| Identity | Clerk, or Cloudflare Access plus `POLO_ALLOWED_USERS` | Dev stub (Jane Smith) or the public demo door |
| Database bootstrap | `pnpm db:migrate:deploy` then `pnpm db:seed:prod` | `pnpm db:seed` after migrate |
| Banner | No demo banner. `GET /api/v1/identity` returns `dataMode: real` | Demo banner on every chrome page |
| Fixture seed | Refused | Allowed |

`POLO_DATA_MODE=demo` is only for demos.

## 4. Run locally

Build the workspace packages the API and the worker import from `dist/`:

```bash
pnpm --filter @bidstack/shared --filter @bidstack/dust-client \
  --filter @bidstack/odoo-mcp-client --filter @bidstack/db \
  --filter @bidstack/memos --filter @bidstack/integrations build
```

The API and the worker load the repo-root `.env` through dotenv-flow. You do not have to `source` it for those two.

Vite does not. `import.meta.env` is filled from `apps/web` (there is no `envDir` in `apps/web/vite.config.ts`). A `VITE_AUTH_MODE=cf-access` line in the repo-root `.env` never reaches the browser, so `AuthProvider` falls through to the Jane Smith stub while the real-mode API returns 401. `pnpm dev:web` and `pnpm dev` make that worse: the web script is `cross-env VITE_AUTH_MODE=stub vite`, and a value already in the process overrides the env file.

Write the file Vite actually reads, then start Vite without `cross-env`:

```bash
cat > apps/web/.env.development.local << 'EOF'
VITE_AUTH_MODE=cf-access
EOF
pnpm dev:api
pnpm dev:worker
# `source .env` exports VITE_AUTH_MODE and VITE_API_URL from the repo-root
# file. Vite copies those process values into the browser and they beat the
# web env file. Strip them for this process only.
env -u VITE_AUTH_MODE -u VITE_API_URL \
  pnpm --filter @bidstack/web exec vite --host 127.0.0.1 --port 5173
```

`apps/web/.env.development.local` is gitignored (`.env.*.local`). Leave `VITE_API_URL` out of that file and out of the Vite process. An empty client base keeps the browser on the Vite origin, and `vite.config.ts` proxies `/api` to `http://localhost:4000`. Do not open the app with `pnpm dev` or `pnpm dev:web` in real mode.

The dev server's own default port is 38081 (`server.port` plus `strictPort` in `vite.config.ts`). `--port 5173` overrides it. Without that flag the URL is http://127.0.0.1:38081.

Check that the browser bundle is Cloudflare Access and not the stub. With Vite running:

```bash
curl -fsS 'http://127.0.0.1:5173/src/lib/auth.tsx' | grep -F '"VITE_AUTH_MODE": "cf-access"'
```

Vite replaces `import.meta.env` on the served module. That grep exits 0 only when the browser is on Cloudflare Access. A hit on `"VITE_AUTH_MODE": "stub"` means the Vite process still inherited the stub. On this check the served module began `import.meta.env = { ... "VITE_AUTH_MODE": "cf-access" }`.

Verified listeners:

| URL | Result |
| --- | --- |
| http://127.0.0.1:4000/health | 200 |
| http://127.0.0.1:4000/livez | 200 |
| http://127.0.0.1:4000/readyz | 200, `db: true`, `redis: true` |
| http://127.0.0.1:4000/api/v1/identity | `{"dataMode":"real","authProvider":"cf-access","demoBanner":false,"cfAccessEnabled":true}` |
| http://127.0.0.1:5173/ | 200 |
| http://127.0.0.1:4002/health | 200 when `WORKER_HEALTH_PORT` is unset |

`.env.example` sets `WORKER_HEALTH_PORT=8788`. Copying that file changes the worker health port. The code default when the variable is absent is 4002 (`apps/worker/src/main.ts`). The MCP server, when you start it with `pnpm dev:mcp`, listens on `PORT_MCP` (4001).

`pnpm dev` runs every package `dev` script, including `pnpm dev:web`, which forces the stub. Do not use it for real mode.

## 5. First run in real mode

The org must exist before the first request. `pnpm db:seed:prod` does that. It does not create a user. The first allowlisted request creates the user and grants the system role.

The SPA in `VITE_AUTH_MODE=cf-access` does not send `Cf-Access-Authenticated-User-Email`. On the laptop that header is how the loopback bypass works, so the browser stops on "Polo did not receive your Cloudflare Access identity." The records below were created with curl against the API. Opening the same screens in a browser needs Cloudflare Access in front (section 7) or Clerk.

```bash
H='Cf-Access-Authenticated-User-Email: owner@example.test'
curl -sS -H "$H" http://127.0.0.1:4000/api/v1/me
```

Verified: HTTP 200, email `owner@example.test`, role `admin`, RBAC role `Admin`, `dataMode` `real`. That call created the user.

`GET /api/v1/pipeline-stages` creates the default pipeline and the seven stages (S1 Lead through Closed Lost) if the org has none. It does not insert sample deals. Verified.

Create a synthetic account, contact, deal, and task. Money on the wire is currency units. The API stores micros.

```bash
curl -sS -H "$H" -H 'content-type: application/json' \
  -X POST http://127.0.0.1:4000/api/v1/companies \
  -d '{"name":"Northwind Paper","legalName":null,"domain":"northwind.example","industry":"manufacturing","employeeCount":40,"countryCode":"FR","address":null,"billingEmail":null,"taxId":null,"logoUrl":null,"website":"https://northwind.example","tier":"standard"}'

curl -sS -H "$H" -H 'content-type: application/json' \
  -X POST http://127.0.0.1:4000/api/v1/contacts \
  -d '{"customer":"Northwind Paper","name":"Ada North","role":"Buyer","email":"ada.north@northwind.example","phone":null,"influence":3,"sentiment":"warm","companyId":"<company-id>"}'

curl -sS -H "$H" -H 'content-type: application/json' \
  -X POST http://127.0.0.1:4000/api/v1/opportunities \
  -d '{"customer":"Northwind Paper","name":"Catalog reprint","value":12000,"probability":25,"dueDate":"2026-12-15","owner":"owner@example.test","industry":"manufacturing","logo":null,"country":"FR","territoryId":null,"stage":null,"pipelineStageId":null,"closedAt":null}'

curl -sS -H "$H" -H 'content-type: application/json' \
  -X POST http://127.0.0.1:4000/api/v1/tasks \
  -d '{"oppId":"<opportunity-id>","title":"Send the reprint brief","dueDate":"2026-12-01","status":"open","assignee":"owner@example.test"}'
```

Verified on the fresh database. Each create returned 201. The ids are UUIDs, not short codes. On that run the company id was `1701098c-37f7-4769-be1c-cfe03257b4bc`, the contact id was `5ff3f12a-0930-47ba-bd1f-e017d1ed11f9` with `linkState: linked`, the opportunity id was `1bbbe371-8ef0-49fb-b41c-cb03408f71c5` (stage `S1 Lead`, value `12000`), and the task id was `cd98d920-d317-4ecf-97b1-de81c03e48a2`.

Company create also requires the legacy role `admin` (`requireRole('admin')`). The allowlist role `Admin` maps to that.

## 6. Tests

CI is `.github/workflows/ci.yml` and `.github/workflows/e2e.yml`. The unit job does not set `DATABASE_URL`. Export a clean environment before the unit commands. A shell that still has `VITE_API_URL=http://localhost:4000` fails `apps/web` tests that expect a same-origin logo path (`techIconSlug.test.ts`, 7 failures). Unset it.

From `ci.yml`, job `unit` (Ubuntu 24.04, Node from `.nvmrc`, pnpm `10.27.0`):

```bash
pnpm install --frozen-lockfile
pnpm audit --audit-level high
pnpm db:generate
pnpm -r lint
pnpm typecheck
pnpm --filter '!@bidstack/api' --filter '!@bidstack/mcp-server' --filter '!@bidstack/worker' -r test
```

The worker, mcp-server, and api unit steps are the long `vitest run` lines in `ci.yml` (they exclude the database files). The job then runs `bash scripts/freeze-gates.sh` and `pnpm routes:inventory --check`.

Job `integration` (Postgres `pgvector/pgvector:pg16` on 5432, Redis 7 on 6379):

```bash
export NODE_ENV=test
export DATABASE_URL=postgres://bidstack:bidstack_test@localhost:5432/bidstack_test
export REDIS_URL=redis://localhost:6379
export APP_ROLE_TEST_PASSWORD=bidstack_app_role_test
pnpm install --frozen-lockfile
pnpm db:generate
pnpm --filter @bidstack/shared --filter @bidstack/dust-client \
  --filter @bidstack/odoo-mcp-client --filter @bidstack/db \
  --filter @bidstack/memos --filter @bidstack/integrations build
pnpm db:migrate:deploy
pnpm db:seed
pnpm --filter @bidstack/api test
pnpm --filter @bidstack/mcp-server test
pnpm --filter @bidstack/worker test
```

`pnpm db:seed` in that job is the fixture seed. It runs because CI does not set `POLO_DATA_MODE`, so the default on this commit is `demo`. Do not point those variables at a real database.

Job `e2e` builds the web with `VITE_AUTH_MODE=stub` and `BIDSTACK_ALLOW_STUB_AUTH=true`, starts the API on 4000, starts `vite preview` on 4174, and runs:

```bash
pnpm --filter @bidstack/web exec playwright install --with-deps chromium
pnpm --filter @bidstack/web e2e:smoke
```

`e2e:smoke` is `playwright test e2e/smoke.spec.ts --project=chromium-desktop`. The full suite is `.github/workflows/e2e.yml` (3 shards). It is extra. The required smoke job is the Chromium file above.

Root `pnpm test` is not the CI command. It runs a hermeticity check first and then every package, including the worker.

### What this clone ran

| Command | Result |
| --- | --- |
| `pnpm audit --audit-level high` | Exit 0. The report said 3 high findings, ignored by `pnpm.auditConfig` in `package.json`. |
| `pnpm -r lint` | Exit 0. The API package printed 17 existing warnings and 0 errors. |
| `pnpm typecheck` | Exit 0. |
| `pnpm --filter @bidstack/web exec vitest run src/env-example-source.test.ts src/vite-client-env.test.ts` | Exit 0 after the example file lost its BOM and quoted the mail address. The same command was red first: BOM plus `source` exit 2 on `NOTIFICATION_FROM_EMAIL`. |
| `pnpm --filter '!@bidstack/api' --filter '!@bidstack/mcp-server' --filter '!@bidstack/worker' -r test` | Exit 0 with a clean environment. Web: 348 files, 1757 tests. A first run with `VITE_API_URL` still exported failed 7 web tests; unsetting it is required. |
| Worker unit `vitest` line in `ci.yml` (DB files excluded) | Exit 0. 90 files, 927 tests. |
| MCP unit `vitest` line in `ci.yml` (`kam-tools.test.ts` excluded) | Exit 0. 16 files, 94 tests. |
| API unit `vitest` line in `ci.yml` (integration files excluded) | Exit 0. 122 files, 877 tests. |
| `pnpm routes:inventory --check` | Exit 0. 715 routes, ratchet ok. With `POLO_DATA_MODE` unset the boot log said `dataMode: demo`, which is the code default on this commit. |
| `pnpm db:backup:selftest` (`bash scripts/backup-restore-selftest.sh`) | Passed. One synthetic row, dumped and restored into a throwaway database, then dropped. |

## 7. Deploy to Cloudflare

This is the Worker plus Container in `apps/polo-preview/`, behind Cloudflare Access. CI must not deploy it. A production deploy needs Tony's approval. Review `wrangler.toml` before any upload.

The live names, from `wrangler.toml`:

- Worker `polo-preview`
- Account id in that file
- Durable Object `RELAY` / class `Relay` (migration `v1`, already on the Worker; do not recreate it)
- Durable Object `PREVIEW` / class `PreviewOrigin` (migration `v2`)
- Container image `./container/Dockerfile`, build context the repo root, `instance_type = standard-2`, `max_instances = 1`
- R2 binding `BACKUPS`, bucket `polo-backups`
- Cron `*/5 * * * *` keeps the container awake and saves changed data
- Access audience `ACCESS_AUD`, allowlist `ALLOWED_EMAILS`, admins `POLO_ADMIN_EMAILS`
- Public origin `https://polo-preview.tony-walteur.workers.dev`

The container image is `pgvector/pgvector:pg16` plus the Node binary from `node:24-bookworm-slim`, Redis, the built API, the built worker, and the SPA built with `VITE_API_URL` empty and `VITE_AUTH_MODE=cf-access`. On boot the disk is empty. The container answers `:8080` with a starting page, waits for the Worker to restore R2 object `polo-preview/latest.tgz` (daily copies are `polo-preview/daily/<date>.tgz`), then runs `prisma migrate deploy`. If neither restore nor a fresh seed arrives within 120 seconds, it seeds itself. Redis is not in the snapshot. Postgres listens on `127.0.0.1` inside the container. The API connects as `app_role`. Migrations use the owner login.

Steps, after Tony approves:

```bash
cd apps/polo-preview
# wrangler is not a repo dependency. Use a Wrangler that matches the
# Cloudflare account. Do not commit secret values.
npx wrangler secret put POLO_INTERNAL_KEY
npx wrangler secret put POLO_INTEGRATION_TOKEN_KEY
npx wrangler secret put POLO_PII_ENCRYPTION_MASTER_KEY
npx wrangler secret put POLO_JOB_SIGNING_SECRET
npx wrangler secret put POLO_APP_DB_PASSWORD
npx wrangler deploy
```

`npx wrangler secret put` and `npx wrangler deploy` are **not verified**. Running them would change the live Worker. This machine has no Cloudflare token.

Smoke check, after Access sign-in: `GET /__health`. The Worker returns relay or container health. A missing container and a missing box relay is a 502. **Not verified** against the live host.

Rollback: roll the Worker back to the previous deployment. The previous image does not contain a migration it never shipped, so its boot does not try to create that index. Do not change Worker secrets as part of the rollback. Leave `polo-preview/latest.tgz` in place. Details for the active-import index are in `docs/deploy/active-import-index.md`.

If a container boot fails, the site answers 503 and the cron destroys a failed container at most every 15 minutes. The next boot restores the same snapshot. A failed boot is not snapshotted. Read the container phase from the Worker logs. `could not set the app role password` means `app_role` was missing after restore (roles are not inside a database dump). That fix is in open PR 353 and is not on this commit.

## 8. Troubleshooting

These are failures from the fresh clone, plus the container and restore notes in the repo.

**`ERR_PNPM_UNSUPPORTED_ENGINE` / Node v22.** The repo requires Node 24. `.nvmrc` is the version CI installs.

**`Environment variable not found: DATABASE_URL` from Prisma.** The root `.env` is not visible to `prisma` when the working directory is `packages/db`. `set -a && source .env && set +a` before `pnpm db:migrate:deploy`.

**`prisma migrate dev` exits 1, "non-interactive".** Use `pnpm db:migrate:deploy`. Do not generate a migration to silence the unique-constraint warning during install.

**`pnpm db:seed:prod` cannot find `@bidstack/shared/dist/index.js`.** Run `pnpm --filter @bidstack/shared build` first.

**`Refusing to run the FIXTURE seed with POLO_DATA_MODE=real`.** Expected. Use `pnpm db:seed:prod` for a real org. Unset `POLO_DATA_MODE` only if you intend to load demo fixtures.

**`POLO_DATA_MODE=real requires CLERK_SECRET_KEY or CF_ACCESS_AUTH=true`.** The stub is off. Set one identity source, not both.

**`CF Access org "org_polo_real" is not registered`.** The default real org id is `org_polo_real` until you set `POLO_REAL_ORG_CLERK`. Run `pnpm db:seed:prod` with that same id.

**403 `This Cloudflare Access identity is not on the Polo allowlist`.** The email is missing from `POLO_ALLOWED_USERS`, or the role name is not a system role.

**Browser stays on the Access card in local real mode.** The SPA does not send the loopback email header. Use curl with that header, or put Cloudflare Access in front.

**Web unit tests expect `/api/v1/logo?...` and receive `http://localhost:4000/api/v1/logo?...`.** `VITE_API_URL` is exported in the shell. Unset it for unit tests.

**`readyz` is not 200.** Postgres or Redis is down, or `DATABASE_URL` / `REDIS_URL` points at the wrong port. Compose publishes 5433 and 6380, not 5432 and 6379.

**Container boot fails after a snapshot restore.** Postgres roles are cluster-wide. A dump of one database does not recreate `app_role`. On this commit the entrypoint sets the password with `ALTER ROLE` and throws `could not set the app role password` if the role is missing. Rollback is the previous Worker deployment. Do not edit the R2 object to "fix" a failed migration; a failed boot is not what gets saved.

**Restore drill.** This needs `psql` and `pg_dump` on `PATH` (section 1). `pnpm db:backup` writes `pg_dump -Fc` under `POLO_BACKUP_DIR` (default `./var/backups`) and deletes files older than `POLO_BACKUP_RETENTION_DAYS` (default 14). `pnpm db:restore -- <file>` refuses to run unless `POLO_RESTORE_DATABASE_URL` is set, so it cannot guess the production URL. `pnpm db:backup:selftest` creates two throwaway databases, dumps a one-row synthetic table, restores it, and compares the count. That selftest passed on this clone. Restoring the live R2 object was not done.

**`docker compose up -d` with no service names.** **Not verified.** That builds `migrate`, `api`, `web`, `worker`, and `mcp-server` and binds host ports 4000 and 80. The verified command is `docker compose up -d postgres redis`.

## 9. Integrations

No new providers. Each one is optional. Unset means the feature stays quiet or uses the public fallback already in the code.

| Names | What it does when set | When it is unset |
| --- | --- | --- |
| `APOLLO_API_KEY`, `APOLLO_MCP_URL`, `APOLLO_MCP_BEARER_TOKEN` | Company enrichment and people/job tools. Credit tools stay off unless `APOLLO_MCP_ENABLE_CREDIT_TOOLS=true`. | The worker does not call Apollo. Open enrichment can still run. |
| `SEAMLESS_API_KEY`, `SEAMLESS_MCP_URL` | Preferred firmographic source over the keyless path. | Keyless open enrichment (Wikidata / Wikipedia) runs unless `BIDSTACK_OPEN_ENRICHMENT_DISABLED=1`. |
| `SILLAGE_API_KEY`, `SILLAGE_MCP_URL` | Buying-intent signals, one config per deployment. | The route returns an empty intent and does not throw. |
| `TECH_STACK_MCP_URL` and `TECH_STACK_MCP_<ID>_*` | A configured tech-intel MCP (the example ids are BuiltWith and Wappalyzer). | The lane shows as not configured. No fake provider rows. |
| `DUST_API_KEY`, `DUST_WORKSPACE_ID`, agent ids | Dust agents for briefs, drafts, RFP steps. | Those AI steps fall back or the Dust routes answer 503 `Dust integration not configured`. |
| `RFP_LLM_PROVIDER` plus `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `MOONSHOT_API_KEY`, `NVIDIA_NIM_API_KEY`, or `GEMMA_API_KEY` | Proposal drafting and review. | Provider stays unset. Drafting uses the in-repo fallback rather than a third-party model. |
| `DOCUMENT_LLM_EXTRACT_ENABLED`, `MSA_LLM_EXTRACT_ENABLED` | Sends account files or MSA text to a model. | Both default `false`. Real mode blocks account-file LLM extract until the document flag is `true`. MSA extract stays local. |
| `GMAIL_CLIENT_ID` / `GMAIL_CLIENT_SECRET` (or `GOOGLE_OAUTH_*`) | Read-only Gmail and Google Calendar. | Connect answers that Google is not configured. |
| `MICROSOFT_GRAPH_CLIENT_ID` / `MICROSOFT_GRAPH_CLIENT_SECRET` | Read-only Outlook mail and calendar. | Connect answers that Microsoft 365 is not configured. |
| `SHAREPOINT_*` | Agreement pull from SharePoint. | `not_configured` on that source. |
| `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_SIGNING_SECRET` | Slack OAuth and signed events. | Slack connect is off. The signing secret is required before Slack webhooks will accept a call. |
| `HUBSPOT_CLIENT_ID`, `HUBSPOT_CLIENT_SECRET` | HubSpot import. | The migration route answers 503 `HubSpot OAuth not configured`. |
| `SALESFORCE_CLIENT_ID`, `SALESFORCE_CLIENT_SECRET` | Salesforce OAuth import. | The connector stays unwired. |
| `DOCUSIGN_*` | Envelope send and agreement pull. | Call time answers `DocuSign credentials not configured`. Internal signing still works. |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | SMS and voice. | Those sends do not go out. Daily caps still exist in config and do nothing without a send. |
| `ZOOM_ACCOUNT_ID`, `ZOOM_CLIENT_ID`, `ZOOM_CLIENT_SECRET` | Zoom meeting records. | Zoom webhooks and meeting create stay off. |
| `DEEPGRAM_API_KEY` | Call transcription. | Transcription does not start. |
| `COMPANIES_HOUSE_API_KEY` | UK filing watchdog. | Companies House is not polled. |
| `ACCOUNT_INTEL_USER_AGENT` or `SEC_USER_AGENT` | Contact string for SEC EDGAR, ESEF, and public pages. The daily filings scan runs when this is set, unless `FINANCIALS_SCAN_ENABLED=false`. | Public fetches are skipped. The scan does not register. |
| `ECB_RATES_URL` | Daily FX XML. Default is the ECB euro reference feed. | The default public URL is used. Manual rates can still be posted. |
| `OPENCORPORATES_API_TOKEN`, `THEIRSTACK_API_KEY`, `ADZUNA_APP_ID` / `ADZUNA_APP_KEY` | Optional registries and job boards for account intel. | Those sources are not queried. |
| `INFOSEARCH_ENABLED` plus URL and key | Lead lists on the account page. | The block stays hidden. Boot fails if the flag is true and the URL or key is blank. |
| `LMS_360L_ENABLED` plus URL and key | 360Learning sales toolkits, fetched live, not stored. | The page shows the labelled sample toolkits. |
| `ERP_ENABLED` plus `ERP_MCP_URL` | One global ERP connection for a single-tenant deploy. | Default off. The settings card shows not configured. |
| `ODOO_*` | Odoo MCP sidecar. Credentials stay in the sidecar. | The API does not call Odoo. |
| `OMNIPARSE_BASE_URL` | Optional local parser for RFP files. | Extraction continues without that sidecar. |
| `RESEND_API_KEY` | Email notifications. | Email notifications stay off. |
| `VAPID_*` | Web Push. | Push stays off. |
| `SENTRY_DSN`, `VITE_SENTRY_DSN` | Error reporting. | Reporting is a no-op. |
| `MARS_*` | Meeting sync from MARS. | The integration stays disabled. |
| `BRANDFETCH_LOGO_TOKEN`, `LOGO_DEV_TOKEN` | Logo lookup. | Logos fall through to the remaining sources. |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `OMNIROUTE_*` | Optional model gateway used by the assistant helper. | That gateway is not called. |

`ENRICHMENT_MONTHLY_CREDIT_BUDGET` (default 200) caps Apollo and Seamless credits per org per month. `ENRICHMENT_AUTO_REFRESH` defaults to `false`, so refreshes are manual.

## Known limits

- On `main` at `40b13242` the code default of `POLO_DATA_MODE` is `demo`. Copying `.env.example` stays in demo until the real-mode edit in section 2. [Pull request #364](https://github.com/mysticalsin/bidstack-360/pull/364) is the foundation change that makes real the default. After it lands, an unset variable refuses the stub. `POLO_DATA_MODE=demo` stays the demo-only value.
- The container entrypoint on this commit forces `POLO_DATA_MODE=demo` after it reads the environment. A laptop real-mode process does not. The container and the laptop do not behave the same until that line changes.
- `prisma migrate dev` sees schema drift (two unique constraints) and will not run non-interactively. Install with `pnpm db:migrate:deploy`.
- The SPA cannot complete Cloudflare Access sign-in on localhost, because it does not send the loopback email header.
- Won and lost counts elsewhere in the product are outside this page. This page only checks that one synthetic deal can be created.
- Open PRs 353–361 are not merged. Container restore after a snapshot (PR 353) is not in this commit. Do not treat this page as the runbook for that boot fix.

## Not verified

| Step | Why it was not run |
| --- | --- |
| `npx wrangler secret put` and `npx wrangler deploy` | Would change the live `polo-preview` Worker. No Cloudflare token on this machine. Wrangler is not pinned in the repo. Production deploys need Tony's approval. |
| `GET /__health` on `https://polo-preview.tony-walteur.workers.dev` | Live Access-gated host. Not called. |
| `docker build` of `apps/polo-preview/container/Dockerfile` and a container boot | Needs the five Worker secrets and would compile the production image. Not started. |
| `docker compose up -d` with no service names | Builds app images and binds ports 4000 and 80. Only `postgres` and `redis` were started. |
| `pnpm dev` and `pnpm dev:web` for a real-mode browser | Those scripts force `VITE_AUTH_MODE=stub`. The working command is `apps/web/.env.development.local` plus `pnpm --filter @bidstack/web exec vite`. |
| CI integration (`pnpm db:seed` on the test database, then api, mcp-server, and worker tests) and both e2e workflows | Not run. Playwright browsers were not installed. The local Postgres is on 5433, not CI's 5432. The unit exclude-lists for api, worker, and mcp-server did run, and passed. |
| `bash scripts/freeze-gates.sh` | Not run. It builds the web bundle and is the CI step after the unit tests. |
| Restoring R2 object `polo-preview/latest.tgz` | The local backup selftest was the drill that ran. The live object was not read. |
| Clerk sign-in | No Clerk secret was used. The verified identity path is the loopback Access header. |

## Verification note

Fresh clone of `main` `40b13242ebf18d715b67bb6133a9774bbd7d0c78`.

Commands that exited 0: `pnpm install --frozen-lockfile`, `docker compose up -d postgres redis`, `pnpm db:generate`, `pnpm db:migrate:deploy` (146 migrations), `pnpm --filter @bidstack/shared build`, `pnpm db:seed:prod`, the workspace `build` listed in section 4, `pnpm dev:api`, `pnpm dev:worker`, Vite on 5173, the four curl creates, `pnpm audit --audit-level high`, `pnpm -r lint`, `pnpm typecheck`, `pnpm routes:inventory --check`, the three CI unit `vitest` commands for the worker (927), mcp-server (94), and api (877), and `bash scripts/backup-restore-selftest.sh`.

`pnpm db:seed` with `POLO_DATA_MODE=real` exited 1 with the fixture refusal. `pnpm db:migrate` exited 1 as non-interactive. `pnpm db:seed:prod` before the shared build exited 1 with `ERR_MODULE_NOT_FOUND`.

The no-database package test command failed once while `VITE_API_URL` was still exported (web: 7 failed, 1750 passed). The same command with that variable unset exited 0 (web: 348 files, 1757 tests).
