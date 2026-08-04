/**
 * devRouteElements — design-system specimen routes. Development only.
 *
 * WHY a ternary around lazy() instead of a guard inside the function: Vite
 * statically replaces `import.meta.env.DEV` with `false` in a production build,
 * so the dynamic import lands in a dead branch and Rollup drops the chunk
 * entirely. Guarding only at render time would still emit (and ship) a
 * playground chunk nobody can reach.
 *
 * WHY a function returning a fragment, not a component: same reason as
 * BidRoutes/OpsRoutes — React Router v6 traverses the JSX statically, so a
 * component would hide the inner <Route> elements from createRoutesFromChildren.
 *
 * Deliberately NOT behind RequireAuth: the specimen sheet renders fixtures and
 * touches no API, and gating it would make the dev shortcut useless on a
 * signed-out box.
 */
import { lazy } from 'react';
import { Route } from 'react-router-dom';

const TableKitPlayground = import.meta.env.DEV
  ? lazy(() => import('@/pages/dev/TableKitPlayground'))
  : null;

export function devRouteElements() {
  if (!TableKitPlayground) return null;
  return <Route path="/dev/table-kit" element={<TableKitPlayground />} />;
}
