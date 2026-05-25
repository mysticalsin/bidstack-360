# Sentry Integration — BidStack 360°

## Overview

BidStack uses Sentry for error tracking across all three runtime surfaces:
- **API** (`apps/api`) — Fastify request errors, 5xx exceptions
- **Worker** (`apps/worker`) — BullMQ job failures
- **Web** (`apps/web`) — React unhandled exceptions, performance tracing, optional session replay

## Setup

### 1. Create a Sentry Organization + Projects

1. Sign in at [sentry.io](https://sentry.io) → New Organization.
2. Create **three projects**:
   - `bidstack-api` (Platform: Node.js → Fastify)
   - `bidstack-worker` (Platform: Node.js)
   - `bidstack-web` (Platform: JavaScript → React)
3. Copy the DSN for each project.

### 2. Set Environment Variables

Add to your `.env` (copy from `.env.example`):

```bash
# Backend (API + Worker share the same DSN if you want unified backend project)
SENTRY_DSN=https://xxxxxxx@oXXX.ingest.sentry.io/YYYYYYY
SENTRY_ENVIRONMENT=production       # development | staging | production
SENTRY_RELEASE=git-sha-or-semver   # set in CI (e.g. $(git rev-parse HEAD))

# Frontend
VITE_SENTRY_DSN=https://xxxxxxx@oXXX.ingest.sentry.io/ZZZZZZZ
VITE_SENTRY_ENVIRONMENT=production
VITE_SENTRY_RELEASE=git-sha-or-semver
VITE_SENTRY_REPLAY=false            # set true to enable session replay (legal review required)
```

### 3. Wire Up in Code

**API entry point** (`apps/api/src/index.ts`):
```ts
// MUST be called BEFORE buildServer()
import { initSentry } from './plugins/sentry.js';
initSentry();
const server = await buildServer();
```

**API server** (`apps/api/src/server.ts`) — in `buildServer()`, register Sentry FIRST:
```ts
import { sentryPlugin } from './plugins/sentry.js';
// ... register sentryPlugin before other plugins ...
await server.register(sentryPlugin);           // ← first
await server.register(datadogPlugin);          // ← second
await server.register(errorHandlerPlugin);     // ← third
```

**Worker** (`apps/worker/src/main.ts`):
```ts
import { initWorkerSentry, attachSentryToWorker } from './plugins/sentry.js';
initWorkerSentry(log);
// After each startXxxWorker() call, attach Sentry to each Worker instance
```

**Web** (`apps/web/src/main.tsx`):
```tsx
import { initSentry } from './lib/sentry.js';
initSentry();  // before createRoot()
createRoot(document.getElementById('root')!).render(<App />);
```

**Web Error Boundary** (in `App.tsx`):
```tsx
import { Sentry } from './lib/sentry.js';
<Sentry.ErrorBoundary fallback={<ErrorFallback />}>
  <RouterProvider router={router} />
</Sentry.ErrorBoundary>
```

## Sourcemap Upload (Production)

Sourcemaps let Sentry show original TypeScript line numbers in stack traces.

### Vite Plugin (recommended)
```bash
pnpm add -D @sentry/vite-plugin
```

In `apps/web/vite.config.ts`:
```ts
import { sentryVitePlugin } from '@sentry/vite-plugin';
export default defineConfig({
  plugins: [
    react(),
    sentryVitePlugin({
      org: 'your-sentry-org',
      project: 'bidstack-web',
      authToken: process.env.SENTRY_AUTH_TOKEN,
    }),
  ],
  build: { sourcemap: true },
});
```

Set `SENTRY_AUTH_TOKEN` in CI secrets (GitHub Actions → Settings → Secrets).

### sentry-cli (alternative for API)
```bash
sentry-cli releases new $SENTRY_RELEASE
sentry-cli releases files $SENTRY_RELEASE upload-sourcemaps ./dist --url-prefix '~/'
sentry-cli releases finalize $SENTRY_RELEASE
```

## PII Protection

All three surfaces implement `beforeSend` hooks that scrub PII before any data
leaves the process. Fields redacted: `email`, `phone`, `name`, `firstName`,
`lastName`, `password`, `secret`, `token`, `apiKey`, and variants (snake_case,
camelCase). See `apps/api/src/plugins/sentry.ts` for the canonical list.

**Verify**: The unit tests in `apps/api/src/plugins/sentry.test.ts` assert PII
scrubbing across nested objects and arrays. Run them with:
```bash
pnpm test --reporter=verbose apps/api/src/plugins/sentry.test.ts
```

## Alert Recommendations

Configure in Sentry → Alerts → Create Alert Rule:

| Alert | Condition | Action |
|-------|-----------|--------|
| Error rate spike | Error rate > 0.1% in 5m window | Email + Slack #on-call |
| New issue | First seen, severity: fatal | Email |
| Performance regression | p95 latency > 2s | Email |
| Worker job failure | `queue` tag present, any error | Slack #on-call |

## Session Replay

Opt-in: set `VITE_SENTRY_REPLAY=true`. Captures a video replay of sessions
where errors occur. **Legal sign-off required** — session replay captures user
interactions which may constitute personal data processing under GDPR.

Configuration: `maskAllInputs=true` (default) — all input fields are masked.
Review `apps/web/src/lib/sentry.ts` for the full configuration.
