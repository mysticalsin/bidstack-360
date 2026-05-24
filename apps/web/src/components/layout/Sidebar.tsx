import { useQuery } from '@tanstack/react-query';
import { NavLink } from 'react-router-dom';

import { Tooltip, TooltipProvider } from '@/components/ui/Tooltip';
import { Icon, type IconName } from '@/components/ui/Icon';
import { useOpportunityCount } from '@/hooks/useOpportunities';
import { useTasks } from '@/hooks/useTasks';
import { daysUntil, relativeTime } from '@/lib/format';
import { cn } from '@/lib/cn';
import { prefetchRoute } from '@/lib/prefetch';
import { useAccountHistory, type AccountEntry } from '@/stores/accountHistory';
import { useIsAdmin } from '@/lib/auth';
import { useUiStore } from '@/stores/ui';
import { api } from '@/lib/api';

interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  badgeKey?: 'openBids' | 'overdueTasks';
}

const WORKSPACE: NavItem[] = [
  { to: '/dashboard', label: 'Dashboard', icon: 'dashboard' },
  { to: '/sales', label: 'Sales', icon: 'reports' },
  { to: '/sales/orders', label: 'Quotations & Orders', icon: 'briefcase' },
  { to: '/sales/products', label: 'Products', icon: 'package' },
  { to: '/sales/invoices', label: 'Invoices', icon: 'receipt' },
  { to: '/accounts', label: 'Accounts', icon: 'building' },
  { to: '/companies', label: 'Companies', icon: 'building' },
  { to: '/opportunities', label: 'Opportunities', icon: 'briefcase', badgeKey: 'openBids' },
  { to: '/pipeline', label: 'Pipeline', icon: 'pipeline' },
  { to: '/forecasts', label: 'Forecasts', icon: 'growth' },
  { to: '/bid-matrix', label: 'Bid/No-Bid Matrix', icon: 'target' },
  { to: '/leads', label: 'Leads', icon: 'target' },
  { to: '/contacts', label: 'Contacts', icon: 'contacts' },
  { to: '/tasks', label: 'Tasks', icon: 'tasks', badgeKey: 'overdueTasks' },
  { to: '/territories', label: 'Territories', icon: 'building' },
  { to: '/service-desk', label: 'Service Desk', icon: 'briefcase' },
  { to: '/workflows', label: 'Workflows', icon: 'pipeline' },
  { to: '/intake', label: 'Intake', icon: 'building' },
  { to: '/reports', label: 'Reports', icon: 'reports' },
];

const ADMIN_SETTINGS: NavItem[] = [
  { to: '/integrations', label: 'Integrations', icon: 'link' },
  { to: '/audit-log', label: 'Audit log', icon: 'reports' },
  { to: '/settings', label: 'Settings', icon: 'settings' },
];

const MEMBER_SETTINGS: NavItem[] = [
  { to: '/integrations', label: 'Integrations', icon: 'link' },
  { to: '/settings', label: 'Settings', icon: 'settings' },
];

export function Sidebar() {
  const oppsCount = useOpportunityCount({ excludeClosed: true });
  const tasks = useTasks();
  const collapsed = useUiStore((s) => s.sidebarCollapsed);
  const toggle = useUiStore((s) => s.toggleSidebar);
  const isAdmin = useIsAdmin();

  const dustQuery = useQuery({
    queryKey: ['dust:status'],
    queryFn: ({ signal }) =>
      api<{ configured: boolean; lastSyncAt: string | null }>('/api/integrations/dust/status', {
        signal,
      }),
    retry: false,
    refetchOnWindowFocus: false,
  });
  // Account history — show top 5 recents + all favorites. Favorites can
  // grow unbounded by design (users curate them), but recents are bounded
  // by the store's LRU eviction cap.
  const recents = useAccountHistory((s) => s.recents);
  const favorites = useAccountHistory((s) => s.favorites);

  const openBids = oppsCount.data?.count ?? 0;
  // Badge counts only truly overdue tasks (negative daysUntil) so its meaning
  // matches the Dashboard KPI. A "due within 7 days" filter belongs to a
  // separate upcoming surface; mixing the two confused what the count meant.
  const overdueTasks =
    tasks.data?.items.filter((t) => {
      const d = daysUntil(t.dueDate);
      return d !== null && d < 0 && t.status !== 'done';
    }).length ?? 0;

  const badges = { openBids, overdueTasks };

  return (
    <TooltipProvider delayDuration={300} disableHoverableContent>
      <nav
        className={cn('sidebar', collapsed && 'is-collapsed')}
        aria-label="Primary navigation"
        data-tour="nav-sidebar"
        style={{ position: 'relative' }}
      >
        <button
          type="button"
          onClick={toggle}
          className="sb-toggle"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!collapsed}
        >
          <Icon name="arrow" size={12} ariaHidden />
        </button>

        <div className="sb-brand">
          <div className="sb-mark" aria-hidden>
            B
          </div>
          <div>
            <div className="sb-name">
              BidStack<span className="deg">°</span>
            </div>
            <div className="sb-tag">Mantu · Bid &amp; presales</div>
          </div>
        </div>

        <SidebarGroup title="Workspace">
          {WORKSPACE.map((item) => (
            <SidebarItem key={item.to} item={item} badges={badges} collapsed={collapsed} />
          ))}
        </SidebarGroup>

        {/* Favorites first (intentional choice), then recents. Both groups
            self-hide when empty so a brand-new user doesn't see two
            confusing empty headers. */}
        {favorites.length > 0 ? (
          <SidebarGroup title="Starred">
            {favorites.map((acc) => (
              <AccountShortcut key={acc.slug} acc={acc} icon="starFilled" collapsed={collapsed} />
            ))}
          </SidebarGroup>
        ) : null}

        {recents.length > 0 ? (
          <SidebarGroup title="Recent">
            {recents.slice(0, 5).map((acc) => (
              <AccountShortcut key={acc.slug} acc={acc} icon="clock" collapsed={collapsed} />
            ))}
          </SidebarGroup>
        ) : null}

        <SidebarGroup title="Settings">
          {(isAdmin ? ADMIN_SETTINGS : MEMBER_SETTINGS).map((item) => (
            <SidebarItem key={item.to} item={item} badges={badges} collapsed={collapsed} />
          ))}
        </SidebarGroup>

        <div style={{ flex: 1 }} />

        <div className="sb-foot">
          <div className="sb-sync">
            {dustQuery.data?.configured ? (
              <>
                <span className="cs-pulse" aria-hidden />
                <span>
                  Dust connected
                  {dustQuery.data.lastSyncAt
                    ? ` · synced ${relativeTime(dustQuery.data.lastSyncAt)}`
                    : ''}
                </span>
              </>
            ) : (
              <a
                href="https://www.linkedin.com/in/tonywalteur/"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:underline"
                style={{ color: 'var(--fg-tertiary)', textDecoration: 'underline' }}
              >
                Created by Tony Walteur
              </a>
            )}
          </div>
        </div>
      </nav>
    </TooltipProvider>
  );
}

function SidebarGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="sb-group">
      <div className="sb-group-title">{title}</div>
      {children}
    </div>
  );
}

function SidebarItem({
  item,
  badges,
  collapsed,
}: {
  item: NavItem;
  badges: { openBids: number; overdueTasks: number };
  collapsed: boolean;
}) {
  const badge = item.badgeKey ? badges[item.badgeKey] : 0;
  // Hover/focus prefetch — kicks off the route's lazy chunk before the
  // click lands. Apple-style "make the next view feel pre-loaded" trick.
  const prefetch = () => prefetchRoute(item.to);
  const link = (
    <NavLink
      to={item.to}
      className={({ isActive }) => cn('sb-item', isActive && 'active')}
      aria-label={item.label}
      title={collapsed ? undefined : item.label}
      end={item.to === '/'}
      onMouseEnter={prefetch}
      onFocus={prefetch}
      onTouchStart={prefetch}
    >
      <Icon name={item.icon} size={16} />
      <span>{item.label}</span>
      {badge > 0 && <span className="sb-badge">{badge}</span>}
    </NavLink>
  );
  // Tooltips only when the label is hidden (collapsed mode) — otherwise
  // the label itself is the affordance and a tooltip would be redundant.
  if (collapsed) {
    return (
      <Tooltip
        side="right"
        content={
          <span className="flex items-center gap-2">
            <span>{item.label}</span>
            {badge > 0 ? (
              <span className="rounded bg-[var(--brand-primary-tint)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--brand-primary)]">
                {badge}
              </span>
            ) : null}
          </span>
        }
      >
        {link}
      </Tooltip>
    );
  }
  return link;
}

// Renders a single account entry (recent or starred) in the sidebar. We
// reuse the sb-item styling for visual parity with primary nav, but with
// no badge column.
function AccountShortcut({
  acc,
  icon,
  collapsed,
}: {
  acc: AccountEntry;
  icon: IconName;
  collapsed: boolean;
}) {
  const prefetch = () => prefetchRoute(`/accounts/${acc.slug}`);
  const link = (
    <NavLink
      to={`/accounts/${acc.slug}`}
      className={({ isActive }) => cn('sb-item', isActive && 'active')}
      title={collapsed ? undefined : acc.name}
      onMouseEnter={prefetch}
      onFocus={prefetch}
      onTouchStart={prefetch}
    >
      <Icon name={icon} size={14} />
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {acc.name}
      </span>
    </NavLink>
  );
  if (collapsed) {
    return (
      <Tooltip side="right" content={acc.name}>
        {link}
      </Tooltip>
    );
  }
  return link;
}
