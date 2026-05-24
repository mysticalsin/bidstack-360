// CRM-style settings layout: fixed left sidebar (200px) + scrollable content area.
// Sections are grouped into Personal, Integrations, and Workspace.

import { useState } from 'react';
import { cn } from '@/lib/cn';
import { Icon, type IconName } from '@/components/ui/Icon';
import { useIsAdmin } from '@/lib/auth';

export type SettingsSection =
  | 'profile'
  | 'appearance'
  | 'notifications'
  | 'security'
  | 'microsoft'
  | 'mobile'
  | 'workspace'
  | 'advanced';

interface Group {
  label: string;
  items: { id: SettingsSection; label: string; icon: IconName; admin?: boolean }[];
}

const GROUPS: Group[] = [
  {
    label: 'Personal',
    items: [
      { id: 'profile', label: 'Profile', icon: 'user' },
      { id: 'appearance', label: 'Appearance', icon: 'palette' },
      { id: 'notifications', label: 'Notifications', icon: 'bell' },
      { id: 'security', label: 'Security', icon: 'shield' },
    ],
  },
  {
    label: 'Integrations',
    items: [
      { id: 'microsoft', label: 'Microsoft 365', icon: 'building' },
      { id: 'mobile', label: 'Mobile App', icon: 'phone' },
    ],
  },
  {
    label: 'Workspace',
    items: [
      { id: 'workspace', label: 'Workspace', icon: 'settings' },
      { id: 'advanced', label: 'Advanced', icon: 'sliders', admin: true },
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
  const [mobileOpen, setMobileOpen] = useState(false);
  const navId = 'settings-section-nav';

  return (
    <div className="min-h-[calc(100vh-64px)]">
      {/* Mobile toggle */}
      <button
        type="button"
        onClick={() => setMobileOpen((v) => !v)}
        aria-controls={navId}
        aria-expanded={mobileOpen}
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
            mobileOpen ? 'block' : 'hidden',
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
                            setMobileOpen(false);
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
