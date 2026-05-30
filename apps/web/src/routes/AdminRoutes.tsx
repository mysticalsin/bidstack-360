/**
 * adminRouteElements — routes that require admin role.
 *
 * All elements are wrapped in RequireAdmin (redirects non-admins to /dashboard).
 * WHY a function: same reasoning as BidRoutes / SalesRoutes.
 */
import { Route } from 'react-router-dom';

import {
  AuditLogPage,
  CustomObjectEditorPage,
  CustomObjectsAdminPage,
  PredictiveAdminPage,
  RolesPage,
} from './lazyPages';
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
      {/* The admin page + editor breadcrumb both navigate to
          /settings/custom-objects[/:id]; without these the editor (and its
          field/relation management) was unreachable and 404'd. */}
      <Route
        path="/settings/custom-objects"
        element={
          <RequireAdmin>
            <CustomObjectsAdminPage />
          </RequireAdmin>
        }
      />
      <Route
        path="/settings/custom-objects/:id"
        element={
          <RequireAdmin>
            <CustomObjectEditorPage />
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
