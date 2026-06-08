# Dev workspace auth, pipeline stage cache, and KPI layout

**Problem:** Three separate UX failures made the CRM feel unstable:

- Direct local visits to `/dashboard` or `/pipeline` could render the public landing shell instead of the CRM workspace.
- Pipeline moves could return success while the opportunity appeared to stay in the original column.
- Dashboard KPI cards overlapped when the sidebar reduced the main content width.
- Opportunities list and pipeline tests could time out when the database had to scan/sort list rows and batch-count comments without matching composite indexes.
- Browser smoke could show a rendered CRM shell while `/api/v1/...` calls returned 500 through the Vite proxy because the API process was not running.

## Root causes

- Stub auth defaulted to signed out unless `bidstack:session` already existed in local storage.
- Pipeline optimistic updates changed only `pipelineStageId`; grouped views also depend on `stage` and `pipelineStage`.
- KPI cards used six fixed grid columns and switched to inline mini-signals before there was enough room.
- The opportunities list query filters by `orgId` and `deletedAt`, sorts by `updatedAt desc`, and then groups comments by target while filtering deleted comments. The schema only had narrower single-purpose indexes.
- A rendered Vite page is not proof that the Fastify API is healthy; the dev proxy can return upstream failures while the shell still loads.

## Fix

- In dev stub auth, default to the local signed-in user. Preserve explicit sign-out with a separate signed-out marker.
- Treat a stage move as a relational state transition. Update `stage`, `pipelineStageId`, and `pipelineStage` together in list and detail caches, then reconcile from the server response.
- Use `auto-fit` with a minimum KPI track width, and keep the mini-signal below the KPI text until the content area is wide enough.
- Add list-view composite indexes for `opportunities(org_id, deleted_at, updated_at desc)` and comment aggregation indexes for `comments(org_id, target_type, target_id, deleted_at)`.
- For local browser smoke, verify `GET /readyz` and capture network responses; do not rely on visible page text alone.

## Prevention rule

When a route is part of the authenticated CRM, browser smoke must start from the direct URL, not only from a prior login path. When a drag/drop mutation changes a relationship, tests must assert every field used by grouping and rendering. For dashboard cards, layout breakpoints must be based on available component width, not optimistic full-page width. When a list endpoint is part of daily CRM navigation, benchmark the exact filter/order/count shape and add schema-backed indexes before increasing test timeouts.

## Validation

- `pnpm --filter @bidstack/web typecheck`
- `pnpm --filter @bidstack/api typecheck`
- `vitest run src/lib/auth.test.tsx src/hooks/useStageMutation.test.tsx src/lib/pipeline-stages.test.ts`
- `vitest run src/routes/opportunities.integration.test.ts`
- Browser smoke for `/dashboard` and `/pipeline`
- Visual screenshot review of the dashboard KPI grid at 1440px
- API readiness check for `/readyz`

## Files affected

- `apps/web/src/lib/auth.tsx`
- `apps/web/src/lib/auth.test.tsx`
- `apps/web/src/hooks/useStageMutation.ts`
- `apps/web/src/hooks/useStageMutation.test.tsx`
- `apps/web/src/index.css`
- `apps/web/src/styles/org-dashboard.css`
- `packages/db/prisma/schema.prisma`
- `packages/db/prisma/migrations/20260605190000_opportunity_list_indexes/migration.sql`
