import { useSearchParams } from 'react-router-dom';
import { SettingsLayout, type SettingsSection } from '@/components/settings/SettingsLayout';
import { SettingsOverviewSection } from '@/components/settings/SettingsOverviewSection';
import { ProfileSection } from '@/components/settings/ProfileSection';
import { AppearanceSection } from '@/components/settings/AppearanceSection';
import { NotificationPrefsSection } from '@/components/settings/NotificationPrefsSection';
import { SecuritySection } from '@/components/settings/SecuritySection';
import { WorkspaceSection } from '@/components/settings/WorkspaceSection';
import { CrmConfigurationSection } from '@/components/settings/CrmConfigurationSection';
import { DeveloperAccessSection } from '@/components/settings/DeveloperAccessSection';
import { LanguageSwitcher } from '@/components/settings/LanguageSwitcher';
import { IntegrationsSection } from '@/components/settings/IntegrationsSection';
import { WebhooksSection } from '@/components/settings/WebhooksSection';
import { AuditLogSection } from '@/components/settings/AuditLogSection';
import { RfpAnalyticsSection } from '@/components/settings/RfpAnalyticsSection';

const SECTION_TITLES: Record<SettingsSection, string> = {
  overview: 'Overview',
  profile: 'Profile',
  appearance: 'Appearance',
  language: 'Language',
  notifications: 'Notifications',
  security: 'Security',
  workspace: 'Workspace',
  crm: 'CRM configuration',
  'rfp-analytics': 'RFP Analytics',
  integrations: 'Integrations',
  webhooks: 'Webhooks',
  'audit-log': 'Audit log',
  developer: 'Developer access',
};

export function SettingsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = (searchParams.get('tab') as SettingsSection) || 'overview';

  const setActive = (tab: SettingsSection) => {
    setSearchParams({ tab });
  };

  const sections: Record<SettingsSection, React.ReactNode> = {
    overview: <SettingsOverviewSection onNavigate={setActive} />,
    profile: <ProfileSection />,
    appearance: <AppearanceSection />,
    language: <LanguageSwitcher />,
    notifications: <NotificationPrefsSection />,
    security: <SecuritySection />,
    workspace: <WorkspaceSection />,
    crm: <CrmConfigurationSection />,
    'rfp-analytics': <RfpAnalyticsSection />,
    integrations: <IntegrationsSection />,
    webhooks: <WebhooksSection />,
    'audit-log': <AuditLogSection />,
    developer: <DeveloperAccessSection />,
  };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-[var(--fg-primary)] tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-[var(--fg-secondary)]">
          Manage your account, workspace controls, CRM data model, and developer access.
        </p>
      </header>

      <SettingsLayout active={activeTab} onChange={setActive}>
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-[var(--fg-primary)]">
            {SECTION_TITLES[activeTab]}
          </h2>
        </div>
        {sections[activeTab]}
      </SettingsLayout>
    </div>
  );
}
