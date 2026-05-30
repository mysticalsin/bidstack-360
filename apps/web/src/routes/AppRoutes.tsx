/**
 * AppRoutes — animated route tree.
 *
 * Lazy page imports → ./lazyPages
 * Auth guards       → ./AuthGuards  (also re-exported here for callers)
 * Bid/RFP routes    → ./BidRoutes
 * Sales routes      → ./SalesRoutes
 * Admin routes      → ./AdminRoutes
 */
import { AnimatePresence } from 'framer-motion';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';

import { PageTransition } from '@/components/motion/PageTransition';

import { adminRouteElements } from './AdminRoutes';
import { RequireAuth, RequireAdmin } from './AuthGuards';
import { bidRouteElements } from './BidRoutes';
import {
  AccountsPage,
  AgentStudioPage,
  AnalyticsDashboardPage,
  CalendarPage,
  CallsPage,
  CompaniesPage,
  CompanyDetailPage,
  ContactDetailPage,
  ContactsPage,
  CustomObjectDetailPage,
  CustomObjectEditorPage,
  CustomObjectListPage,
  DashboardPage,
  DashboardsListPage,
  ForecastsPage,
  KeyAccountsPage,
  LeadDetailPage,
  LeadsPage,
  LoginPage,
  NewLeadPage,
  OpportunitiesPage,
  OpportunityDetailPage,
  PipelinePage,
  QuickStartPage,
  ReportsListPage,
  ReportsPage,
  SearchPage,
  ServiceCaseDetailPage,
  ServiceDeskPage,
  SsoCallbackPage,
  TaskDetailPage,
  TasksPage,
  TerritoriesPage,
  TopAccountsPage,
  PublicSignPage,
} from './lazyPages';
import { opsRouteElements } from './OpsRoutes';
import { salesRouteElements } from './SalesRoutes';

// Re-export guards so callers that import from this module don't need to
// update their import paths when we moved the definitions to AuthGuards.tsx.
export { RequireAuth, RequireAdmin };

// ─── Route tree ───────────────────────────────────────────────────────────────

export function AppRoutes() {
  const location = useLocation();
  // Key on the top-level segment so sibling navigations (e.g. /accounts/1 →
  // /accounts/2) don't re-trigger the page cross-fade — only true page swaps
  // animate.
  const segmentKey = '/' + (location.pathname.split('/')[1] ?? '');
  return (
    <AnimatePresence mode="wait" initial={false}>
      <PageTransition pageKey={segmentKey || '/'}>
        <Routes location={location}>
          {/* ── Public ──────────────────────────────────────────────────── */}
          <Route path="/login" element={<LoginPage />} />
          <Route path="/sign/:token" element={<PublicSignPage />} />
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/sso-callback" element={<SsoCallbackPage />} />

          {/* ── Core ────────────────────────────────────────────────────── */}
          <Route
            path="/dashboard"
            element={
              <RequireAuth>
                <DashboardPage />
              </RequireAuth>
            }
          />
          <Route
            path="/quick-start"
            element={
              <RequireAuth>
                <QuickStartPage />
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
          {/* Agent Studio — open to members (run + view); authoring is admin-gated
              inside the page via useIsAdmin(). */}
          <Route
            path="/agent-studio"
            element={
              <RequireAuth>
                <AgentStudioPage />
              </RequireAuth>
            }
          />

          {/* ── CRM ─────────────────────────────────────────────────────── */}
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
            path="/key-accounts"
            element={
              <RequireAuth>
                <KeyAccountsPage />
              </RequireAuth>
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

          {/* ── Leads ───────────────────────────────────────────────────── */}
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

          {/* ── Opportunities & Pipeline ─────────────────────────────────── */}
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
            path="/forecasts"
            element={
              <RequireAuth>
                <ForecastsPage />
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

          {/* ── Tasks & Activities ───────────────────────────────────────── */}
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

          {/* ── Reporting & Analytics ────────────────────────────────────── */}
          <Route
            path="/reports"
            element={
              <RequireAuth>
                <ReportsPage />
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
          {/* New/Edit report routes point at the report workspace so the
              ReportsList "New report"/"Edit" actions and the Analytics
              "New report" link land on a real page instead of a 404.
              (A dedicated report editor is future work.) */}
          <Route
            path="/reports/new"
            element={
              <RequireAuth>
                <ReportsPage />
              </RequireAuth>
            }
          />
          <Route
            path="/reports/:id/edit"
            element={
              <RequireAuth>
                <ReportsPage />
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

          {/* ── Service & Support ────────────────────────────────────────── */}
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

          {/* ── Custom Objects ───────────────────────────────────────────── */}
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
          {/* Custom-object record browsing. The List/Detail pages read
              :objectKey (and :recordId) from the path; without these routes the
              "New <record>" button and every record link 404'd. */}
          <Route
            path="/o/:objectKey"
            element={
              <RequireAuth>
                <CustomObjectListPage />
              </RequireAuth>
            }
          />
          <Route
            path="/o/:objectKey/:recordId"
            element={
              <RequireAuth>
                <CustomObjectDetailPage />
              </RequireAuth>
            }
          />

          {/* ── Domain route groups ──────────────────────────────────────── */}
          {bidRouteElements()}
          {salesRouteElements()}
          {adminRouteElements()}
          {opsRouteElements()}

          {/* ── 404 ─────────────────────────────────────────────────────── */}
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
