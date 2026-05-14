import { AnimatePresence, MotionConfig } from 'framer-motion';
import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';

import { useAuth, useIsAdmin } from '@/lib/auth';
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
const ContactDetailPage = lazy(() =>
  import('@/pages/ContactDetailPage').then((m) => ({ default: m.ContactDetailPage })),
);
const TasksPage = lazy(() => import('@/pages/TasksPage').then((m) => ({ default: m.TasksPage })));
const TaskDetailPage = lazy(() =>
  import('@/pages/TaskDetailPage').then((m) => ({ default: m.TaskDetailPage })),
);
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
const IntakePage = lazy(() =>
  import('@/pages/IntakePage').then((m) => ({ default: m.IntakePage })),
);
const AccountsPage = lazy(() =>
  import('@/pages/AccountsPage').then((m) => ({ default: m.AccountsPage })),
);
const CompaniesPage = lazy(() =>
  import('@/pages/CompaniesPage').then((m) => ({ default: m.CompaniesPage })),
);
const CompanyDetailPage = lazy(() =>
  import('@/pages/CompanyDetailPage').then((m) => ({ default: m.CompanyDetailPage })),
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
const InvoicesPage = lazy(() =>
  import('@/pages/InvoicesPage').then((m) => ({ default: m.InvoicesPage })),
);
const ProductsPage = lazy(() =>
  import('@/pages/ProductsPage').then((m) => ({ default: m.ProductsPage })),
);
const InvoiceDetailPage = lazy(() =>
  import('@/pages/InvoiceDetailPage').then((m) => ({ default: m.InvoiceDetailPage })),
);
const NewInvoicePage = lazy(() =>
  import('@/pages/NewInvoicePage').then((m) => ({ default: m.NewInvoicePage })),
);
const BidNoBidPage = lazy(() =>
  import('@/pages/BidNoBidPage').then((m) => ({ default: m.BidNoBidPage })),
);
const SearchPage = lazy(() =>
  import('@/pages/SearchPage').then((m) => ({ default: m.SearchPage })),
);
const LeadsPage = lazy(() => import('@/pages/LeadsPage').then((m) => ({ default: m.LeadsPage })));
const LeadDetailPage = lazy(() =>
  import('@/pages/LeadDetailPage').then((m) => ({ default: m.LeadDetailPage })),
);
const NewLeadPage = lazy(() =>
  import('@/pages/NewLeadPage').then((m) => ({ default: m.NewLeadPage })),
);
const ServiceDeskPage = lazy(() =>
  import('@/pages/ServiceDeskPage').then((m) => ({ default: m.ServiceDeskPage })),
);
const ServiceCaseDetailPage = lazy(() =>
  import('@/pages/ServiceCaseDetailPage').then((m) => ({ default: m.ServiceCaseDetailPage })),
);
const WorkflowsPage = lazy(() =>
  import('@/pages/WorkflowsPage').then((m) => ({ default: m.WorkflowsPage })),
);
const TerritoriesPage = lazy(() =>
  import('@/pages/TerritoriesPage').then((m) => ({ default: m.TerritoriesPage })),
);

const SsoCallbackPage = lazy(() =>
  import('@clerk/clerk-react').then((m) => ({
    default: () => (
      <div className="flex h-screen items-center justify-center">
        <LoadingSkeleton rows={2} />
        <m.AuthenticateWithRedirectCallback />
      </div>
    ),
  })),
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

function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { isLoaded, isSignedIn } = useAuth();
  const isAdmin = useIsAdmin();
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
  if (!isAdmin) {
    return <Navigate to="/dashboard" replace />;
  }
  return <>{children}</>;
}

function LoginPage() {
  const clerkKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
  const microsoftEnabled = import.meta.env.VITE_SSO_MICROSOFT_ENABLED === 'true';
  const microsoftLabel = import.meta.env.VITE_SSO_MICROSOFT_LABEL ?? 'Sign in with Microsoft';

  // Stub mode: auto-redirect to dashboard (no login UI needed)
  if (!clerkKey) {
    return <Navigate to="/dashboard" replace />;
  }

  // Real Clerk mode: render branded login with Microsoft SSO
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--surface-bg)]">
      <div className="w-full max-w-sm space-y-6 rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-card)] p-8 shadow-[var(--shadow-md)]">
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--brand-primary)] text-lg font-bold text-white">
            B
          </div>
          <h1 className="text-xl font-semibold text-[var(--fg-primary)]">BidStack 360°</h1>
          <p className="mt-1 text-sm text-[var(--fg-secondary)]">Mantu · Bid &amp; presales CRM</p>
        </div>

        {microsoftEnabled ? <MicrosoftSignInButton label={microsoftLabel} /> : null}

        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-[var(--border-subtle)]" />
          </div>
          <div className="relative flex justify-center text-xs">
            <span className="bg-[var(--surface-card)] px-2 text-[var(--fg-tertiary)]">
              {microsoftEnabled ? 'or continue with email' : 'Sign in to continue'}
            </span>
          </div>
        </div>

        <ClerkSignIn />
      </div>
    </div>
  );
}

// Lazy-load Clerk's SignIn so stub builds put it in its own chunk that's
// only fetched when a real publishable key is present.
const ClerkSignIn = lazy(() =>
  import('@clerk/clerk-react').then((m) => ({
    default: () => (
      <m.SignIn
        routing="path"
        path="/login"
        signUpUrl="/login"
        afterSignInUrl="/dashboard"
        appearance={{
          elements: {
            rootBox: 'w-full',
            card: 'shadow-none bg-transparent p-0',
            headerTitle: 'hidden',
            headerSubtitle: 'hidden',
            socialButtonsBlockButton: 'hidden',
            dividerRow: 'hidden',
            formButtonPrimary:
              'bg-[var(--brand-primary)] hover:bg-[var(--brand-primary-hover)] text-white rounded-lg h-10 text-sm font-medium',
            formFieldInput:
              'bg-[var(--surface-sunken)] border-[var(--border-subtle)] rounded-lg h-10 text-sm text-[var(--fg-primary)]',
            formFieldLabel: 'text-xs text-[var(--fg-secondary)]',
            footerActionLink: 'text-[var(--brand-primary)] text-sm',
            identityPreviewText: 'text-sm text-[var(--fg-primary)]',
            identityPreviewEditButton: 'text-[var(--brand-primary)]',
          },
        }}
      />
    ),
  })),
);

// Microsoft SSO button — uses Clerk's OAuth flow for Microsoft.
const MicrosoftSignInButton = lazy(() =>
  import('@clerk/clerk-react').then((m) => ({
    default: ({ label }: { label: string }) => {
      const { signIn, isLoaded } = m.useSignIn();
      if (!isLoaded) return null;
      return (
        <button
          type="button"
          onClick={() => {
            void signIn?.authenticateWithRedirect({
              strategy: 'oauth_microsoft',
              redirectUrl: '/sso-callback',
              redirectUrlComplete: '/dashboard',
            });
          }}
          className="flex w-full items-center justify-center gap-2.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-4 py-2.5 text-sm font-medium text-[var(--fg-primary)] transition-colors hover:bg-[var(--surface-hover)]"
        >
          <MicrosoftLogo />
          {label}
        </button>
      );
    },
  })),
);

function MicrosoftLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 21 21" aria-hidden>
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  );
}

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
            path="/companies"
            element={
              <RequireAuth>
                <CompaniesPage />
              </RequireAuth>
            }
          />
          <Route
            path="/companies/:id"
            element={
              <RequireAuth>
                <CompanyDetailPage />
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
            path="/contacts/:id"
            element={
              <RequireAuth>
                <ContactDetailPage />
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
            path="/tasks/:id"
            element={
              <RequireAuth>
                <TaskDetailPage />
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
            path="/sales/invoices"
            element={
              <RequireAuth>
                <InvoicesPage />
              </RequireAuth>
            }
          />
          <Route
            path="/sales/products"
            element={
              <RequireAuth>
                <ProductsPage />
              </RequireAuth>
            }
          />
          <Route
            path="/sales/invoices/:id"
            element={
              <RequireAuth>
                <InvoiceDetailPage />
              </RequireAuth>
            }
          />
          <Route
            path="/sales/invoices/new"
            element={
              <RequireAuth>
                <NewInvoicePage />
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
              <RequireAdmin>
                <AuditLogPage />
              </RequireAdmin>
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
          <Route
            path="/search"
            element={
              <RequireAuth>
                <SearchPage />
              </RequireAuth>
            }
          />
          <Route
            path="/leads"
            element={
              <RequireAuth>
                <LeadsPage />
              </RequireAuth>
            }
          />
          <Route
            path="/leads/new"
            element={
              <RequireAuth>
                <NewLeadPage />
              </RequireAuth>
            }
          />
          <Route
            path="/leads/:id"
            element={
              <RequireAuth>
                <LeadDetailPage />
              </RequireAuth>
            }
          />
          <Route
            path="/service-desk"
            element={
              <RequireAuth>
                <ServiceDeskPage />
              </RequireAuth>
            }
          />
          <Route
            path="/service-desk/:id"
            element={
              <RequireAuth>
                <ServiceCaseDetailPage />
              </RequireAuth>
            }
          />
          <Route
            path="/workflows"
            element={
              <RequireAuth>
                <WorkflowsPage />
              </RequireAuth>
            }
          />
          <Route
            path="/territories"
            element={
              <RequireAuth>
                <TerritoriesPage />
              </RequireAuth>
            }
          />
          <Route
            path="/intake"
            element={
              <RequireAuth>
                <IntakePage />
              </RequireAuth>
            }
          />
          <Route path="/sso-callback" element={<SsoCallbackPage />} />
          <Route
            path="*"
            element={
              <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
                <div className="text-4xl mb-4" aria-hidden>
                  🔭
                </div>
                <h1 className="text-lg font-semibold text-[var(--fg-primary)]">Page not found</h1>
                <p className="mt-1 text-sm text-[var(--fg-secondary)]">
                  The page you are looking for does not exist.
                </p>
                <a
                  href="/dashboard"
                  className="mt-4 inline-flex items-center justify-center rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-fg-on-brand transition-colors hover:bg-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
                >
                  Go to Dashboard
                </a>
              </div>
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
