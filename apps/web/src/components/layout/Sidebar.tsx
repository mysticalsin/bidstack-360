import { NavLink } from 'react-router-dom';

import { cn } from '@/lib/cn';

interface NavItem {
  to: string;
  label: string;
  icon: string;
  group: 'workspace' | 'settings';
}

const NAV: NavItem[] = [
  { to: '/dashboard', label: 'Dashboard', icon: '⌘', group: 'workspace' },
  { to: '/opportunities', label: 'Opportunities', icon: '◎', group: 'workspace' },
  { to: '/pipeline', label: 'Pipeline', icon: '◈', group: 'workspace' },
  { to: '/contacts', label: 'Contacts', icon: '◯', group: 'workspace' },
  { to: '/tasks', label: 'Tasks', icon: '✓', group: 'workspace' },
  { to: '/reports', label: 'Reports', icon: '◊', group: 'workspace' },
  { to: '/integrations', label: 'Integrations', icon: '⇄', group: 'settings' },
  { to: '/settings', label: 'Settings', icon: '⚙', group: 'settings' },
];

export function Sidebar() {
  const workspaceItems = NAV.filter((n) => n.group === 'workspace');
  const settingsItems = NAV.filter((n) => n.group === 'settings');

  return (
    <aside
      className="hidden md:flex w-[240px] flex-col border-r border-[var(--border-subtle)] bg-[var(--surface-sidebar)]"
      aria-label="Primary navigation"
    >
      <div className="flex h-14 items-center px-5 border-b border-[var(--border-subtle)]">
        <Logo />
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-6">
        <NavGroup label="Workspace" items={workspaceItems} />
        <NavGroup label="Settings" items={settingsItems} />
      </nav>

      <div className="border-t border-[var(--border-subtle)] p-3">
        <a
          href="https://github.com/twentyhq/twenty"
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2 px-3 py-2 text-xs text-[var(--fg-tertiary)] hover:text-[var(--fg-secondary)] transition-colors"
        >
          <span>v0.1.0 · Mantu</span>
        </a>
      </div>
    </aside>
  );
}

function Logo() {
  return (
    <div className="flex items-center gap-2">
      <div
        className="flex h-7 w-7 items-center justify-center rounded-md text-white font-bold text-sm"
        style={{ background: 'var(--brand-gradient, linear-gradient(135deg, var(--brand-primary), var(--brand-deep)))' }}
        aria-hidden
      >
        B
      </div>
      <div className="flex flex-col leading-tight">
        <span className="text-sm font-semibold text-[var(--fg-primary)]">BidStack 360°</span>
        <span className="text-[10px] uppercase tracking-wider text-[var(--fg-tertiary)]">Mantu</span>
      </div>
    </div>
  );
}

function NavGroup({ label, items }: { label: string; items: NavItem[] }) {
  return (
    <div>
      <div className="px-3 mb-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
        {label}
      </div>
      <ul className="space-y-0.5">
        {items.map((item) => (
          <li key={item.to}>
            <NavLink
              to={item.to}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-md px-3 py-1.5 text-sm transition-colors',
                  isActive
                    ? 'bg-[var(--brand-primary-tint)] text-[var(--brand-primary)] font-medium'
                    : 'text-[var(--fg-secondary)] hover:bg-[var(--surface-sunken)] hover:text-[var(--fg-primary)]',
                )
              }
            >
              <span className="text-base w-4 text-center" aria-hidden>
                {item.icon}
              </span>
              {item.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </div>
  );
}
