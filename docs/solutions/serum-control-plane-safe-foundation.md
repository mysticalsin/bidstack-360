# SERUM Control Plane Safe Foundation

## Problem

SERUM introduces a high-trust agent control plane. It must feel premium without implying autonomous behavior, fake activity, fake confidence, or hidden production actions before the backend guarantees exist.

## Pattern

- Start with a read-only status endpoint backed by real existing tables.
- Default all SERUM feature flags to off.
- Block demo mode in production.
- Return `Cache-Control: no-store` for live control-plane status.
- Surface disabled, empty, not-configured, and attention states honestly.
- Keep settings visible but disable publish/rollback until versioned persistence and audit trails exist.
- Use existing app tokens and components; add SERUM-specific tokens only as a thin visual language layer.
- Verify with rendered desktop and mobile smoke, not screenshots alone.

## Implementation Notes

- Gate read-only SERUM status under `settings:read` when it powers admin settings/control-plane UX.
- Do not return secret material. Return booleans or health/status labels only.
- Treat N+1 detector warnings as release risks even when local latency is low.
- Batch scalar status counts into a guarded aggregate query. Keep row-list
  details like provider and queue health separate only when they are bounded.
- Expose query diagnostics in test as well as development, then assert status
  endpoints stay under the N+1 threshold.
- Use CSS keyframes for Radix mobile drawer animation when Framer/Radix ref handoff creates warnings.
- Use segmented buttons with `aria-pressed` for list/board route switches. Do not model route navigation as tabs unless there are real tab panels.

## Verification

- API returns 200 and `Cache-Control: no-store`.
- Disabled mode clearly says autonomous loops are not exposed.
- Publish/rollback remain disabled until persistence exists.
- Mobile drawer opens and closes with no console warnings.
- Sidebar/nav hit targets remain at least 44px.
- Critical toolbar controls pass Playwright, including board/list switch, import validation, CSV export, new-opportunity dialog, topbar controls, and keyboard-reachable menus.
- Focused route tests assert `X-Query-Count <= 10` and no `N+1 detected`
  warning for `/api/v1/serum/status`.
