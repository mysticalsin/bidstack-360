# Run Polo in real mode

Real mode is the default. You enter the accounts, contacts, deals, and tasks yourself. Sample numbers stay hidden until an owner or a system Admin turns on Settings → Demo data.

## What you need

- Node.js 24
- pnpm 10
- PostgreSQL 16 (the compose file uses `pgvector/pgvector:pg16`)
- Redis 7

No Clerk key and no enrichment key are required for a local workspace. Production still requires Clerk or Cloudflare Access.

## Install

From the repository root:

```bash
pnpm install
cp .env.example .env
```

Leave `POLO_DATA_MODE` unset. Do not set `DEMO_MODE=true`.

Start Postgres and Redis:

```bash
docker compose up -d postgres redis
```

The compose file publishes Postgres on port 5433 and Redis on port 6380. Point `.env` at them:

```bash
DATABASE_URL=postgresql://bidstack:bidstack@localhost:5433/bidstack
REDIS_URL=redis://localhost:6380
```

Apply migrations, then generate the client:

```bash
pnpm db:migrate
pnpm db:generate
```

`pnpm db:migrate` is `prisma migrate dev`. It applies `prisma/migrations`, including `20261120120000_org_settings_demo_data`.

Do not run `pnpm db:seed` for a real workspace. That command loads the fixture companies and now refuses unless `POLO_DATA_MODE=demo`.

## Run

```bash
pnpm dev
```

The web app is on port 5173 and the API on port 4000.

### Local sign-in

With no `CLERK_SECRET_KEY`, development uses the existing stub. The first request creates:

- an org named Workspace (`org_seed_mantu`, the stub's org id)
- the system roles
- one admin user, Jane Smith (`jane.smith@mantu.com`)

It does not create companies, contacts, deals, or tasks. Open the app, and the dashboard shows Getting started.

Then, in order:

1. Companies → Add company
2. Contacts → add a person on that company
3. Opportunities → log the bid
4. Tasks → add the next action
5. Pipeline shows the bid once it exists
6. The account page financials and enrichment say Not connected until a filing or a provider is actually linked

### Production bootstrap

```bash
pnpm db:migrate:deploy
pnpm db:seed:prod -- --clerk-org <clerk org id> --name "<Organization name>"
```

Set `POLO_DATA_MODE` unset or `real`, and set `CLERK_SECRET_KEY` or `CF_ACCESS_AUTH=true` plus `POLO_ALLOWED_USERS`. `db:seed:prod` writes the org and the system roles only.

## Demo data, if you still want it

Two switches, both required:

1. Process: `POLO_DATA_MODE=demo`, then `pnpm db:seed`
2. Org: sign in as an owner or a system Admin, open Settings → Demo data, turn on Show sample numbers

Either switch alone is not enough. The seed will not run without the process switch. The numbers will not show without the org switch.

## Not connected

Enrichment, public financials, foreign exchange, and the release score need a provider or a recorded row. With nothing linked they say Not connected. They do not invent a revenue, a headcount, or a score.
