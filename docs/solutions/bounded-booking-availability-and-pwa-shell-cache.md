# Bounded Booking Availability and PWA Shell Cache

## Problem

Public booking and offline PWA flows can look like UI failures while the real issue is release-gate infrastructure:

- Booking availability may be rejected by the API query guard when request-path `findMany` calls are time-scoped but missing explicit `take` limits.
- Offline app-shell tests may receive cached HTML but fail to boot React because hashed Vite JS/CSS assets were never cached before the browser went offline.

## Pattern

- Every Prisma `findMany` in a request path needs a business bound and deterministic `orderBy`, even when the `where` clause is narrow.
- Availability checks should bound both external calendar blocks and existing booking blocks; booking creation should repeat the same bounded conflict validation.
- Booking creation must pass the same timezone used by the availability request into `computeSlots`. Otherwise a slot can be rendered as available in the visitor's timezone and then rejected when the POST path silently validates in UTC.
- Authenticated list routes should also include a sensible page size until the UI exposes explicit pagination.
- Production PWAs should warm the Cache Storage app-shell cache from the current document:
  - `/`
  - `/index.html`
  - `/manifest.json`
  - same-origin `script[src]`
  - same-origin stylesheet/modulepreload/preload links
- When Vite emits `dist/.vite/manifest.json`, cache the critical app-shell dependency graph by following `index.html` and the current route's manifest `imports`. For `/dashboard`, include `src/pages/DashboardPage.tsx`.
- Do not block service-worker activation on the full manifest. Cache the minimal shell plus critical graph during `install`, call `skipWaiting()`, then let full manifest caching run opportunistically.
- Do not use `cache.add` for JS/CSS warmup. Fetch with `cache: "reload"` and `cache.put` the response so Cache Storage receives full assets instead of conditional-cache edge cases.
- Vite preview responses can include `Vary: Origin`. Same-origin hashed static assets should be read with `cache.match(request, { ignoreVary: true })`; do not apply this to API/data responses.
- The service worker should still provide a navigation fallback to cached `/index.html`; cache warming only guarantees the app assets exist when offline reload happens quickly.
- Use network-first for API calls. Stale-while-revalidate is unsafe for booking availability, permissions, financials, and reservation-style flows.
- PWA E2E should wait for an active service-worker controller and verified app-shell Cache Storage entries before forcing offline mode. Avoid fixed sleeps.

## Verification

- `pnpm --filter @bidstack/api typecheck`
- `pnpm --filter @bidstack/web typecheck`
- `pnpm e2e -- flows/calendar-booking.spec.ts flows/pwa-offline.spec.ts`
