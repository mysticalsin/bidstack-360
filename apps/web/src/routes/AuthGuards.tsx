/**
 * AuthGuards — route-level authentication and authorization guards.
 *
 * WHY separate from AppRoutes: keeps the guard logic independently readable
 * and testable, and is also re-exported from AppRoutes so callers that were
 * already importing from there don't need to update their import paths.
 */
import { Navigate } from 'react-router-dom';

import { useCapabilities } from '@/hooks/useCapabilities';
import { useAuth, useOrgAdminStatus } from '@/lib/auth';
import { LoadingSkeleton } from '@/components/ui/StateMessages';

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) {
    return (
      <div className="flex h-screen items-center justify-center">
        <LoadingSkeleton rows={3} />
      </div>
    );
  }
  if (!isSignedIn) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}

export function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { isLoaded, isSignedIn } = useAuth();
  const { isAdmin, isLoading } = useOrgAdminStatus();
  if (!isLoaded || (isSignedIn && isLoading)) {
    return (
      <div className="flex h-screen items-center justify-center">
        <LoadingSkeleton rows={3} />
      </div>
    );
  }
  if (!isSignedIn) {
    return <Navigate to="/login" replace />;
  }
  if (!isAdmin) {
    return <Navigate to="/dashboard" replace />;
  }
  return <>{children}</>;
}

/** /audit-log is for audit-log:read holders, not only settings:write admins. */
export function RequireAuditLogRead({ children }: { children: React.ReactNode }) {
  const { isLoaded, isSignedIn } = useAuth();
  const { isAdmin, isLoading: adminLoading } = useOrgAdminStatus();
  const caps = useCapabilities();
  const canRead = isAdmin || Boolean(caps.data?.permissions.includes('audit-log:read'));
  if (!isLoaded || (isSignedIn && (adminLoading || caps.isLoading))) {
    return (
      <div className="flex h-screen items-center justify-center">
        <LoadingSkeleton rows={3} />
      </div>
    );
  }
  if (!isSignedIn) {
    return <Navigate to="/login" replace />;
  }
  if (!canRead) {
    return <Navigate to="/dashboard" replace />;
  }
  return <>{children}</>;
}
