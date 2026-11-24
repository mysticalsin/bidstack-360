import { lazy, Suspense, useEffect, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { SettingsLayout, type SettingsSection } from '@/components/settings/SettingsLayout';
import { LoadingSkeleton } from '@/components/ui/StateMessages';
import { useIsAdmin } from '@/lib/auth';

// Each settings panel is its own chunk. Importing them all into this page
// put SERUM, webhooks, and the audit log in one ~320KB file, over the 200KB
// app-chunk budget. Only the active tab's loader runs.
const SettingsOverviewSection = lazy(() =>
  import('@/components/settings/SettingsOverviewSection').then((m) => ({
    default: m.SettingsOverviewSection,
  })),
);
const ProfileSection = lazy(() =>
  import('@/components/settings/ProfileSection').then((m) => ({ default: m.ProfileSection })),
);
const AppearanceSection = lazy(() =>
  import('@/components/settings/AppearanceSection').then((m) => ({
    default: m.AppearanceSection,
  })),
);
const NotificationPrefsSection = lazy(() =>
  import('@/components/settings/NotificationPrefsSection').then((m) => ({
    default: m.NotificationPrefsSection,
  })),
);
const SecuritySection = lazy(() =>
  import('@/components/settings/SecuritySection').then((m) => ({ default: m.SecuritySection })),
);
const WorkspaceSection = lazy(() =>
  import('@/components/settings/WorkspaceSection').then((m) => ({ default: m.WorkspaceSection })),
);
const CrmConfigurationSection = lazy(() =>
  import('@/components/settings/CrmConfigurationSection').then((m) => ({
    default: m.CrmConfigurationSection,
  })),
);
const DataImportSection = lazy(() =>
  import('@/components/settings/DataImportSection').then((m) => ({
    default: m.DataImportSection,
  })),
);
const TopAccountsSection = lazy(() =>
  import('@/components/settings/TopAccountsSection').then((m) => ({
    default: m.TopAccountsSection,
  })),
);
const DeveloperAccessSection = lazy(() =>
  import('@/components/settings/DeveloperAccessSection').then((m) => ({
    default: m.DeveloperAccessSection,
  })),
);
const LanguageSwitcher = lazy(() =>
  import('@/components/settings/LanguageSwitcher').then((m) => ({ default: m.LanguageSwitcher })),
);
const IntegrationsSection = lazy(() =>
  import('@/components/settings/IntegrationsSection').then((m) => ({
    default: m.IntegrationsSection,
  })),
);
const WebhooksSection = lazy(() =>
  import('@/components/settings/WebhooksSection').then((m) => ({ default: m.WebhooksSection })),
);
const AuditLogSection = lazy(() =>
  import('@/components/settings/AuditLogSection').then((m) => ({ default: m.AuditLogSection })),
);
const RfpAnalyticsSection = lazy(() =>
  import('@/components/settings/RfpAnalyticsSection').then((m) => ({
    default: m.RfpAnalyticsSection,
  })),
);
const AccessGroupsSection = lazy(() =>
  import('@/components/settings/AccessGroupsSection').then((m) => ({
    default: m.AccessGroupsSection,
  })),
);
const OpportunityFiltersSection = lazy(() =>
  import('@/components/settings/OpportunityFiltersSection').then((m) => ({
    default: m.OpportunityFiltersSection,
  })),
);
const SerumControlPlaneSection = lazy(() =>
  import('@/components/settings/SerumControlPlaneSection').then((m) => ({
    default: m.SerumControlPlaneSection,
  })),
);
const ModulesSection = lazy(() =>
  import('@/components/settings/ModulesSection').then((m) => ({ default: m.ModulesSection })),
);

// Each entry maps a section code to its [i18n key suffix, English default].
// The English default is passed to t() so the UI never shows a raw key.
const SECTION_TITLES: Record<SettingsSection, [string, string]> = {
  overview: ['sectionOverview', 'Overview'],
  serum: ['sectionSerum', 'SERUM Control Plane'],
  profile: ['sectionProfile', 'Profile'],
  appearance: ['sectionAppearance', 'Appearance & Language'],
  language: ['sectionLanguage', 'Language'],
  notifications: ['sectionNotifications', 'Notifications'],
  security: ['sectionSecurity', 'Profile & Security'],
  workspace: ['sectionWorkspace', 'Workspace'],
  crm: ['sectionCrm', 'Data configuration'],
  'data-import': ['sectionDataImport', 'Data import'],
  'top-accounts': ['sectionTopAccounts', 'Top accounts'],
  groups: ['sectionGroups', 'Access groups'],
  'opportunity-filters': ['sectionOpportunityFilters', 'Opportunity filters'],
  'rfp-analytics': ['sectionRfpAnalytics', 'RFP Analytics'],
  modules: ['sectionModules', 'Modules'],
  integrations: ['sectionIntegrations', 'Integrations'],
  webhooks: ['sectionWebhooks', 'Webhooks'],
  'audit-log': ['sectionAuditLog', 'Audit log'],
  developer: ['sectionDeveloper', 'Developer access'],
};

const SETTINGS_SECTIONS = new Set<SettingsSection>(
  Object.keys(SECTION_TITLES) as SettingsSection[],
);

const ADMIN_SETTINGS_SECTIONS = new Set<SettingsSection>([
  'serum',
  'crm',
  'data-import',
  'top-accounts',
  'groups',
  'opportunity-filters',
  'rfp-analytics',
  'modules',
  'webhooks',
  'audit-log',
  'developer',
]);

function resolveSettingsTab(tab: string | null, isAdmin: boolean): SettingsSection {
  const candidate =
    tab && SETTINGS_SECTIONS.has(tab as SettingsSection) ? (tab as SettingsSection) : 'overview';
  if (!isAdmin && ADMIN_SETTINGS_SECTIONS.has(candidate)) return 'overview';
  return candidate;
}

export function SettingsPage() {
  const { t } = useTranslation('crm');
  const [searchParams, setSearchParams] = useSearchParams();
  const isAdmin = useIsAdmin();
  const requestedTab = searchParams.get('tab');
  const activeTab = resolveSettingsTab(requestedTab, isAdmin);

  useEffect(() => {
    if (requestedTab && requestedTab !== activeTab) {
      setSearchParams({ tab: activeTab }, { replace: true });
    }
  }, [activeTab, requestedTab, setSearchParams]);

  const setActive = (tab: SettingsSection) => {
    setSearchParams({ tab });
  };

  // Build only the active panel. A map of elements would call every lazy
  // loader on first paint and pull every section back into the page.
  const section = ((): ReactNode => {
    switch (activeTab) {
      case 'overview':
        return <SettingsOverviewSection onNavigate={setActive} />;
      case 'serum':
        return <SerumControlPlaneSection />;
      // Profile + Language no longer have their own tabs; they fold into
      // Security and Appearance. The standalone keys stay so deep links still
      // resolve.
      case 'profile':
        return <ProfileSection />;
      case 'appearance':
        return (
          <div className="space-y-6">
            <AppearanceSection />
            <LanguageSwitcher />
          </div>
        );
      case 'language':
        return <LanguageSwitcher />;
      case 'notifications':
        return <NotificationPrefsSection />;
      case 'security':
        return (
          <div className="space-y-6">
            <ProfileSection />
            <SecuritySection />
          </div>
        );
      case 'workspace':
        return <WorkspaceSection />;
      case 'crm':
        return <CrmConfigurationSection />;
      case 'data-import':
        return <DataImportSection />;
      case 'top-accounts':
        return <TopAccountsSection />;
      case 'groups':
        return <AccessGroupsSection />;
      case 'opportunity-filters':
        return <OpportunityFiltersSection />;
      case 'rfp-analytics':
        return <RfpAnalyticsSection />;
      case 'modules':
        return <ModulesSection />;
      case 'integrations':
        return <IntegrationsSection />;
      case 'webhooks':
        return <WebhooksSection />;
      case 'audit-log':
        return <AuditLogSection />;
      case 'developer':
        return <DeveloperAccessSection />;
    }
  })();

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-[var(--fg-primary)] tracking-tight">
          {t('settings.pageTitle', 'Settings')}
        </h1>
        <p className="mt-1 text-sm text-[var(--fg-secondary)]">
          {t(
            'settings.pageSubtitle',
            'Manage your account, workspace controls, data model, and developer access.',
          )}
        </p>
      </header>

      <SettingsLayout active={activeTab}>
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-[var(--fg-primary)]">
            {t(`settings.${SECTION_TITLES[activeTab][0]}`, SECTION_TITLES[activeTab][1])}
          </h2>
        </div>
        <Suspense fallback={<LoadingSkeleton rows={4} />}>{section}</Suspense>
      </SettingsLayout>
    </div>
  );
}
