# Browser HTTP Cache and API Freshness

## Problem

Authenticated CRM pages can refetch through React Query and still receive stale
JSON if the browser HTTP cache reuses a previous `GET /api/...` response. This
showed up as:

1. Visit opportunities list.
2. Create a new opportunity through an API call.
3. Open the pipeline.
4. Pipeline still shows the old cached list until a hard state reset.

Server logs confirmed no new network GET in the broken path because the browser
served `Cache-Control: private, max-age=30` data from its own cache.

## Fix Pattern

- Keep server-side tenant caching for scale.
- Do not let the browser HTTP cache reuse authenticated API JSON.
- Set `cache: 'no-store'` in the frontend API boundary, not in every hook.
- Keep React Query freshness recovery on focus/reconnect.
- For critical list surfaces, refetch when mounted over already-cached data.

## Implementation

- `apps/web/src/lib/api.ts` applies `cache: 'no-store'` to JSON API fetches and
  CSV/export fetches.
- `apps/web/src/hooks/useOpportunities.ts` keeps opportunity list queries stale
  and performs a guarded one-shot refetch when mounted with cached data.
- `apps/web/e2e/flows/pipeline.spec.ts` includes a regression that warms the
  list, creates a deal through the API, opens pipeline, and expects the new card.

## Verification

- The regression must show a real `GET /api/v1/opportunities?limit=50` after
  the API create.
- The freshly created card must appear in the pipeline without logout/reload.
- Full Playwright should pass because this touches the shared API boundary.

## 2026-06-17 SERUM API Base Regression

SERUM exposed a deployment-sensitive variant of the same freshness class: a
valid backend can look unavailable when `VITE_API_URL` already includes `/api`
or `/api/v1` and the frontend appends `/api/v1` again.

Fix pattern:

- Normalize the API base once in `apps/web/src/lib/api.ts`.
- Strip trailing `/api` and `/api/v1` from configured bases before joining API
  paths.
- Keep hook paths canonical (`/api/v1/...`) and let the API boundary handle URL
  construction.
- Bump service-worker/app-shell cache names after shared API-boundary changes so
  old clients do not keep stale request logic.

Regression coverage:

- `apps/web/src/lib/api.test.ts` proves root, `/api`, `/api/v1`, and deployed
  absolute API URLs all produce exactly one `/api/v1/...` path.
- `apps/web/e2e/flows/pwa-offline.spec.ts` tracks the current app-shell cache
  name.

## 2026-06-18 App-Shell Edge Cache Policy

The browser API boundary already uses `cache: 'no-store'`, but production nginx
still needed explicit app-shell headers. The app entrypoints (`/`,
`/index.html`, `/manifest.json`, and `/sw.js`) now use
`Cache-Control: no-cache, no-store, must-revalidate`, while hashed `/assets/`
stay `public, max-age=31536000, immutable`.

Nginx detail: locations that use `add_header` redeclare the security headers.
Without that, nginx can stop inheriting parent `add_header` values and cached
asset responses can silently lose the X-Frame-Options / nosniff / referrer
policy posture.
