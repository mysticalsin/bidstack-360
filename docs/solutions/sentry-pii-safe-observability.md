# Sentry PII-Safe Observability

## Problem

The API had two Sentry paths:

- `apps/api/src/instrument.ts`, which is the production entrypoint path, did not
  apply the documented PII scrubber.
- `apps/api/src/plugins/auth.ts` set Sentry user context with email after auth.
- The web entrypoint later drifted back to direct `Sentry.init(...)` in
  `apps/web/src/main.tsx`, bypassing the canonical browser scrubber and replay
  controls in `apps/web/src/lib/sentry.ts`.

That violates the observability contract for a company-scale deployment:
operators need 5xx alerting and request correlation, but telemetry must not
export emails, names, phone numbers, tokens, or raw sensitive payloads.

## Pattern

- Put the API Sentry scrubber in one shared helper:
  `apps/api/src/lib/sentry-privacy.ts`.
- Wire the actual production init path (`apps/api/src/instrument.ts`) through
  `beforeSend` and `sendDefaultPii: false`.
- Keep user context pseudonymous: `Sentry.setUser({ id: userId })` only.
  Use org id as a tag. Do not send email/name/phone to Sentry scope.
- Wrap the API Sentry Fastify plugin with `fastify-plugin`. Request telemetry
  hooks are cross-cutting middleware; default Fastify encapsulation can make
  them miss sibling routes registered after the plugin.
- Treat tenant tags like user context: set `orgId` to a non-PII
  `unauthenticated` sentinel when auth is absent and after each response so
  stale tenant tags cannot be reused by anonymous/later events.
- Keep auth focused on authentication. Request-scope telemetry belongs in the
  Sentry plugin after `authPlugin`, when `req.auth` exists.
- Capture handled 5xx errors in the central error handler, where the app
  normalizes server errors. Fastify hook behavior around handled errors is too
  easy to misread; the error handler is the authoritative sink.
- Keep worker job payload scrubbing at least as broad as API request scrubbing,
  including phone-number and token variants used by SMS/email jobs.
- Keep web Sentry initialization behind `apps/web/src/lib/sentry.ts`. The
  browser helper owns `beforeSend`, replay opt-in, tracing sample rate, and
  id-only user context. `apps/web/src/main.tsx` should call `initSentry()` and
  import `Sentry` from that helper for captures.
- Keep release smoke triggers disabled by default. `SENTRY_SMOKE_ENABLED=true`
  plus a release-only `SENTRY_SMOKE_TOKEN` is required before
  `/api/v1/ops/sentry-smoke/api` can create the controlled 500 marker or
  `/api/v1/ops/sentry-smoke/worker` can queue the controlled worker failure.
- Prefer `pnpm deploy:evidence:sentry:trigger -- --observe-delay-ms 30000` for
  release evidence windows. It triggers both controlled smoke paths, waits for
  Sentry ingestion, then queries Sentry and writes the compact evidence
  artifact. Use `pnpm deploy:evidence:sentry` only when both smoke events were
  triggered separately.
- Worker startup must call `initWorkerSentry(log)` and attach the Sentry
  listener to every BullMQ worker. Otherwise the Sentry evidence writer can
  query for a worker marker that the process never emits.

## Verification

- `pnpm --filter @bidstack/api exec vitest run src/plugins/sentry.test.ts src/plugins/sentry-context.test.ts --reporter=dot`
- `pnpm --filter @bidstack/api exec vitest run src/plugins/auth.test.ts src/plugins/sentry.test.ts src/plugins/sentry-context.test.ts --reporter=dot`
- `pnpm --filter @bidstack/api typecheck`
- `pnpm --filter @bidstack/api exec eslint src/lib/sentry-privacy.ts src/instrument.ts src/plugins/sentry.ts src/plugins/sentry.test.ts src/plugins/sentry-context.test.ts src/plugins/auth.ts src/plugins/error-handler.ts src/server.ts`
- `pnpm --filter @bidstack/api build`
- `pnpm --filter @bidstack/web exec vitest run src/lib/sentry.test.ts --reporter=dot`
- `pnpm --filter @bidstack/web exec tsc --noEmit --pretty false`
- `pnpm --filter @bidstack/web exec eslint --no-ignore --no-warn-ignored src/main.tsx src/lib/sentry.ts src/lib/sentry.test.ts`
- `pnpm --filter @bidstack/web build`
- `pnpm --filter @bidstack/api exec vitest run src/routes/ops-sentry-smoke.test.ts --reporter=dot`
- `pnpm --filter @bidstack/worker exec vitest run src/queues/sentry-smoke.test.ts --reporter=dot`
- `pnpm deploy:evidence:sentry:selftest`
- `git diff --check -- <touched sentry files>`

## 2026-06-18 Request Hook Encapsulation Fix

- API Sentry plugin now uses `fastify-plugin`, matching other cross-cutting
  request middleware. Regression coverage proves a route registered outside the
  plugin scope still triggers request cleanup.
- API and browser Sentry helpers now set `orgId=unauthenticated` when auth is
  missing or cleared. This avoids stale tenant-tag attribution while keeping
  telemetry non-PII.
- Focused proof:
  `pnpm --filter @bidstack/api exec vitest run src/plugins/sentry.test.ts src/plugins/sentry-context.test.ts --reporter=dot`,
  `pnpm --filter @bidstack/web exec vitest run src/lib/sentry.test.ts --reporter=dot`,
  targeted API/web ESLint, and API/web TypeScript all passed.

## Residual Risk

Production certification still needs live Sentry project proof:

- `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, and `SENTRY_RELEASE` set in staging.
- A staged 5xx smoke event observed in the API project.
- Worker failure capture observed on a non-production queue.
- Session replay remains disabled unless legal approval exists.
