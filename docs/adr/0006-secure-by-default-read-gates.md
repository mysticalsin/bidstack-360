# ADR 0006: Secure-by-default read gates

Status: accepted (2026-10-31, backend hardening)

## Context

Authentication was default-deny (routes opt out with `config: { public: true }`),
but authorization was opt-in. A route census found 122 authenticated routes that
never consulted RBAC, mostly reads (`GET /leads`, issue #28; `GET /opportunities`,
`/companies`, `/contacts`, `/proposals`, `/tasks`, dashboards, forecasts...). A
role the matrix denies `leads:read` (Customer Success) or `opportunities:read`
(SDR) could still read that data through the API, global search and exports.
Route `config.permission` annotations existed but were observability-only.

## Decision

1. `config: { permission: 'x:read' }` on a route is now ENFORCED by a global
   `preHandler` in `plugins/rbac.ts` (named `rbac:declared`). A declared gate can
   no longer be decorative.
2. Every resource read requires that resource's `:read` permission, per
   `RBAC_MATRIX`. Example: `GET /api/v1/leads` requires `leads:read` (#28).
3. Routes that stay ungated must be listed in
   `apps/api/src/security/route-authz-allowlist.ts` with a reason: self-scoped
   data (filtered by the caller's userId) or org reference data every member
   needs (feature flags, locale, pipeline stages, territory catalogue, user
   picker).
4. `security/route-authz-census.integration.test.ts` boots the real server with
   every RBAC decision denied and fails on any authenticated route that answers
   without consulting RBAC and is not allowlisted. New routes must pick a gate.
5. Global search filters each result type by its `:read` permission and applies
   the ADR-7 access-group scope to opportunities.

## Consequences (behaviour changes)

- SDR no longer reads opportunities, proposals, forecasts or dashboards via the
  API (the matrix never granted `opportunities:read` / `reports:read`).
- Customer Success no longer reads leads.
- Account Executive no longer reads document templates, signature requests,
  sales toolkits, territory analytics or migrations (no `documents:read`,
  `territories:read`, `settings:read`).
- If product wants any of these, change `RBAC_MATRIX` (and re-seed), not the
  route.
