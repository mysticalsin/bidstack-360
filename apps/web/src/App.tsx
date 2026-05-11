import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth, SignIn } from '@clerk/clerk-react';

import { CommandPalette } from '@/components/command/CommandPalette';
import { AppShell } from '@/components/layout/AppShell';
import { LoadingSkeleton } from '@/components/ui/StateMessages';
import { useCommandPalette } from '@/hooks/useCommandPalette';

const DashboardPage = lazy(() =>
  import('@/pages/DashboardPage').then((m) => ({ default: m.DashboardPage })),
);
const OpportunitiesPage = lazy(() =>
  import('@/pages/OpportunitiesPage').then((m) => ({ default: m.OpportunitiesPage })),
);
const OpportunityDetailPage = lazy(() =>
  import('@/pages/OpportunityDetailPage').then((m) => ({
    default: m.OpportunityDetailPage,
  })),
);
const PipelinePage = lazy(() =>
  import('@/pages/PipelinePage').then((m) => ({ default: m.PipelinePage })),
);
const ContactsPage = lazy(() =>
  import('@/pages/ContactsPage').then((m) => ({ default: m.ContactsPage })),
);
const TasksPage = lazy(() => import('@/pages/TasksPage').then((m) => ({ default: m.TasksPage })));
const ReportsPage = lazy(() =>
  import('@/pages/ReportsPage').then((m) => ({ default: m.ReportsPage })),
);
const IntegrationsPage = lazy(() =>
  import('@/pages/IntegrationsPage').then((m) => ({ default: m.IntegrationsPage })),
);
const SettingsPage = lazy(() =>
  import('@/pages/SettingsPage').then((m) => ({ default: m.SettingsPage })),
);

function RequireAuth({ children }: { children: React.ReactNode }) {
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

function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--surface-bg)]">
      <SignIn routing="path" path="/login" signUpUrl="/login" afterSignInUrl="/dashboard" />
    </div>
  );
}

export function App() {
  const palette = useCommandPalette();
  return (
    <AppShell>
      <Suspense fallback={<LoadingSkeleton rows={6} />}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route
            path="/dashboard"
            element={
              <RequireAuth>
                <DashboardPage />
              </RequireAuth>
            }
          />
          <Route
            path="/opportunities"
            element={
              <RequireAuth>
                <OpportunitiesPage />
              </RequireAuth>
            }
          />
          <Route
            path="/opportunities/:id"
            element={
              <RequireAuth>
                <OpportunityDetailPage />
              </RequireAuth>
            }
          />
          <Route
            path="/pipeline"
            element={
              <RequireAuth>
                <PipelinePage />
              </RequireAuth>
            }
          />
          <Route
            path="/contacts"
            element={
              <RequireAuth>
                <ContactsPage />
              </RequireAuth>
            }
          />
          <Route
            path="/tasks"
            element={
              <RequireAuth>
                <TasksPage />
              </RequireAuth>
            }
          />
          <Route
            path="/reports"
            element={
              <RequireAuth>
                <ReportsPage />
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
            path="/settings"
            element={
              <RequireAuth>
                <SettingsPage />
              </RequireAuth>
            }
          />
        </Routes>
      </Suspense>
      <CommandPalette open={palette.open} onOpenChange={palette.setOpen} />
    </AppShell>
  );
}
