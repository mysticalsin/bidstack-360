import { useQuery } from '@tanstack/react-query';
import { NavLink } from 'react-router-dom';

import { TooltipBare, TooltipProvider } from '@/components/ui/Tooltip';
import { Icon, type IconName } from '@/components/ui/Icon';
import { useOpportunityCount } from '@/hooks/useOpportunities';
import { useTaskSummary } from '@/hooks/useTasks';
import { relativeTime } from '@/lib/format';
import { cn } from '@/lib/cn';
import { prefetchRoute } from '@/lib/prefetch';
import { useAccountHistory, type AccountEntry } from '@/stores/accountHistory';
import { useIsAdmin } from '@/lib/auth';
import { useUiStore } from '@/stores/ui';
import { api } from '@/lib/api';

import {
  ADMIN_SETTINGS,
  MEMBER_SETTINGS,
  NAV_SECTIONS,
  type NavItem,
  type NavSection,
} from './navConfig';

const MAX_STARRED = 6;

type Badges = { openBids: number; overdueTasks: number };

export function Sidebar() {
  const oppsCount = useOpportunityCount({ excludeClosed: true });
  const taskSummary = useTaskSummary();
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

  // Badge counts only truly overdue tasks so its meaning matches the Dashboard KPI.
  const badges: Badges = {
    openBids: oppsCount.data?.count ?? 0,
    overdueTasks: taskSummary.data?.overdue ?? 0,
  };

  const settings = isAdmin ? ADMIN_SETTINGS : MEMBER_SETTINGS;

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
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {/* Hamburger when collapsed (the rail's first affordance), left-
              pointing chevron when expanded (telegraphing "click to close
              toward the left"). The chevron flip happens in CSS so motion
              is smooth if the user toggles rapidly. */}
          <Icon name={collapsed ? 'menu' : 'chevron-right'} size={collapsed ? 18 : 14} ariaHidden />
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

        {NAV_SECTIONS.map((section) => (
          <SidebarSection
            key={section.key}
            section={section}
            badges={badges}
            collapsed={collapsed}
          />
        ))}

        {/* Favorites first (intentional choice), then recents. Both groups
            self-hide when empty so a brand-new user doesn't see two
            confusing empty headers. */}
        {favorites.length > 0 ? (
          <SidebarGroup title="Starred">
            {favorites.slice(0, collapsed ? 3 : MAX_STARRED).map((acc) => (
              <AccountShortcut key={acc.slug} acc={acc} icon="starFilled" collapsed={collapsed} />
            ))}
          </SidebarGroup>
        ) : null}

        {recents.length > 0 ? (
          <SidebarGroup title="Recent">
            {recents.slice(0, collapsed ? 3 : 5).map((acc) => (
              <AccountShortcut key={acc.slug} acc={acc} icon="clock" collapsed={collapsed} />
            ))}
          </SidebarGroup>
        ) : null}

        <SidebarGroup title="Settings">
          {settings.map((item) => (
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

// A primary nav sub-section. When the rail is expanded the header is a
// disclosure button that collapses/expands the section (persisted per user).
// The "Home" section is pinned (single item, no header). In the icon-only
// rail there is no header — items render grouped, separated by the divider
// the CSS draws between adjacent `.sb-group` blocks.
function SidebarSection({
  section,
  badges,
  collapsed,
}: {
  section: NavSection;
  badges: Badges;
  collapsed: boolean;
}) {
  const sectionCollapsed = useUiStore((s) => Boolean(s.collapsedSections[section.key]));
  const toggleSection = useUiStore((s) => s.toggleSection);

  if (collapsed) {
    return (
      <div className="sb-group">
        {section.items.map((item) => (
          <SidebarItem key={item.to} item={item} badges={badges} collapsed />
        ))}
      </div>
    );
  }

  // Home is a single self-evident entry — render it without a disclosure.
  if (section.key === 'home') {
    return (
      <div className="sb-group">
        {section.items.map((item) => (
          <SidebarItem key={item.to} item={item} badges={badges} collapsed={false} />
        ))}
      </div>
    );
  }

  const bodyId = `sb-section-${section.key}`;
  return (
    <div className="sb-group">
      <button
        type="button"
        className="sb-group-title sb-group-toggle"
        onClick={() => toggleSection(section.key)}
        aria-expanded={!sectionCollapsed}
        aria-controls={bodyId}
      >
        <span>{section.title}</span>
        <Icon
          name="chevron-down"
          size={12}
          className={cn('sb-group-caret', sectionCollapsed && 'is-collapsed')}
          ariaHidden
        />
      </button>
      {!sectionCollapsed ? (
        <div id={bodyId} className="sb-group-body">
          {section.items.map((item) => (
            <SidebarItem key={item.to} item={item} badges={badges} collapsed={false} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

// Static (non-collapsible) group for Starred / Recent / Settings.
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
  badges: Badges;
  collapsed: boolean;
}) {
  const badge = item.badgeKey ? badges[item.badgeKey] : 0;
  // Hover/focus prefetch — kicks off the route's lazy chunk before the
  // click lands. Apple-style "make the next view feel pre-loaded" trick.
  const prefetch = () => prefetchRoute(item.to);
  // WHY a static string className (not the NavLink `({ isActive }) => …`
  // render-prop): in collapsed mode each link is wrapped by a Radix Tooltip
  // `Trigger asChild` (a Slot). The Slot merges className by joining, which
  // STRINGIFIES a function className onto the <a> (class="({ isActive }) =>
  // …") — silently dropping every `.sb-item` style. We instead let NavLink
  // set `aria-current="page"` natively and style the active state via the
  // `.sb-item[aria-current="page"]` selector, which survives the Slot merge.
  const link = (
    <NavLink
      to={item.to}
      end={item.end}
      className="sb-item"
      aria-label={item.label}
      title={collapsed ? undefined : item.label}
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
      <TooltipBare
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
      </TooltipBare>
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
      className="sb-item"
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
      <TooltipBare side="right" content={acc.name}>
        {link}
      </TooltipBare>
    );
  }
  return link;
}
