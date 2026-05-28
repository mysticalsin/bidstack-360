/**
 * AppRoutes — all lazy page imports, auth guards, and the animated route tree.
 *
 * WHY separate from App.tsx: App.tsx was 803 lines, mixing global provider
 * setup with 60+ lazy() declarations. Splitting here keeps each file within
 * the 400-line limit and makes the route config independently readable.
 */
import { AnimatePresence } from 'framer-motion';
import { lazy } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';

import { useAuth, useIsAdmin } from '@/lib/auth';
import { PageTransition } from '@/components/motion/PageTransition';
import { LoadingSkeleton } from '@/components/ui/StateMessages';

// ─── Lazy page imports ────────────────────────────────────────────────────────

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
const CalendarPage = lazy(() =>
  import('@/pages/CalendarPage').then((m) => ({ default: m.CalendarPage })),
);
const CallsPage = lazy(() => import('@/pages/CallsPage'));
const AnalyticsDashboardPage = lazy(() =>
  import('@/pages/AnalyticsDashboardPage').then((m) => ({ default: m.AnalyticsDashboardPage })),
);
const DashboardsListPage = lazy(() =>
  import('@/pages/DashboardsListPage').then((m) => ({ default: m.DashboardsListPage })),
);
const CustomObjectListPage = lazy(() =>
  import('@/pages/CustomObjectListPage').then((m) => ({ default: m.CustomObjectListPage })),
);
const CustomObjectEditorPage = lazy(() =>
  import('@/pages/CustomObjectEditorPage').then((m) => ({ default: m.CustomObjectEditorPage })),
);
const CustomObjectDetailPage = lazy(() =>
  import('@/pages/CustomObjectDetailPage').then((m) => ({ default: m.CustomObjectDetailPage })),
);
const CustomObjectsAdminPage = lazy(() =>
  import('@/pages/CustomObjectsAdminPage').then((m) => ({ default: m.CustomObjectsAdminPage })),
);
const KeyAccountsPage = lazy(() =>
  import('@/pages/KeyAccountsPage').then((m) => ({ default: m.KeyAccountsPage })),
);
const PredictiveAdminPage = lazy(() => import('@/pages/PredictiveAdminPage'));
const ReferencesPage = lazy(() =>
  import('@/pages/ReferencesPage').then((m) => ({ default: m.ReferencesPage })),
);
const ReportsListPage = lazy(() =>
  import('@/pages/ReportsListPage').then((m) => ({ default: m.ReportsListPage })),
);
const RolesPage = lazy(() => import('@/pages/RolesPage').then((m) => ({ default: m.RolesPage })));
const TopAccountsPage = lazy(() =>
  import('@/pages/TopAccountsPage').then((m) => ({ default: m.TopAccountsPage })),
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

// ─── Auth guards ──────────────────────────────────────────────────────────────

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

// ─── Route tree ───────────────────────────────────────────────────────────────

export function AppRoutes() {
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
            path="/calendar"
            element={
              <RequireAuth>
                <CalendarPage />
              </RequireAuth>
            }
          />
          <Route
            path="/calls"
            element={
              <RequireAuth>
                <CallsPage />
              </RequireAuth>
            }
          />
          <Route
            path="/analytics"
            element={
              <RequireAuth>
                <AnalyticsDashboardPage />
              </RequireAuth>
            }
          />
          <Route
            path="/dashboards"
            element={
              <RequireAuth>
                <DashboardsListPage />
              </RequireAuth>
            }
          />
          <Route
            path="/custom-objects"
            element={
              <RequireAuth>
                <CustomObjectListPage />
              </RequireAuth>
            }
          />
          <Route
            path="/custom-objects/new"
            element={
              <RequireAuth>
                <CustomObjectEditorPage />
              </RequireAuth>
            }
          />
          <Route
            path="/custom-objects/:id"
            element={
              <RequireAuth>
                <CustomObjectDetailPage />
              </RequireAuth>
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
            path="/key-accounts"
            element={
              <RequireAuth>
                <KeyAccountsPage />
              </RequireAuth>
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
            path="/references"
            element={
              <RequireAuth>
                <ReferencesPage />
              </RequireAuth>
            }
          />
          <Route
            path="/reports/list"
            element={
              <RequireAuth>
                <ReportsListPage />
              </RequireAuth>
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
          <Route
            path="/top-accounts"
            element={
              <RequireAuth>
                <TopAccountsPage />
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
