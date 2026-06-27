import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { Icon, type IconName } from '@/components/ui/Icon';
import { useIsAdmin } from '@/lib/auth';

export type SettingsSection =
  | 'overview'
  | 'serum'
  | 'profile'
  | 'appearance'
  | 'notifications'
  | 'security'
  | 'workspace'
  | 'language'
  | 'crm'
  | 'data-import'
  | 'top-accounts'
  | 'groups'
  | 'opportunity-filters'
  | 'rfp-analytics'
  | 'modules'
  | 'integrations'
  | 'webhooks'
  | 'audit-log'
  | 'developer';

interface Group {
  label: string;
  items: { id: SettingsSection; label: string; icon: IconName; admin?: boolean }[];
}

const GROUPS: Group[] = [
  {
    label: 'Command center',
    items: [
      { id: 'overview', label: 'Overview', icon: 'dashboard' },
      { id: 'serum', label: 'SERUM Control Plane', icon: 'sparkle', admin: true },
    ],
  },
  {
    // Profile folds into Security; Language folds into Appearance; fewer,
    // clearer personal tabs.
    label: 'Personal',
    items: [
      { id: 'appearance', label: 'Appearance & Language', icon: 'palette' },
      { id: 'notifications', label: 'Notifications', icon: 'bell' },
      { id: 'security', label: 'Profile & Security', icon: 'shield' },
    ],
  },
  {
    label: 'Workspace',
    items: [
      { id: 'workspace', label: 'Workspace', icon: 'settings' },
      { id: 'crm', label: 'Data configuration', icon: 'sliders', admin: true },
      { id: 'data-import', label: 'Data import', icon: 'upload', admin: true },
      { id: 'top-accounts', label: 'Top accounts', icon: 'star', admin: true },
      { id: 'groups', label: 'Access groups', icon: 'contacts', admin: true },
      { id: 'opportunity-filters', label: 'Opportunity filters', icon: 'sliders', admin: true },
      { id: 'rfp-analytics', label: 'RFP Analytics', icon: 'trophy', admin: true },
      { id: 'modules', label: 'Modules', icon: 'package', admin: true },
    ],
  },
  {
    // One home for the developer surfaces that were three separate doors.
    label: 'Developer tools',
    items: [
      { id: 'integrations', label: 'Integrations', icon: 'link' },
      { id: 'webhooks', label: 'Webhooks', icon: 'webhook', admin: true },
      { id: 'developer', label: 'Developer access', icon: 'zap', admin: true },
      { id: 'audit-log', label: 'Audit log', icon: 'shield', admin: true },
    ],
  },
];

interface Props {
  active: SettingsSection;
  onChange: (id: SettingsSection) => void;
  children: React.ReactNode;
}

export function SettingsLayout({ active, onChange, children }: Props) {
  const { t } = useTranslation('settings');
  const isAdmin = useIsAdmin();
  const [menuOpen, setMenuOpen] = useState(false);
  const navId = 'settings-section-nav';

  const groupLabel = (label: string): string => {
    switch (label) {
      case 'Command center':
        return t('settingsLayout.groupCommandCenter', 'Command center');
      case 'Personal':
        return t('settingsLayout.groupPersonal', 'Personal');
      case 'Workspace':
        return t('settingsLayout.groupWorkspace', 'Workspace');
      case 'Developer tools':
        return t('settingsLayout.groupDeveloperTools', 'Developer tools');
      default:
        return label;
    }
  };

  const itemLabel = (id: SettingsSection, label: string): string => {
    switch (id) {
      case 'overview':
        return t('settingsLayout.itemOverview', 'Overview');
      case 'serum':
        return t('settingsLayout.itemSerum', 'SERUM Control Plane');
      case 'appearance':
        return t('settingsLayout.itemAppearance', 'Appearance & Language');
      case 'notifications':
        return t('settingsLayout.itemNotifications', 'Notifications');
      case 'security':
        return t('settingsLayout.itemSecurity', 'Profile & Security');
      case 'workspace':
        return t('settingsLayout.itemWorkspace', 'Workspace');
      case 'crm':
        return t('settingsLayout.itemCrm', 'Data configuration');
      case 'data-import':
        return t('settingsLayout.itemDataImport', 'Data import');
      case 'top-accounts':
        return t('settingsLayout.itemTopAccounts', 'Top accounts');
      case 'groups':
        return t('settingsLayout.itemGroups', 'Access groups');
      case 'opportunity-filters':
        return t('settingsLayout.itemOpportunityFilters', 'Opportunity filters');
      case 'rfp-analytics':
        return t('settingsLayout.itemRfpAnalytics', 'RFP Analytics');
      case 'integrations':
        return t('settingsLayout.itemIntegrations', 'Integrations');
      case 'webhooks':
        return t('settingsLayout.itemWebhooks', 'Webhooks');
      case 'developer':
        return t('settingsLayout.itemDeveloper', 'Developer access');
      case 'audit-log':
        return t('settingsLayout.itemAuditLog', 'Audit log');
      default:
        return label;
    }
  };

  return (
    <div className="min-h-[calc(100vh-64px)]">
      {/* Mobile toggle */}
      <button
        type="button"
        onClick={() => setMenuOpen((v) => !v)}
        aria-controls={navId}
        aria-expanded={menuOpen}
        className="mb-3 flex items-center gap-2 text-sm font-medium text-[var(--fg-secondary)] lg:hidden"
      >
        <Icon name="menu" size={16} ariaHidden />
        {t('settingsLayout.mobileMenuToggle', 'Settings menu')}
      </button>

      <div className="flex flex-col lg:flex-row">
        {/* Sidebar */}
        <aside
          id={navId}
          className={cn(
            'w-full shrink-0 border-b border-[var(--border-subtle)] bg-[var(--surface-page)] lg:w-56 lg:border-b-0 lg:border-r',
            'lg:block',
            menuOpen ? 'block' : 'hidden',
          )}
        >
          <nav className="sticky top-0 px-3 py-4">
            {GROUPS.map((group) => (
              <div key={group.label} className="mb-5">
                <span className="px-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
                  {groupLabel(group.label)}
                </span>
                <ul className="mt-1 space-y-0.5">
                  {group.items
                    .filter((item) => !item.admin || isAdmin)
                    .map((item) => (
                      <li key={item.id}>
                        <button
                          type="button"
                          aria-current={active === item.id ? 'page' : undefined}
                          onClick={() => {
                            onChange(item.id);
                            setMenuOpen(false);
                          }}
                          className={cn(
                            'flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors',
                            active === item.id
                              ? 'bg-[var(--surface-hover)] font-medium text-[var(--fg-primary)]'
                              : 'text-[var(--fg-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--fg-primary)]',
                          )}
                        >
                          <Icon name={item.icon} size={16} ariaHidden />
                          {itemLabel(item.id, item.label)}
                        </button>
                      </li>
                    ))}
                </ul>
              </div>
            ))}
          </nav>
        </aside>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 lg:p-8">{children}</div>
      </div>
    </div>
  );
}
