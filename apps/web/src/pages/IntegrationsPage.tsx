import { Navigate } from 'react-router-dom';

export function IntegrationsPage() {
  return <Navigate to="/settings?tab=integrations" replace />;
}
