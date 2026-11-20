# Always-on public demo on Vercel

Project `polo-presales`, domain `bidstack-demo.vercel.app`. The SPA and the API
run on one origin: static files from `apps/web`, and `apps/api` as a single
Vercel Function (`apps/api/src/serverless.ts`). Postgres is Neon and Redis is
Upstash, both from the Vercel Marketplace (free plans). No BullMQ worker,
repeatable job or polling loop runs in this mode.

## Deploy

Upload this folder plus a `polo-sha.txt` holding the full commit SHA to ship
(the repo is public). `build.sh` clones that commit, installs, and runs
`scripts/vercel-serverless-build.mjs`, which writes `.vercel/output`
(Build Output API v3) and, with `POLO_SERVERLESS_MIGRATE=1`, applies Prisma
migrations to Neon over the unpooled URL.

## Sign-in

`DEMO_MODE=true`: the sign-in page asks for an email and provisions a seeded
synthetic org for it (`POST /api/demo/session`). Old demo orgs are reaped and
`DEMO_MAX_ORGS` caps the total.

## Environment (names only)

Set on the project for production and preview: `DEMO_MODE`,
`DEMO_PUBLIC_DEPLOYMENT_ACK`, `DEMO_SESSION_SECRET`, `POLO_DATA_MODE`,
`PUBLIC_BASE_URL`, `CORS_EXTRA_ORIGINS`, `PII_FIELD_ENCRYPTION`,
`PII_ENCRYPTION_MASTER_KEY`, `INTEGRATION_TOKEN_KEY`,
`BIDSTACK_JOB_SIGNING_SECRET`, `BIDSTACK_TENANT_SCOPE_GUARD` (`warn`; demo
provisioning reads users before an org exists), `TRUSTED_PROXIES`,
`STORAGE_DRIVER`, `LOCAL_STORAGE_ROOT`, `API_RATE_LIMIT_MAX`, `DEMO_MAX_ORGS`,
`DEMO_PROVISION_TIMEOUT_MS`, `POLO_SERVERLESS`, `POLO_SERVERLESS_MIGRATE`,
`LOG_LEVEL`. `DATABASE_URL*` and `REDIS_URL` come from the integrations. Never
set `CLERK_SECRET_KEY` or any Apollo key here.
