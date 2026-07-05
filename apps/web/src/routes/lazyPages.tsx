/**
 * lazyPages — all React.lazy() page imports in one place.
 *
 * WHY: AppRoutes.tsx would exceed 400 lines if every lazy() lived there.
 * Instead, each page is a named export here. Import only what you need.
 */
import { lazy } from 'react';

import { LoadingSkeleton } from '@/components/ui/StateMessages';

// ─── Core ─────────────────────────────────────────────────────────────────────

export const DashboardPage = lazy(() =>
  import('@/pages/DashboardPage').then((m) => ({ default: m.DashboardPage })),
);
export const LoginPage = lazy(() =>
  import('@/pages/LoginPage').then((m) => ({ default: m.LoginPage })),
);
export const QuickStartPage = lazy(() =>
  import('@/pages/QuickStartPage').then((m) => ({ default: m.QuickStartPage })),
);
export const SearchPage = lazy(() =>
  import('@/pages/SearchPage').then((m) => ({ default: m.SearchPage })),
);
export const SerumMissionControlPage = lazy(() =>
  import('@/pages/SerumMissionControlPage').then((m) => ({ default: m.SerumMissionControlPage })),
);

// ─── CRM ──────────────────────────────────────────────────────────────────────

export const AccountsPage = lazy(() =>
  import('@/pages/AccountsPage').then((m) => ({ default: m.AccountsPage })),
);
// KAM cockpit (default export)
export const KamAccountPage = lazy(() => import('@/pages/kam/KamAccountPage'));
// Collaborate (AppFlowy embed, default export)
export const WorkspacePage = lazy(() => import('@/pages/WorkspacePage'));
export const CompaniesPage = lazy(() =>
  import('@/pages/CompaniesPage').then((m) => ({ default: m.CompaniesPage })),
);
export const CompanyDetailPage = lazy(() =>
  import('@/pages/CompanyDetailPage').then((m) => ({ default: m.CompanyDetailPage })),
);
export const ContactsPage = lazy(() =>
  import('@/pages/ContactsPage').then((m) => ({ default: m.ContactsPage })),
);
export const ContactDetailPage = lazy(() =>
  import('@/pages/ContactDetailPage').then((m) => ({ default: m.ContactDetailPage })),
);
export const KeyAccountsPage = lazy(() =>
  import('@/pages/KeyAccountsPage').then((m) => ({ default: m.KeyAccountsPage })),
);
export const LeadsPage = lazy(() =>
  import('@/pages/LeadsPage').then((m) => ({ default: m.LeadsPage })),
);
export const LeadDetailPage = lazy(() =>
  import('@/pages/LeadDetailPage').then((m) => ({ default: m.LeadDetailPage })),
);
export const NewLeadPage = lazy(() =>
  import('@/pages/NewLeadPage').then((m) => ({ default: m.NewLeadPage })),
);
export const TopAccountsPage = lazy(() =>
  import('@/pages/TopAccountsPage').then((m) => ({ default: m.TopAccountsPage })),
);

// ─── Opportunities & Pipeline ─────────────────────────────────────────────────

export const OpportunitiesPage = lazy(() =>
  import('@/pages/OpportunitiesPage').then((m) => ({ default: m.OpportunitiesPage })),
);
export const OpportunityDetailPage = lazy(() =>
  import('@/pages/OpportunityDetailPage').then((m) => ({ default: m.OpportunityDetailPage })),
);
export const PipelinePage = lazy(() =>
  import('@/pages/PipelinePage').then((m) => ({ default: m.PipelinePage })),
);
export const ForecastsPage = lazy(() =>
  import('@/pages/ForecastsPage').then((m) => ({ default: m.ForecastsPage })),
);
// Default export — no .then() reshaping needed.
export const WinLossPage = lazy(() => import('@/pages/WinLossPage'));
export const SalesToolkitsPage = lazy(() => import('@/pages/SalesToolkitsPage'));
export const SectorViewPage = lazy(() => import('@/pages/SectorViewPage'));
export const CrossSellPage = lazy(() => import('@/pages/CrossSellPage'));
export const TerritoriesPage = lazy(() =>
  import('@/pages/TerritoriesPage').then((m) => ({ default: m.TerritoriesPage })),
);

// ─── Bid / RFP ────────────────────────────────────────────────────────────────

export const BidNoBidPage = lazy(() =>
  import('@/pages/BidNoBidPage').then((m) => ({ default: m.BidNoBidPage })),
);
export const IntakePage = lazy(() =>
  import('@/pages/IntakePage').then((m) => ({ default: m.IntakePage })),
);
export const ProposalDetailPage = lazy(() =>
  import('@/pages/ProposalDetailPage').then((m) => ({ default: m.ProposalDetailPage })),
);
export const ProposalsPage = lazy(() =>
  import('@/pages/ProposalsPage').then((m) => ({ default: m.ProposalsPage })),
);
export const ReferencesPage = lazy(() =>
  import('@/pages/ReferencesPage').then((m) => ({ default: m.ReferencesPage })),
);
export const RfpPipelinePage = lazy(() =>
  import('@/pages/RfpPipelinePage').then((m) => ({ default: m.RfpPipelinePage })),
);
export const AgentStudioPage = lazy(() =>
  import('@/pages/AgentStudioPage').then((m) => ({ default: m.AgentStudioPage })),
);

// ─── Tasks & Activities ───────────────────────────────────────────────────────

export const CalendarPage = lazy(() =>
  import('@/pages/CalendarPage').then((m) => ({ default: m.CalendarPage })),
);
// Default export — no .then() reshaping needed.
export const CallsPage = lazy(() => import('@/pages/CallsPage'));
export const TaskDetailPage = lazy(() =>
  import('@/pages/TaskDetailPage').then((m) => ({ default: m.TaskDetailPage })),
);
export const TasksPage = lazy(() =>
  import('@/pages/TasksPage').then((m) => ({ default: m.TasksPage })),
);
// Default export — no .then() reshaping needed.
export const WorkloadPage = lazy(() => import('@/pages/WorkloadPage'));

// ─── Reporting & Analytics ────────────────────────────────────────────────────

export const AnalyticsDashboardPage = lazy(() =>
  import('@/pages/AnalyticsDashboardPage').then((m) => ({
    default: m.AnalyticsDashboardPage,
  })),
);
export const DashboardsListPage = lazy(() =>
  import('@/pages/DashboardsListPage').then((m) => ({ default: m.DashboardsListPage })),
);
export const ReportsListPage = lazy(() =>
  import('@/pages/ReportsListPage').then((m) => ({ default: m.ReportsListPage })),
);
export const ReportBuilderPage = lazy(() =>
  import('@/pages/ReportBuilderPage').then((m) => ({ default: m.ReportBuilderPage })),
);

// ─── Service & Support ────────────────────────────────────────────────────────

export const ServiceCaseDetailPage = lazy(() =>
  import('@/pages/ServiceCaseDetailPage').then((m) => ({ default: m.ServiceCaseDetailPage })),
);
export const ServiceDeskPage = lazy(() =>
  import('@/pages/ServiceDeskPage').then((m) => ({ default: m.ServiceDeskPage })),
);

// ─── Admin & Settings ─────────────────────────────────────────────────────────

export const AdminRfpPage = lazy(() =>
  import('@/pages/AdminRfpPage').then((m) => ({ default: m.AdminRfpPage })),
);
export const AuditLogPage = lazy(() =>
  import('@/pages/AuditLogPage').then((m) => ({ default: m.AuditLogPage })),
);
export const CustomObjectDetailPage = lazy(() =>
  import('@/pages/CustomObjectDetailPage').then((m) => ({ default: m.CustomObjectDetailPage })),
);
export const CustomObjectEditorPage = lazy(() =>
  import('@/pages/CustomObjectEditorPage').then((m) => ({ default: m.CustomObjectEditorPage })),
);
export const CustomObjectListPage = lazy(() =>
  import('@/pages/CustomObjectListPage').then((m) => ({ default: m.CustomObjectListPage })),
);
export const CustomObjectsAdminPage = lazy(() =>
  import('@/pages/CustomObjectsAdminPage').then((m) => ({ default: m.CustomObjectsAdminPage })),
);
export const IntegrationsPage = lazy(() =>
  import('@/pages/IntegrationsPage').then((m) => ({ default: m.IntegrationsPage })),
);
// Default export — no .then() reshaping needed.
export const PredictiveAdminPage = lazy(() => import('@/pages/PredictiveAdminPage'));
export const RolesPage = lazy(() =>
  import('@/pages/RolesPage').then((m) => ({ default: m.RolesPage })),
);
export const SettingsPage = lazy(() =>
  import('@/pages/SettingsPage').then((m) => ({ default: m.SettingsPage })),
);
// Default export — no .then() reshaping needed.
export const WebhooksPage = lazy(() => import('@/pages/WebhooksPage'));
export const WorkflowsPage = lazy(() =>
  import('@/pages/WorkflowsPage').then((m) => ({ default: m.WorkflowsPage })),
);

// ─── E-signature public ───────────────────────────────────────────────────────
export const PublicSignPage = lazy(() =>
  import('@/pages/PublicSignPage').then((m) => ({ default: m.PublicSignPage })),
);
export const PublicBookingPage = lazy(() =>
  import('@/pages/PublicBookingPage').then((m) => ({ default: m.PublicBookingPage })),
);

// ─── Auth callbacks ───────────────────────────────────────────────────────────

// Inline loading wrapper — Clerk's callback page has no standalone route file.
export const SsoCallbackPage = lazy(() =>
  import('@clerk/clerk-react').then((m) => ({
    default: () => (
      <div className="flex h-screen items-center justify-center">
        <LoadingSkeleton rows={2} />
        <m.AuthenticateWithRedirectCallback />
      </div>
    ),
  })),
);
