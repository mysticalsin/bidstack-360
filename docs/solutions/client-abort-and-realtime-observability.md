# Client Abort and Realtime Observability

## Context

Focused browser QA can pass functionally while still leaving production
observability noisy. The Technical Stack flow exposed two examples:

- aborted dashboard refetches could appear as `premature close` server errors;
- realtime Redis pub/sub attempted startup connections during HTTP-only QA.

Both are false incident signals for a 100k-user rollout unless classified
correctly.

## Pattern

- Classify expected client-disconnect errors before route-level logging,
  central error handling, and Sentry capture.
- Return a bounded `499 Client Closed Request` response only when the socket is
  still writable; otherwise log a compact info event and stop.
- Suppress route error logs for expected 4xx responses. The response itself is
  the useful signal; an error-level log is alert noise.
- Lazy-connect optional realtime Redis clients. HTTP-only startup should not
  emit realtime connection incidents; realtime publish/subscribe paths should
  still fail loudly when invoked and Redis is unavailable.

## Implementation

- `apps/api/src/lib/http-client-abort.ts` centralizes conservative abort
  detection and bounded log fields.
- `apps/api/src/plugins/error-handler.ts` maps expected aborts to 499 without
  Sentry capture.
- `apps/api/src/plugins/sentry.ts` double-guards capture against expected aborts.
- `apps/api/src/routes/crm/dashboard.ts` suppresses route-level error logs for
  expected aborts and 4xx dashboard requests.
- `apps/api/src/services/realtime.service.ts` and
  `apps/api/src/services/presence.service.ts` lazy-connect Redis.

## Verification

- `pnpm --filter @bidstack/api exec vitest run src/lib/http-client-abort.test.ts src/plugins/sentry-context.test.ts src/routes/crm/dashboard.test.ts`
- `pnpm --filter @bidstack/api exec vitest run src/plugins/realtime.validateChannel.test.ts src/lib/http-client-abort.test.ts src/plugins/sentry-context.test.ts src/routes/crm/dashboard.test.ts`
- `pnpm --filter @bidstack/api exec eslint src/services/realtime.service.ts src/services/presence.service.ts src/plugins/realtime.ts src/plugins/realtime.validateChannel.test.ts src/lib/http-client-abort.ts src/lib/http-client-abort.test.ts src/plugins/error-handler.ts src/plugins/sentry.ts src/plugins/sentry-context.test.ts src/routes/crm/dashboard.ts`
- `pnpm --filter @bidstack/api typecheck`
- From `apps/web`: `$env:E2E_PORT_OFFSET='178'; pnpm exec playwright test e2e/technical-stack.spec.ts --project=chromium-desktop`

## Guardrail

If browser QA passes but server output contains level-50 noise, treat it as a
release-readiness issue. Either prove it is a real dependency failure or classify
it so it cannot pollute production incident channels.
