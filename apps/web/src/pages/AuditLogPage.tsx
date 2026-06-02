import { Navigate } from 'react-router-dom';

export function AuditLogPage() {
  return <Navigate to="/settings?tab=audit-log" replace />;
}
