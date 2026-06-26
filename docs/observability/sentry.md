# Sentry Integration - BidStack 360

## Overview

BidStack uses Sentry for error tracking across runtime surfaces:

- **API** (`apps/api`) - Fastify request errors and 5xx exceptions.
- **Worker** (`apps/worker`) - BullMQ job failures.
- **Web** (`apps/web`) - React unhandled exceptions, performance tracing, and optional session replay.

## Setup

### 1. Create Sentry Projects

Create three projects in Sentry:

- `bidstack-api` - Platform: Node.js / Fastify
- `bidstack-worker` - Platform: Node.js
- `bidstack-web` - Platform: JavaScript / React

### 2. Set Environment Variables

```bash
# Backend
SENTRY_DSN=https://xxxxxxx@oXXX.ingest.sentry.io/YYYYYYY
SENTRY_ENVIRONMENT=production
SENTRY_RELEASE=git-sha-or-semver
SENTRY_TRACES_SAMPLE_RATE=0.1

# Frontend
VITE_SENTRY_DSN=https://xxxxxxx@oXXX.ingest.sentry.io/ZZZZZZZ
VITE_SENTRY_ENVIRONMENT=production
VITE_SENTRY_RELEASE=git-sha-or-semver
VITE_SENTRY_TRACES_SAMPLE_RATE=0.1
VITE_SENTRY_REPLAY=false
```

### 3. API Wiring

`apps/api/src/main.ts` initializes Sentry before the server is built:

```ts
import { initSentry } from './instrument.js';

initSentry();
const server = await buildServer();
```

`apps/api/src/server.ts` registers the request-scope plugin immediately after
auth so `req.auth` is available:

```ts
await server.register(errorHandlerPlugin);
await server.register(authPlugin);
await server.register(sentryPlugin);
```

Handled 5xx errors are captured from the central error handler through
`captureSentryServerError()` so normalized application errors still reach
operator alerts.

### 4. Worker Wiring

```ts
import { attachSentryToWorker, initWorkerSentry } from './plugins/sentry.js';

initWorkerSentry(log);
attachSentryToWorker(worker, 'queue-name', log);
```

### 5. Web Wiring

```tsx
import { initSentry } from './lib/sentry.js';

initSentry();
createRoot(document.getElementById('root')!).render(<App />);
```

Session replay is privacy-sensitive. Keep `VITE_SENTRY_REPLAY=false` until
legal/product approval exists.

## PII Protection

All API Sentry events pass through `apps/api/src/lib/sentry-privacy.ts` before
transmission. It redacts email, phone/name variants, postal identifiers,
token/API-key variants, and worker phone-number fields from request and extra
payloads.

Sentry user context is pseudonymous: `{ id: userId }` only. Org id is a tag.
Email, name, and phone must not be added to Sentry scope.

Verify with:

```bash
pnpm --filter @bidstack/api exec vitest run src/plugins/sentry.test.ts src/plugins/sentry-context.test.ts
```

## Sourcemap Upload

Set `SENTRY_RELEASE` during CI and upload sourcemaps for deploys that need
original TypeScript line numbers.

For API artifacts:

```bash
sentry-cli releases new "$SENTRY_RELEASE"
sentry-cli releases files "$SENTRY_RELEASE" upload-sourcemaps ./dist --url-prefix "~/"
sentry-cli releases finalize "$SENTRY_RELEASE"
```

For web artifacts, use `@sentry/vite-plugin` or an equivalent CI step with
`SENTRY_AUTH_TOKEN` stored as a CI secret.

## Alert Recommendations

| Alert                  | Condition                      | Action                |
| ---------------------- | ------------------------------ | --------------------- |
| Error rate spike       | Error rate > 0.1% in 5 minutes | Email + Slack on-call |
| New fatal issue        | First seen, severity fatal     | Email                 |
| Performance regression | p95 latency > 2 seconds        | Email                 |
| Worker job failure     | `queue` tag present, any error | Slack on-call         |

## Launch Gate

Production deploys require:

- `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, and `SENTRY_RELEASE` set.
- `SENTRY_SMOKE_ENABLED=true` and a release-only `SENTRY_SMOKE_TOKEN` set only
  while generating evidence.
- A passing Sentry privacy test run.
- A staged 5xx smoke event observed in the `bidstack-api` project.
- Worker failure capture verified on at least one non-production queue.
- Session replay disabled unless legal sign-off exists.

Trigger controlled smoke events from the release target and generate deploy
evidence:

```powershell
$env:API_BASE_URL='https://<staging-or-production-api>'
$env:SENTRY_SMOKE_TOKEN='<release-smoke-token>'
$env:SENTRY_RELEASE='bidstack@0.1.0+abc123'
$env:SENTRY_ENVIRONMENT='staging'
$env:BIDSTACK_SENTRY_ORG='<sentry-org-slug>'
$env:BIDSTACK_SENTRY_API_PROJECT='bidstack-api'
$env:BIDSTACK_SENTRY_WORKER_PROJECT='bidstack-worker'
$env:BIDSTACK_SENTRY_DSN_CONFIGURED='true'
pnpm deploy:evidence:sentry:trigger -- --observe-delay-ms 30000
```

The trigger-capable evidence writer sends the controlled API 500 and worker
failure, waits for ingestion, queries Sentry through the CLI for release-scoped
API and worker smoke markers, then writes
`deploy-evidence/sentry-smoke-latest.json` for the strict deploy gate. The smoke
token is sent only as `x-bidstack-sentry-smoke-token`; it is never written to
the artifact. The artifact does record the non-local API trigger target; strict
deploy verification rejects missing, local, or placeholder-looking trigger
targets.
