# Layout Summary Endpoints

## Problem

Global chrome can quietly become an app-wide performance tax when badges fetch full list payloads on every page load. The symptoms are slow query warnings from endpoints such as tasks, mentions, and integration status even when the user only needs a small count.

## Pattern

- Add purpose-built summary endpoints for badge/count data.
- Keep response contracts small and typed in `@bidstack/shared`.
- Lazy-load full list payloads only when the user opens the surface that needs the list.
- Invalidate summary queries from the same mutations that invalidate the full list.
- Use short server-side caches only for read-only integration health checks where seconds of staleness are acceptable.
- Use in-flight promise caches for always-mounted dashboard/summary reads so parallel page loads share one backend computation instead of stampeding the same tables.
- Put hot read endpoints through the shared Redis-backed request cache when the payload is tenant-scoped and safe to serve for a short TTL. Use explicit cache keys when the payload is user-scoped.
- Keep process-local promise caches as stampede protection only; Redis is the cross-replica cache and the route mutation hook invalidates tenant cache entries after successful writes.

## Example

- `GET /api/tasks/summary` returns total/open/overdue/due-soon task counts.
- `GET /api/mentions/summary` returns unread mention count.
- `GET /api/crm/summary` honors its `limit` query and uses one aggregate count query for dashboard shell metrics.
- `GET /api/crm/dashboard`, `/api/crm/release-score`, `/api/integrations/dust/status`, and `/api/tasks/summary` use short tenant-scoped Redis cache entries.
- `GET /api/mentions/summary` uses a user-scoped cache key to avoid leaking one user's unread count to another user in the same org.
- The sidebar and mobile navigation use task summary data instead of unbounded task lists.
- The topbar badge uses mention summary data, while the dropdown fetches full mentions only after it opens.

## Verification

- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm e2e -- smoke.spec.ts`

## Notes

This pattern is not a substitute for database indexing, pagination, or materialized reporting. It is the first line of defense for always-mounted UI that should never pull complete business objects just to render a badge.
