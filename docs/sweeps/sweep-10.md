# Sweep 10 — install, fresh setup, and operations

Lens: follow the written install path on a clean VM, with no extra knowledge, and record every step that fails, is ambiguous, or is missing.

Base: `main` `40b13242ebf18d715b67bb6133a9774bbd7d0c78`.
Guides followed, in that order: `README.md` Quick start, `docs/RUNBOOK.md` local start and backup section, `docs/GO-LIVE-SELFHOST.md` day-2 upgrade sentence, `docs/PRODUCTION_DATA_BOOTSTRAP.md` first admin, and [PR #363](https://github.com/mysticalsin/bidstack-360/pull/363) `docs/INSTALL-AND-RUN.md` (read from `cursor/install-and-run-542e`, not checked out onto this branch).

Machine: Ubuntu 24.04, no `node_modules`, Node on `PATH` was v22.23.4 at `/exec-daemon/node`, pnpm 10.27.0, no Docker, no `psql`, `policy-rc.d` exits 101, no systemd. No version tags exist (`git tag` is only `archive/*`). GitHub releases: none.

## Counts

| | |
| --- | --- |
| Steps run | 22 |
| Failed or blocked as written | 8 |
| Ambiguous or missing from the guides | 7 |
| Already covered by an open PR or an existing #363 comment | 7 |
| Code fix opened | 1 draft, [#414](https://github.com/mysticalsin/bidstack-360/pull/414) |
| Doc notes posted | comments on #363, no push to that branch |

## Duplicates

| What happened | Already open |
| --- | --- |
| `nvm use 24` leaves `node` at `/exec-daemon/node` v22.23.4. `pnpm install --frozen-lockfile` exits 1, `ERR_PNPM_UNSUPPORTED_ENGINE`. | Comment on #363, 21 Nov 2026. Reproduced. Not commented again. |
| Package install of Docker Engine does not start dockerd. `invoke-rc.d: policy-rc.d denied execution of start`. | Same #363 comment (systemd / policy-rc.d). Reproduced on the official packages, not only `docker.io`. |
| `source .env.example` exits 2. Byte 0 is a UTF-8 BOM, and line 283 is `NOTIFICATION_FROM_EMAIL=BidStack <notifications@bidstack.app>`. | The file change in #363. |
| README `pnpm db:migrate` is the wrong install command. | #363 section 3 and troubleshooting. Extra detail below: it writes, then exits 1. |
| `pnpm db:seed:prod` needs `@bidstack/shared` built. `pnpm db:seed` with `POLO_DATA_MODE=real` refuses. | #363. Both reproduced. |
| `GET /healthz` is not a public probe. | [#376](https://github.com/mysticalsin/bidstack-360/pull/376). Status codes on this boot differ from that PR's 404. See health. |
| Snapshot restore of the Polo container, `app_role` after `pg_restore`. | [#353](https://github.com/mysticalsin/bidstack-360/pull/353), state machine in [#365](https://github.com/mysticalsin/bidstack-360/pull/365). Not re-run. `apps/polo-preview` and R2 were not touched. |
| Company create while Redis is down. | #376. Not re-run. With Redis up, the guide's company create returned 201 in 35ms. |
| `POLO_DATA_MODE` defaults to `demo`. | [#364](https://github.com/mysticalsin/bidstack-360/pull/364), and #363 section 2. |

## Transcript

### 1. Node and pnpm

`.nvmrc` is `24`. `package.json` `engines.node` is `>=24.0.0 <25`, `packageManager` is `pnpm@10.27.0`, `.npmrc` has `engine-strict=true`.

Followed #363 section 1. nvm 0.40.3 was already installed. `nvm install 24` and `nvm use 24` both printed `Now using node v24.22.3`. The next `node -v` was `v22.23.4` and `command -v node` was `/exec-daemon/node`. `PATH` still started at `/usr/local/cargo/bin`.

README step 1 on that Node:

```
ERR_PNPM_UNSUPPORTED_ENGINE
Expected version: >=24.0.0 <25
Got: v22.23.4
```

Exit 1.

Continuing required putting `$HOME/.nvm/versions/node/v24.22.3/bin` in front of `PATH`. The guide does not say that. After that, `corepack prepare pnpm@10.27.0 --activate` and `pnpm -v` printed `10.27.0`. pnpm also printed `Update available! 10.27.0 → 12.21.0` and `corepack use pnpm@12.21.0`. Engines reject pnpm 12. The banner is a trap. Not in the guide.

`pnpm install --frozen-lockfile` on Node 24 exited 0 (1318 packages, 4.6s). It warned that build scripts for `@clerk/shared`, `chromedriver`, `protobufjs`, and `puppeteer` were ignored.

### 2. Docker and psql

#363 section 1: official Docker Engine packages, then `docker --version` and `docker compose version`. Ubuntu 24.04 steps from the Docker Engine install page. Result:

- `Docker version 29.10.0, build fdd4b8e`
- `Docker Compose version v5.8.0`

The guide records Docker `29.1.3` and Compose `2.40.3`. Those are not what the current official packages install. Both commands still print a version, so the check passes. The pin is stale.

`policy-rc.d` denied the service start during install. `sudo service docker start` printed `done` and dockerd was running. `docker compose` as the login user then failed:

```
permission denied while trying to connect to the docker API at unix:///var/run/docker.sock
```

Exit 1. The user is not in group `docker`. Section 1 does not mention the post-install group step. `sudo docker compose up -d postgres redis` exited 0. Postgres `(PostgreSQL) 16.16`, Redis `7.4.12`, host ports 5433 and 6380, both healthy.

`sudo apt-get install -y postgresql-client` then `psql --version` printed `psql (PostgreSQL) 16.15`. `pg_dump` matched. That part of section 1 worked.

README `docker compose up -d` with no service names was not run. #363 marks it not verified because it builds the app images and binds ports 4000 and 80. The image that was built is the root `Dockerfile` `--target api`, below.

### 3. Env file

`cp .env.example .env` exited 0. `source` of that file on `main` prints:

```
.env: line 1: #: command not found
.env: line 283: syntax error near unexpected token `newline'
NOTIFICATION_FROM_EMAIL=BidStack <notifications@bidstack.app>
```

A `bash -c` whose last command is `source` exits 2. A script that sources and then runs another command still exits 0, so a missing `set -e` hides the failure. Covered by #363's example-file fix.

On this `main` the example URL is still `postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@localhost:5433/${POSTGRES_DB}` with `POSTGRES_PASSWORD` empty. dotenv does not expand that. The concrete URL in #363 is part of the same unmerged file. To go further, `DATABASE_URL` and `REDIS_URL` in the gitignored `.env` were set to the values #363 says compose hardcodes: `postgres://bidstack:bidstack@localhost:5433/bidstack` and `redis://localhost:6380`.

### 4. Migrations

`pnpm db:migrate` with no `DATABASE_URL` in the environment exited 1: Prisma P1012, `Environment variable not found: DATABASE_URL`. Prisma does not read the repo-root `.env`. #363 says this.

`pnpm db:migrate` with `DATABASE_URL` exported exited 1 after it had already applied all 146 migrations. The tail was the two unique-constraint warnings and `Prisma Migrate has detected that the environment is non-interactive`. `pnpm db:migrate:deploy` then printed `No pending migrations to apply` and exited 0. The README command is not a clean failure. It mutates the database, then returns 1.

The warnings are not "missing indexes". After deploy, `activities` already has unique index `activities_org_idempotency_key` on `(org_id, idempotency_key)`. `crew_agents` already has partial unique index `crew_agents_org_key_key` on `(org_id, agent_key) WHERE deleted_at IS NULL`. Prisma's schema asks for a single-column unique on `activities.idempotency_key` and a full unique on `crew_agents (org_id, agent_key)`. Accepting the interactive prompt would add a second constraint. #363 already says not to create a migration during install. The shape difference is why.

`pnpm db:generate` exited 0 (Prisma Client 5.22.0).

### 5. Seed and the first admin

`POLO_DATA_MODE=real pnpm db:seed` exited 1: `Refusing to run the FIXTURE seed with POLO_DATA_MODE=real`.

`pnpm db:seed:prod -- --clerk-org org_local_example --name "Example Sales"` exited 0. Org id `0fff3fe7-1f4d-470e-9147-431f68252ea0`, 14 system roles, `Zero fixture/demo data was created.` The printed next step only says to sign in with a Clerk org admin. It does not mention the allowlist header #363 section 5 uses.

After the real-mode env edit and an API restart, the section 5 curl created the user:

`GET /api/v1/me` with `Cf-Access-Authenticated-User-Email: owner@example.test` returned 200. Email `owner@example.test`, role `admin`, roles `["Admin"]`, `dataMode` `real`.

`POST /api/v1/companies` with the guide's Northwind body returned 201 in 35ms. Company id `c1e3defd-d590-4b30-b29f-e4aa437fdae4`.

### 6. Demo mode off, API, and worker

Copied example, with only the database URL repaired, booted demo:

`GET /api/v1/identity` → `{"dataMode":"demo","authProvider":"stub","demoBanner":true,"cfAccessEnabled":false}`. Log: `AUTH STUB MODE`.

Then the #363 real-mode edit (`POLO_DATA_MODE=real`, `CF_ACCESS_AUTH=true`, `CF_ACCESS_TRUST_LOOPBACK_EMAIL=true`, `POLO_ALLOWED_USERS=owner@example.test:Admin`, `POLO_REAL_ORG_CLERK=org_local_example`, `DEMO_MODE=false`) and a restart:

Log: `Cloudflare Access identity mapping enabled` `dataMode: real`.
Identity: `{"dataMode":"real","authProvider":"cf-access","demoBanner":false,"cfAccessEnabled":true}`.

There is no settings switch. Restart is required. The guide is right. Worker restart after the same edit stayed up: `health server listening` `healthPort: 8788`.

`pnpm dev:api` and `pnpm dev:worker` are the commands that worked. `pnpm dev` was not used. #363 says it forces the stub.

### 7. Health

| URL | Demo, fixture seed not run | Real mode |
| --- | --- | --- |
| `GET /livez` | 200 `{"ok":true}` | 200 |
| `GET /readyz` | 200 `db: true`, `redis: true`, `storage: true` | 200, same |
| `GET /health` | 200 `ok: true`, `db: true`, `redis: true` | 200 |
| `GET /healthz` | 500 `Something went wrong` | 401 `Cloudflare Access identity required` |

`/healthz` is not registered. The auth `onRequest` hook runs for an unknown path. In demo stub mode the seed org `org_seed_mantu` was absent (fixture seed had been refused), so auth threw `ServiceUnavailableError` `Stub auth: seed org missing — run pnpm db:seed` with `expose: false`. The client saw 500. In real mode the same unknown path required a Cloudflare Access identity and returned 401. #376 recorded 404 on a boot where the stub seed org existed, and adds a public `/healthz`. Same hole, different status. Not a second fix.

Worker, because `.env.example` sets `WORKER_HEALTH_PORT=8788`:

- `http://127.0.0.1:8788/health`, `/healthz`, and `/readyz` all 200 `{"status":"ok","queue":"connected","db":"connected"}`. The worker treats every path other than `/metrics` and `/livez` as the deep check.
- `http://127.0.0.1:4002/health` connection refused.

#363 section 4 already says copying the example moves the worker off 4002. README only documents `http://localhost:4000/health`. `docs/GO-LIVE-SELFHOST.md` lists `/health`, `/livez`, `/readyz` and not `/healthz`. `docs/RUNBOOK.md` expects `/health` to be `{"ok":true,"db":true,"redis":true}` and does not say that `/health` stays HTTP 200 when `ok` is false.

### 8. Backup and restore

`pnpm db:backup` exited 0 and wrote `./var/backups/polo-20261121T034118Z.dump` (about 1 MB). That directory was not gitignored. `git status` showed `?? var/`. A dump of the database was sitting in the worktree.

`pnpm db:backup:selftest` exited 0: `backup-restore selftest passed (1 row)`.

The command #363 tells you to run does not restore:

```
pnpm db:restore -- var/backups/polo-20261121T034118Z.dump
bash scripts/restore-postgres.sh -- var/backups/polo-....dump
Usage: scripts/restore-postgres.sh <polo-*.dump>
```

Exit 1, with `POLO_RESTORE_DATABASE_URL` unset and again with it set to a throwaway database. pnpm forwards `--`, and the script uses `$1` as the path. The same file without the extra `--`, and with `POLO_RESTORE_DATABASE_URL` set, printed `Restored ...` and exited 0. The selftest calls the script directly, so it never saw this.

Fixed in draft #414 (red `63062c77`, green `e5d5b0c3`). After that fix, `pnpm db:restore -- <file>` with the target URL unset prints `POLO_RESTORE_DATABASE_URL is required` and exits 1, and the selftest passes while calling the script with `--`.

`docs/RUNBOOK.md` restore is `aws s3 cp` plus `kubectl scale` plus `pg_restore -Fc -d $DATABASE_URL`. None of that is installed here, and it is not the script the repo actually ships.

### 9. Upgrade from the previous release

There is no previous release to upgrade from. No GitHub releases. No version tags. `CHANGELOG.md` has `[0.5.0] — 2026-05-24` and `[Unreleased]`, and nothing tags `0.5.0`.

#363 has no upgrade section. `docs/GO-LIVE-SELFHOST.md` day-2 says `git pull` then `node scripts/go-live-selfhost.mjs`. That script deploys. It was not run. `docs/RUNBOOK.md` rollback is `kubectl rollout undo`. A fresh database was migrated from empty (146 migrations). That is an install, not an upgrade from a prior release artifact.

### 10. Logs

No guide names a log file. API logger is pino to stdout (`pino-pretty` when `NODE_ENV=development`). Worker is pino to stdout. Nothing under the repo was written as a `*.log` by the running processes. The only place the lines appeared was the process output (the tmux pane). `.gitignore` has a `logs/` entry, and nothing created that directory.

### 11. `pnpm build`

Exited 0. Web, API, worker, mcp-server, marketing, and the workspace packages all finished. Log ends `apps/api build: Done` then `EXIT:0`.

### 12. Container image

`sudo docker build -t bidstack-api:sweep10 -f Dockerfile --target api .` exited 0. Image `sha256:7dc00447d54b90daec4f8b0dde6f327fdf0031f62e82e949d868ad9ba67d5c76`. This is the image `docs/RUNBOOK.md` tells you to build. The Polo container Dockerfile was not built and not started. #363 marks that build not verified, and this sweep did not touch `apps/polo-preview` or R2.

`NODE_ENV=production` is baked into the API image. Started with only the production names #363 section 2 lists, plus `DATABASE_URL` (the same section says the API refuses to start without it):

`DATABASE_URL`, `DATABASE_URL_APP`, `REDIS_URL` (not loopback), `PUBLIC_BASE_URL=https://app.example.test`, `STORAGE_DRIVER=s3`, `S3_BUCKET`, `INTEGRATION_TOKEN_KEY`, `PII_ENCRYPTION_MASTER_KEY`, `PII_FIELD_ENCRYPTION=true`, `BIDSTACK_JOB_SIGNING_SECRET`, `BIDSTACK_TENANT_SCOPE_GUARD=enforce`.

The process exited 1 before listen:

```
CLERK_SECRET_KEY required in production
    at assertPoloAuthBoot (polo-mode.js)
```

`POLO_DATA_MODE` was unset, so the code default is `demo`. That is data mode, not `DEMO_MODE`. Production still refuses the stub unless Clerk, Cloudflare Access, or `DEMO_MODE=true` is set. Section 2's production list does not say that.

Second start, adding the real-mode names the guide does list (`POLO_DATA_MODE=real`, `CF_ACCESS_AUTH=true`, `POLO_ALLOWED_USERS`, `POLO_REAL_ORG_CLERK`), and not `CF_ACCESS_TRUST_LOOPBACK_EMAIL` (the guide says production refuses it). Exit 1:

```
CF_ACCESS_TEAM_DOMAIN is required when CF_ACCESS_AUTH=true in production
CF_ACCESS_AUD is required when CF_ACCESS_AUTH=true in production
```

Those two names are not in the production list. The secret table calls the Worker var `ACCESS_AUD`, not `CF_ACCESS_AUD`.

A third start added only those two, with Redis at `redis://172.30.0.2:6380` (this VM's address, which answers `PONG`, and which is not `localhost`, so the production loopback check allows it). The container network path to Redis timed out even for `redis-cli` (this VM, not asserted as a product bug). On the host address the process stayed up:

- log `Server listening` and `Polo PreSales API ready`, `dataMode: real`
- `GET /livez` 200
- `GET /readyz` 503 `{"ok":false,"db":false,"redis":true,"storage":true}`
- `GET /health` 200 `{"ok":false,"db":false,"redis":true}`
- `GET /healthz` 401 `Cloudflare Access identity required`

`db: false` is the `app_role` URL. Migrations create `app_role` with `LOGIN` and do not set a password. The root image has no step that sets one. #363's `POLO_APP_DB_PASSWORD` is the Polo container secret, not an env var of this image. `/readyz` cannot go 200 on a password the guide never gives this image.

The image was removed after the probes. Nothing was pushed to a registry.

## What was not run

- `npx wrangler deploy`, Worker secrets, `GET /__health` on the live host, R2, `polo-preview` image build or boot.
- `docker compose up -d` with no service names.
- `node scripts/go-live-selfhost.mjs` (it deploys).
- CI unit suite, Playwright, `scripts/freeze-gates.sh`.
- Clerk sign-in. The identity that worked was the loopback Access header.
