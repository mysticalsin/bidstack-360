import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { SettingsLayout, type SettingsSection } from '@/components/settings/SettingsLayout';
import { SettingsOverviewSection } from '@/components/settings/SettingsOverviewSection';
import { ProfileSection } from '@/components/settings/ProfileSection';
import { AppearanceSection } from '@/components/settings/AppearanceSection';
import { NotificationPrefsSection } from '@/components/settings/NotificationPrefsSection';
import { SecuritySection } from '@/components/settings/SecuritySection';
import { WorkspaceSection } from '@/components/settings/WorkspaceSection';
import { CrmConfigurationSection } from '@/components/settings/CrmConfigurationSection';
import { DataImportSection } from '@/components/settings/DataImportSection';
import { TopAccountsSection } from '@/components/settings/TopAccountsSection';
import { DeveloperAccessSection } from '@/components/settings/DeveloperAccessSection';
import { LanguageSwitcher } from '@/components/settings/LanguageSwitcher';
import { IntegrationsSection } from '@/components/settings/IntegrationsSection';
import { WebhooksSection } from '@/components/settings/WebhooksSection';
import { AuditLogSection } from '@/components/settings/AuditLogSection';
import { RfpAnalyticsSection } from '@/components/settings/RfpAnalyticsSection';
import { AccessGroupsSection } from '@/components/settings/AccessGroupsSection';
import { OpportunityFiltersSection } from '@/components/settings/OpportunityFiltersSection';
import { SerumControlPlaneSection } from '@/components/settings/SerumControlPlaneSection';
import { ModulesSection } from '@/components/settings/ModulesSection';
import { useIsAdmin } from '@/lib/auth';

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

  const sections: Record<SettingsSection, React.ReactNode> = {
    overview: <SettingsOverviewSection onNavigate={setActive} />,
    serum: <SerumControlPlaneSection />,
    // Profile + Language no longer have their own tabs; they fold into
    // Security and Appearance. The standalone keys stay so deep links still
    // resolve.
    profile: <ProfileSection />,
    appearance: (
      <div className="space-y-6">
        <AppearanceSection />
        <LanguageSwitcher />
      </div>
    ),
    language: <LanguageSwitcher />,
    notifications: <NotificationPrefsSection />,
    security: (
      <div className="space-y-6">
        <ProfileSection />
        <SecuritySection />
      </div>
    ),
    workspace: <WorkspaceSection />,
    crm: <CrmConfigurationSection />,
    'data-import': <DataImportSection />,
    'top-accounts': <TopAccountsSection />,
    groups: <AccessGroupsSection />,
    'opportunity-filters': <OpportunityFiltersSection />,
    'rfp-analytics': <RfpAnalyticsSection />,
    modules: <ModulesSection />,
    integrations: <IntegrationsSection />,
    webhooks: <WebhooksSection />,
    'audit-log': <AuditLogSection />,
    developer: <DeveloperAccessSection />,
  };

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

      <SettingsLayout active={activeTab} onChange={setActive}>
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-[var(--fg-primary)]">
            {t(`settings.${SECTION_TITLES[activeTab][0]}`, SECTION_TITLES[activeTab][1])}
          </h2>
        </div>
        {sections[activeTab]}
      </SettingsLayout>
    </div>
  );
}
