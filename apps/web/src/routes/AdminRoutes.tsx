/**
 * adminRouteElements — routes that require admin role.
 *
 * All elements are wrapped in RequireAdmin (redirects non-admins to /dashboard).
 * WHY a function: same reasoning as BidRoutes / SalesRoutes.
 */
import { Route } from 'react-router-dom';

import { AuditLogPage, CustomObjectsAdminPage, PredictiveAdminPage, RolesPage } from './lazyPages';
import { RequireAdmin } from './AuthGuards';

export function adminRouteElements() {
  return (
    <>
      <Route
        path="/audit-log"
        element={
          <RequireAdmin>
            <AuditLogPage />
          </RequireAdmin>
        }
      />
      <Route
        path="/admin/custom-objects"
        element={
          <RequireAdmin>
            <CustomObjectsAdminPage />
          </RequireAdmin>
        }
      />
      <Route
        path="/admin/predictive"
        element={
          <RequireAdmin>
            <PredictiveAdminPage />
          </RequireAdmin>
        }
      />
      <Route
        path="/roles"
        element={
          <RequireAdmin>
            <RolesPage />
          </RequireAdmin>
        }
      />
    </>
  );
}
