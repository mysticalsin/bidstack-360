# Service Worker API Bypass and Streaming CORS

## Problem

Long-lived pages can become controlled by the service worker after initial load.
If the worker intercepts API/export/data traffic, users can see stale responses,
fake offline failures, or CORS-like export failures after the page has been open.

CSV export had a second risk: raw Node response streaming can bypass Fastify
headers, which drops CORS/security headers even when the global plugins are
configured correctly.

## Fix Pattern

- Service workers cache app-shell assets only.
- Bypass all API, auth, export, webhook, and data requests.
- Bypass cross-origin requests.
- Stream downloads through Fastify's reply lifecycle so global headers apply.

## Implementation

- `apps/web/public/sw.js`
  - Uses `bidstack-v4-network-owned-routes`.
  - Bypasses API, auth, OAuth, tRPC, Dust webhook, export, download, and
    cross-origin requests.
  - Stops returning synthetic offline API `503` responses.
  - Exposes the route policy only under `self.__BIDSTACK_SW_TEST__` so unit
    tests can prove what the worker will and will not intercept.
- `apps/web/src/main.tsx`
  - Uses the same app-shell cache version.
- `apps/web/nginx.conf`
  - Serves `/`, `/index.html`, `/manifest.json`, and `/sw.js` with
    `Cache-Control: no-cache, no-store, must-revalidate`.
  - Keeps hashed `/assets/` immutable while redeclaring security headers in
    that location, avoiding nginx `add_header` inheritance surprises.
- `apps/api/src/routes/opportunities.export.ts`
  - Pipes CSV through a `PassThrough` stream and `reply.send(stream)`.
- `apps/web/src/lib/service-worker-policy.test.ts`
  - Proves network-owned routes are not intercepted.
- `apps/web/src/lib/nginx-cache-policy.test.ts`
  - Proves app-shell, service-worker, asset, and health cache/header rules.

## Verification

- Production preview with an active service worker can reload and still fetch
  both same-origin `/api/...` and direct API URLs successfully.
- Opportunity CSV export returns `200` and shows the completion toast.
- Full Playwright and manual Chromium QA pass.

## 2026-06-18 Network-Owned Route Hardening

Long-lived tabs still had a release-risk gap: the worker only recognized
`/api/` and `/trpc/` as sensitive, while the documented contract said auth,
export, webhook, and download traffic were outside the app-shell cache. The
worker now treats those paths as network-owned, purges any matching cache
entries during activation, and bumps the cache name so existing clients get a
fresh app-shell policy.

Verification:

- `pnpm --filter @bidstack/web exec vitest run src/lib/service-worker-policy.test.ts src/lib/nginx-cache-policy.test.ts --reporter=dot`:
  5/5 pass.
- Targeted ESLint for the worker, nginx tests, main entry, and PWA spec: pass.
- `pnpm --filter @bidstack/web exec tsc --noEmit --pretty false`: pass.
- `docker run --rm -v <nginx.conf>:/etc/nginx/conf.d/default.conf:ro nginxinc/nginx-unprivileged:alpine nginx -t`:
  pass.
- `pnpm --filter @bidstack/web build`: pass.
- `E2E_PORT_OFFSET=142 pnpm --filter @bidstack/web e2e -- e2e/flows/pwa-offline.spec.ts --project=chromium-desktop`:
  3/3 pass.

## 2026-06-18 Production Public-Origin Boot Gate

The API CORS helper can only protect browser traffic after boot. Production
must also fail fast when the declared public web origin is not a real HTTPS
origin.

Fix pattern:

- In production, reject `PUBLIC_BASE_URL` unless it uses `https:`.
- In production, reject loopback public origins including `localhost`,
  `127.x.x.x`, and `::1`.
- Keep development/test loopback variants available through
  `buildAllowedCorsOrigins` so local preview and shifted Vite ports still work.

Verification:

- `pnpm --filter @bidstack/api test -- src/env.test.ts --reporter=dot`:
  6/6 pass.
- `pnpm --filter @bidstack/api test -- src/lib/cors-origins.test.ts --reporter=dot`:
  2/2 pass.
- `pnpm --filter @bidstack/api exec eslint src/env.ts src/env.test.ts src/lib/cors-origins.ts src/lib/cors-origins.test.ts`:
  pass.
- `pnpm --filter @bidstack/api typecheck`: pass.
