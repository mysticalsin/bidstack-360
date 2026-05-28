import { AnimatePresence, MotionConfig } from 'framer-motion';
import { lazy, Suspense, useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';

import { useAuth, useIsAdmin, useUser } from '@/lib/auth';
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
import { useCockpitLayout } from '@/stores/cockpitLayout';
import { useGlobalUndoHotkey } from '@/stores/undoStack';
import { ProductTour } from '@/components/onboarding/ProductTour';
import { SampleDataBanner } from '@/components/onboarding/SampleDataBanner';
import { TemplatePicker } from '@/components/onboarding/TemplatePicker';

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
const AgentsPage = lazy(() =>
  import('@/pages/AgentsPage').then((m) => ({ default: m.AgentsPage })),
);
const RfpAgentsPage = lazy(() =>
  import('@/pages/RfpAgentsPage').then((m) => ({ default: m.RfpAgentsPage })),
);
// Wave 9 — RFP Pipeline
const RfpPipelinePage = lazy(() =>
  import('@/pages/RfpPipelinePage').then((m) => ({ default: m.RfpPipelinePage })),
);
const SettingsPage = lazy(() =>
  import('@/pages/SettingsPage').then((m) => ({ default: m.SettingsPage })),
);
const AuditLogPage = lazy(() =>
  import('@/pages/AuditLogPage').then((m) => ({ default: m.AuditLogPage })),
);
const WebhooksPage = lazy(() => import('@/pages/WebhooksPage'));
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
const NewSalesOrderPage = lazy(() =>
  import('@/pages/NewSalesOrderPage').then((m) => ({ default: m.NewSalesOrderPage })),
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
// Sprint 1 — RFP / Bid Response section
const RfpResponseHubPage = lazy(() =>
  import('@/pages/RfpResponseHubPage').then((m) => ({ default: m.RfpResponseHubPage })),
);
const ProposalsPage = lazy(() =>
  import('@/pages/ProposalsPage').then((m) => ({ default: m.ProposalsPage })),
);
const ProposalDetailPage = lazy(() =>
  import('@/pages/ProposalDetailPage').then((m) => ({ default: m.ProposalDetailPage })),
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
const ForecastsPage = lazy(() =>
  import('@/pages/ForecastsPage').then((m) => ({ default: m.ForecastsPage })),
);

const LoginPage = lazy(() => import('@/pages/LoginPage').then((m) => ({ default: m.LoginPage })));
const QuickStartPage = lazy(() =>
  import('@/pages/QuickStartPage').then((m) => ({ default: m.QuickStartPage })),
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
            path="/sales/orders/new"
            element={
              <RequireAuth>
                <NewSalesOrderPage />
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
            path="/agents"
            element={
              <RequireAuth>
                <AgentsPage />
              </RequireAuth>
            }
          />
          <Route
            path="/rfp/:id/agents"
            element={
              <RequireAuth>
                <RfpAgentsPage />
              </RequireAuth>
            }
          />
          {/* Wave 9 — RFP Pipeline */}
          <Route
            path="/rfp/:id/pipeline"
            element={
              <RequireAuth>
                <PageTransition>
                  <RfpPipelinePage />
                </PageTransition>
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
            path="/webhooks"
            element={
              <RequireAuth>
                <WebhooksPage />
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
          {/* Sprint 1 — RFP / Bid Response */}
          <Route
            path="/rfp-response"
            element={
              <RequireAuth>
                <RfpResponseHubPage />
              </RequireAuth>
            }
          />
          <Route
            path="/proposals"
            element={
              <RequireAuth>
                <ProposalsPage />
              </RequireAuth>
            }
          />
          <Route
            path="/proposals/:id"
            element={
              <RequireAuth>
                <ProposalDetailPage />
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
            path="/forecasts"
            element={
              <RequireAuth>
                <ForecastsPage />
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
            path="/quick-start"
            element={
              <RequireAuth>
                <QuickStartPage />
              </RequireAuth>
            }
          />
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
  const location = useLocation();
  const isLogin = location.pathname === '/login';

  const { user } = useUser();
  const scopePreferences = usePreferences((s) => s.scopeToUser);
  const scopeCockpitLayout = useCockpitLayout((s) => s.scopeToUser);

  useEffect(() => {
    const userId = user?.id ?? null;
    scopePreferences(userId);
    scopeCockpitLayout(userId);
  }, [user?.id, scopePreferences, scopeCockpitLayout]);
  // Map our 3-way motion pref onto framer-motion's MotionConfig contract.
  // `system` is framer's `user` (read prefers-reduced-motion). `reduced`
  // forces `always`, overriding the OS. `full` forces `never`. This makes
  // the toggle in Settings authoritative.
  const motion = usePreferences((s) => s.motion);
  const reducedMotion = motion === 'reduced' ? 'always' : motion === 'full' ? 'never' : 'user';
  return (
    <MotionConfig reducedMotion={reducedMotion}>
      <RouteProgress />
      {isLogin ? (
        <Suspense fallback={<LoadingSkeleton rows={6} />}>
          <LoginPage />
        </Suspense>
      ) : (
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
          {/* Onboarding — tour overlay, sample data banner, template picker */}
          <ProductTour />
          <SampleDataBanner />
          <TemplatePicker />
        </AppShell>
      )}
    </MotionConfig>
  );
}
