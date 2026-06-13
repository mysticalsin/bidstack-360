/**
 * opsRouteElements — automation, settings, and integration route definitions.
 *
 * WHY a function: same reasoning as BidRoutes — React Router v6 traverses JSX
 * children statically; a plain function call lets the framework see Route
 * elements that would otherwise be hidden inside a component boundary.
 */
import { Route } from 'react-router-dom';

import {
  IntegrationsPage,
  SettingsPage,
  WebhooksPage,
  WorkflowsPage,
} from './lazyPages';
import { RequireAuth } from './AuthGuards';

export function opsRouteElements() {
  return (
    <>
      <Route
        path="/workflows"
        element={
          <RequireAuth>
            <WorkflowsPage />
          </RequireAuth>
        }
      />
      <Route
        path="/settings"
        element={
          <RequireAuth>
            <SettingsPage />
          </RequireAuth>
        }
      />
      <Route
        path="/integrations"
        element={
          <RequireAuth>
            <IntegrationsPage />
          </RequireAuth>
        }
      />
      <Route
        path="/webhooks"
        element={
          <RequireAuth>
            <WebhooksPage />
          </RequireAuth>
        }
      />
    </>
  );
}
