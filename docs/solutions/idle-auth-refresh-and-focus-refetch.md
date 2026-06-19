# Idle Auth Refresh and Focus Refetch

## Problem

Long-lived CRM tabs can sit through laptop sleep, browser throttling, or Clerk
token cache expiry. If the next API call returns `401` or `403` and React Query
does not refetch stale data on focus/reconnect, the app feels stuck until the
user logs out and back in. Logout/login works only because it clears query state
and forces Clerk to mint a fresh token.

## Pattern

- Keep the API retry bounded: on `401` or `403`, retry exactly once with a
  forced token refresh, then surface the final error.
- Model forced refresh in the frontend API boundary, not in every hook.
- For Clerk, map the forced refresh to `getToken({ skipCache: true })`.
- Leave true authorization failures visible. A second `403` after forced refresh
  is a real permission/product-state problem, not a cache problem.
- Keep React Query `staleTime` high enough to avoid noisy tab switches, but
  enable `refetchOnWindowFocus` and `refetchOnReconnect` so long-idle pages heal.

## Implementation

- `apps/web/src/lib/api.ts` accepts token-provider options and retries one
  auth-status response with `{ forceRefresh: true }`.
- `apps/web/src/lib/auth.tsx` maps `{ forceRefresh: true }` to Clerk
  `{ skipCache: true }`.
- `apps/web/src/main.tsx` enables focus/reconnect refetch for stale queries.
- `apps/web/e2e/flows/idle-auth-recovery.spec.ts` runs a production-preview
  browser flow in demo auth mode, returns one `401` from SERUM status, and
  proves the shared API boundary retries without showing the unavailable state.
- `apps/web/playwright.config.ts` lets managed E2E builds select auth mode via
  `E2E_AUTH_MODE`/`VITE_AUTH_MODE`, so demo and Clerk auth gates cannot be
  silently compiled as stub auth.

## Verification

- Unit-test the stale-token path: first response `401`, second response `200`,
  provider called with `{ forceRefresh: true }`.
- Unit-test true denial: first response `401`, second response `403`, final
  `ApiError` surfaces and fetch runs exactly twice.
- Bridge-test Clerk: forced API refresh must call Clerk with `{ skipCache: true }`.
- Browser-test the idle recovery class: `E2E_AUTH_MODE=demo` plus a forced
  SERUM `401` must recover to a healthy snapshot and never show
  `SERUM status is unavailable`.
- Run the full web test suite to catch shared query/auth side effects.

## 2026-06-17 SERUM Control Plane Recovery

SERUM status is a good canary for long-lived authenticated tabs because it is
visible, live, and used by both Mission Control and Settings.

Added guardrails:

- `useSerumStatus` uses `/api/v1/serum/status`, `staleTime: 10_000`,
  `refetchInterval: 30_000`, and always refetches on mount, focus, and
  reconnect.
- `SerumErrorState` now distinguishes auth, permission, missing route, backend,
  and network failures so operators know whether to sign in, check access,
  verify routing, or check API health.
- The focused idle recovery E2E forces one SERUM `401` and proves the shared API
  boundary retries with a fresh token and never renders the unavailable state.

## 2026-06-18 Tenant Fingerprint Cache Clear

Long-lived tabs can also stay stale when the authenticated identity changes but
the local session marker string does not. Demo mode can mint a new workspace
for a new email while `bidstack:session` remains `demo`, and Clerk users can
switch active organizations while keeping the same user id.

Added guardrails:

- `watchAuthForCacheClear` now listens for an explicit same-tab
  `bidstack:auth-fingerprint-change` event in addition to browser `storage`
  events.
- Auth writes now emit that event even when the session marker value is
  unchanged, so a changed demo email clears persisted query snapshots without
  requiring logout.
- Clerk auth markers now include the active organization:
  `userId:orgId`. Switching organizations therefore clears hydrated CRM data
  instead of reusing another tenant's cache.

Verification:

- `src/lib/queryCache.test.ts` proves demo identity changes clear cached query
  data even when the session marker remains `demo`.
- `src/lib/auth.test.tsx` proves Clerk stores `userId:orgId` in the session
  marker.
- The focused idle recovery browser test still proves the stale-token path
  recovers from one forced `401` without showing the unavailable SERUM state.

## 2026-06-19 Role and Security Cache Boundaries

Long-lived tabs can still feel "fixed" only by logout/login when authorization,
admin settings, or provider credentials are cached as ordinary query data.
Those payloads are source-of-truth controls, not dashboard snapshots.

Added guardrails:

- Clerk cache identity markers now include active role:
  `userId:orgId:orgRole`. Role changes clear live and persisted query state
  instead of reusing a stale capability manifest.
- Stub auth fingerprints include `bidstack:stub-role`, so E2E/admin-role
  changes clear cached UI state even when `bidstack:session` remains `stub`.
- React Query persistence now refuses auth/admin/security/provider prefixes:
  `me`, `users`, `user-roles`, `roles`, `permissions`, `api-keys`,
  `agent-provider-credentials`, Dust credentials/status, CRM connector health,
  integration setup, and webhooks.
- The idle-auth E2E SERUM fixture now includes `signalHealth`, matching the
  current page contract so the browser gate proves recovery instead of crashing
  on incomplete mock data.

Verification:

- `src/lib/queryCache.test.ts` proves sensitive/live prefixes are not hydrated
  and stub-role changes clear live query state.
- `src/lib/auth.test.tsx` proves Clerk markers include org role and update when
  the role changes.
- The focused idle recovery browser test still proves a forced SERUM `401`
  retries and never shows the unavailable state.
