import { useState } from 'react';
import { cn } from '@/lib/cn';
import { Icon, type IconName } from '@/components/ui/Icon';
import { useIsAdmin } from '@/lib/auth';

export type SettingsSection =
  | 'overview'
  | 'profile'
  | 'appearance'
  | 'notifications'
  | 'security'
  | 'workspace'
  | 'language'
  | 'crm'
  | 'top-accounts'
  | 'groups'
  | 'opportunity-filters'
  | 'rfp-analytics'
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
    items: [{ id: 'overview', label: 'Overview', icon: 'dashboard' }],
  },
  {
    label: 'Personal',
    items: [
      { id: 'profile', label: 'Profile', icon: 'user' },
      { id: 'appearance', label: 'Appearance', icon: 'palette' },
      { id: 'language', label: 'Language', icon: 'globe' },
      { id: 'notifications', label: 'Notifications', icon: 'bell' },
      { id: 'security', label: 'Security', icon: 'shield' },
    ],
  },
  {
    label: 'Enterprise controls',
    items: [
      { id: 'workspace', label: 'Workspace', icon: 'settings' },
      { id: 'crm', label: 'Data configuration', icon: 'sliders', admin: true },
      { id: 'top-accounts', label: 'Top accounts', icon: 'star', admin: true },
      { id: 'groups', label: 'Access groups', icon: 'contacts', admin: true },
      { id: 'opportunity-filters', label: 'Opportunity filters', icon: 'sliders', admin: true },
      { id: 'rfp-analytics', label: 'RFP Analytics', icon: 'trophy', admin: true },
      { id: 'integrations', label: 'Integrations', icon: 'link' },
      { id: 'webhooks', label: 'Webhooks', icon: 'webhook', admin: true },
      { id: 'audit-log', label: 'Audit log', icon: 'shield', admin: true },
      { id: 'developer', label: 'Developer access', icon: 'zap', admin: true },
    ],
  },
];

interface Props {
  active: SettingsSection;
  onChange: (id: SettingsSection) => void;
  children: React.ReactNode;
}

export function SettingsLayout({ active, onChange, children }: Props) {
  const isAdmin = useIsAdmin();
  const [menuOpen, setMenuOpen] = useState(false);
  const navId = 'settings-section-nav';

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
        Settings menu
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
                  {group.label}
                </span>
                <ul className="mt-1 space-y-0.5">
                  {group.items
                    .filter((item) => !item.admin || isAdmin)
                    .map((item) => (
                      <li key={item.id}>
                        <button
                          type="button"
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
                          {item.label}
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
