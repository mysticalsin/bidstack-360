import { AnimatePresence, MotionConfig } from 'framer-motion';
import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';

import { useAuth } from '@/lib/auth';
import { CommandPalette } from '@/components/command/CommandPalette';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { LiveAnnouncer } from '@/components/a11y/LiveAnnouncer';
import { ConfettiHost } from '@/components/delight/Confetti';
import { WebVitalsHud } from '@/components/dev/WebVitalsHud';
import { HelpDrawer } from '@/components/help/HelpDrawer';
import { useHelpDrawerHotkey } from '@/components/help/useHelpDrawer';
import { AppShell } from '@/components/layout/AppShell';
import { RouteProgress } from '@/components/layout/RouteProgress';
import { PageTransition } from '@/components/motion/PageTransition';
import { QuickAddMenu } from '@/components/quickadd/QuickAddMenu';
import { ConfirmHost } from '@/components/ui/ConfirmDialog';
import { LoadingSkeleton } from '@/components/ui/StateMessages';
import { Toaster } from '@/components/ui/Toast';
import { useCmdDotClose } from '@/hooks/useCmdDotClose';
import { useCommandPalette } from '@/hooks/useCommandPalette';
import { useGlobalShortcuts } from '@/hooks/useGlobalShortcuts';
import { usePreferences } from '@/stores/preferences';
import { useGlobalUndoHotkey } from '@/stores/undoStack';

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
const AuditLogPage = lazy(() =>
  import('@/pages/AuditLogPage').then((m) => ({ default: m.AuditLogPage })),
);
const AccountsPage = lazy(() =>
  import('@/pages/AccountsPage').then((m) => ({ default: m.AccountsPage })),
);
const SalesDashboardPage = lazy(() =>
  import('@/pages/SalesDashboardPage').then((m) => ({ default: m.SalesDashboardPage })),
);
const SalesOrdersPage = lazy(() =>
  import('@/pages/SalesOrdersPage').then((m) => ({ default: m.SalesOrdersPage })),
);
const SalesOrderDetailPage = lazy(() =>
  import('@/pages/SalesOrderDetailPage').then((m) => ({ default: m.SalesOrderDetailPage })),
);
const BidNoBidPage = lazy(() =>
  import('@/pages/BidNoBidPage').then((m) => ({ default: m.BidNoBidPage })),
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
  const clerkKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

  // Stub mode: auto-redirect to dashboard (no login UI needed)
  if (!clerkKey) {
    return <Navigate to="/dashboard" replace />;
  }

  // Real Clerk mode: render SignIn component
  // We dynamically import Clerk's SignIn to avoid bundling it in stub mode
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--surface-bg)]">
      <ClerkSignIn />
    </div>
  );
}

// Lazy-load Clerk's SignIn so stub builds put it in its own chunk that's
// only fetched when a real publishable key is present.
const ClerkSignIn = lazy(() =>
  import('@clerk/clerk-react').then((m) => ({
    default: () => (
      <m.SignIn routing="path" path="/login" signUpUrl="/login" afterSignInUrl="/dashboard" />
    ),
  })),
);

function AnimatedRoutes() {
  const location = useLocation();
  // AnimatePresence drives an exit animation when routes swap. We key on the
  // top-level segment so navigating between accounts (same segment) doesn't
  // re-run the cross-fade — only true page swaps animate.
  const segmentKey = '/' + (location.pathname.split('/')[1] ?? '');
  return (
    <AnimatePresence mode="wait" initial={false}>
      <PageTransition pageKey={segmentKey || '/'}>
        <Routes location={location}>
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
            path="/accounts"
            element={
              <RequireAuth>
                <AccountsPage />
              </RequireAuth>
            }
          />
          <Route
            path="/accounts/:accountId"
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
            path="/sales"
            element={
              <RequireAuth>
                <SalesDashboardPage />
              </RequireAuth>
            }
          />
          <Route
            path="/sales/orders"
            element={
              <RequireAuth>
                <SalesOrdersPage />
              </RequireAuth>
            }
          />
          <Route
            path="/sales/orders/:id"
            element={
              <RequireAuth>
                <SalesOrderDetailPage />
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
          <Route
            path="/audit-log"
            element={
              <RequireAuth>
                <AuditLogPage />
              </RequireAuth>
            }
          />
          <Route
            path="/bid-matrix"
            element={
              <RequireAuth>
                <BidNoBidPage />
              </RequireAuth>
            }
          />
        </Routes>
      </PageTransition>
    </AnimatePresence>
  );
}

export function App() {
  const palette = useCommandPalette();
  useHelpDrawerHotkey();
  useCmdDotClose();
  useGlobalShortcuts();
  useGlobalUndoHotkey();
  // Map our 3-way motion pref onto framer-motion's MotionConfig contract.
  // `system` is framer's `user` (read prefers-reduced-motion). `reduced`
  // forces `always`, overriding the OS. `full` forces `never`. This makes
  // the toggle in Settings authoritative.
  const motion = usePreferences((s) => s.motion);
  const reducedMotion = motion === 'reduced' ? 'always' : motion === 'full' ? 'never' : 'user';
  return (
    <MotionConfig reducedMotion={reducedMotion}>
      <RouteProgress />
      <AppShell>
        {/* ErrorBoundary scoped inside AppShell so a render error in any page
            falls back to the boundary card while the sidebar/topbar survive.
            Mounting at the route level (vs. global at main.tsx) preserves the
            shell so users can still navigate away from the broken page. */}
        <ErrorBoundary>
          <Suspense fallback={<LoadingSkeleton rows={6} />}>
            <AnimatedRoutes />
          </Suspense>
        </ErrorBoundary>
        <CommandPalette open={palette.open} onOpenChange={palette.setOpen} />
        {/* Press N (outside an input) → quick-add menu → choose entity. */}
        <QuickAddMenu />
        {/* `?` (outside an input) → keyboard shortcut drawer. */}
        <HelpDrawer />
        {/* Global hosts — mount once at the root so any component can dispatch
            toasts / open a confirm without prop-drilling. */}
        <Toaster />
        <ConfirmHost />
        <ConfettiHost />
        <LiveAnnouncer />
        <WebVitalsHud />
      </AppShell>
    </MotionConfig>
  );
}
