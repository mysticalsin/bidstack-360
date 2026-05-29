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

## Example

- `GET /api/tasks/summary` returns total/open/overdue/due-soon task counts.
- `GET /api/mentions/summary` returns unread mention count.
- `GET /api/crm/summary` honors its `limit` query and uses one aggregate count query for dashboard shell metrics.
- The sidebar and mobile navigation use task summary data instead of unbounded task lists.
- The topbar badge uses mention summary data, while the dropdown fetches full mentions only after it opens.

## Verification

- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm e2e -- smoke.spec.ts`

## Notes

This pattern is not a substitute for database indexing, pagination, or materialized reporting. It is the first line of defense for always-mounted UI that should never pull complete business objects just to render a badge.
