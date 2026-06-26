# Worker Production Env Fail-Fast Contract

## Problem

The API validates its production environment before boot, including
`INTEGRATION_TOKEN_KEY` and durable storage settings. The worker only checked
`DATABASE_URL` and `REDIS_URL`, even though worker queues decrypt OAuth tokens,
Dust credentials, org LLM credentials, SMS credentials, and read/write uploaded
files.

That meant a production worker could report healthy and only fail later when a
calendar, email, SMS, RFP, Dust, or enrichment job first touched the malformed
secret or local storage path.

## Pattern

- Keep a pure validation function that can be unit-tested without starting
  BullMQ, Redis, Prisma, Sentry, or queue processors.
- Production workers must require:
  - `DATABASE_URL`
  - `REDIS_URL`
  - `INTEGRATION_TOKEN_KEY` as a 64-character hex string
  - `STORAGE_DRIVER=s3` unless this is an explicitly acknowledged demo
  - `S3_BUCKET` and `S3_REGION` when S3 is active
- Call the assertion before opening Redis or starting any queue.
- Keep demo-only local storage explicit through `DEMO_MODE=true`; do not make
  local storage the silent production default.

## Implementation

- `apps/worker/src/lib/production-env.ts`
- `apps/worker/src/lib/production-env.test.ts`
- `apps/worker/src/main.ts`

## Verification

- Red test first: `production-env.test.ts` failed because
  `./production-env.js` did not exist.
- `pnpm --filter @bidstack/worker exec vitest run src/lib/production-env.test.ts --reporter=dot`:
  7/7 pass.
- `pnpm --filter @bidstack/worker exec eslint src/lib/production-env.ts src/lib/production-env.test.ts src/main.ts --max-warnings=0`:
  pass.
- `pnpm --filter @bidstack/worker typecheck`: pass.
- `pnpm --filter @bidstack/worker build`: pass.
- `pnpm deploy:evidence:compose:policy`: pass.
- `pnpm deploy:evidence:selftest`: pass.
- `pnpm deploy:evidence:source:selftest`: pass.
- `pnpm deploy:evidence:source`: expected release block; worktree has 401
  dirty entries.
- `pnpm deploy:evidence:source:plan:write`: refreshed six active review waves.

## Remaining Risk

This proves local worker boot validation. It does not prove live platform secret
store values, staging queue execution, live provider credentials, or production
object-storage permissions. Keep compose/Azure policy, staging worker smoke, and
platform/security approval as separate release gates.
