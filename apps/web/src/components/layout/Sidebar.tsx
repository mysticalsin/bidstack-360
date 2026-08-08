import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { NavLink, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { TooltipBare, TooltipProvider } from '@/components/ui/Tooltip';
import { Icon, type IconName } from '@/components/ui/Icon';
import { PoloPreSalesLogo } from '@/components/brand/PoloPreSalesLogo';
import { useOpportunityCount } from '@/hooks/useOpportunities';
import { useTaskSummary } from '@/hooks/useTasks';
import { relativeTime } from '@/lib/format';
import { cn } from '@/lib/cn';
import { prefetchRoute } from '@/lib/prefetch';
import { useAccountHistory, type AccountEntry } from '@/stores/accountHistory';
import { useIsAdmin } from '@/lib/auth';
import { useUiStore } from '@/stores/ui';
import { api } from '@/lib/api';
import { useAppModules } from '@/hooks/useAppModules';
import {
  ADMIN_SETTINGS,
  MEMBER_SETTINGS,
  NAV_SECTIONS,
  isNavItemVisible,
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
  const { t } = useTranslation('common');
  const { data: appModules } = useAppModules();

  // Hide module-gated items (agent-studio, Collaborate) unless enabled in
  // Settings → Modules; drop a section that ends up empty after filtering.
  const sections = NAV_SECTIONS.map((s) => ({
    ...s,
    items: s.items.filter((it) => isNavItemVisible(it, appModules)),
  })).filter((s) => s.items.length > 0);

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
            <PoloPreSalesLogo variant="mark" tone="inverse" title="" className="h-5 w-5" />
          </div>
          <div>
            <div className="sb-name">
              Polo PreSales
            </div>
            <div className="sb-tag">Mantu · Bid &amp; presales</div>
          </div>
        </div>

        {/* True accordion (see useUiStore.setSectionCollapsed) keeps at most one
            section open, so this region fits without scrolling in normal use.
            overflow-y-auto stays as a safety net for small viewports /
            large zoom levels, not as the primary answer to a tall list. */}
        <div className="sb-scroll flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain">
        {sections.map((section) => (
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
          <SidebarGroup title={t('nav.starred', 'Starred')}>
            {favorites.slice(0, collapsed ? 3 : MAX_STARRED).map((acc) => (
              <AccountShortcut key={acc.slug} acc={acc} icon="starFilled" collapsed={collapsed} />
            ))}
          </SidebarGroup>
        ) : null}

        {recents.length > 0 ? (
          <SidebarGroup title={t('nav.recent', 'Recent')}>
            {recents.slice(0, collapsed ? 3 : 5).map((acc) => (
              <AccountShortcut key={acc.slug} acc={acc} icon="clock" collapsed={collapsed} />
            ))}
          </SidebarGroup>
        ) : null}

        <SidebarGroup title={t('nav.settings', 'Settings')}>
          {settings.map((item) => (
            <SidebarItem key={item.to} item={item} badges={badges} collapsed={collapsed} />
          ))}
        </SidebarGroup>

        </div>

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
              <span style={{ color: 'var(--fg-tertiary)' }}>Dust not connected</span>
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
  const location = useLocation();
  const override = useUiStore((s) => s.collapsedSections[section.key]);
  const setSectionCollapsed = useUiStore((s) => s.setSectionCollapsed);
  const { t } = useTranslation('common');
  const sectionTitle = t(section.titleKey, section.title);
  // Accordion: a section is collapsed by default unless it holds the active
  // route — so only one section's items show at once and the rail never needs
  // an internal scroll. An explicit user toggle (override) wins and persists.
  const isActiveSection = section.items.some(
    (it) => location.pathname === it.to || location.pathname.startsWith(`${it.to}/`),
  );
  const sectionCollapsed = override === undefined ? !isActiveSection : override;

  if (collapsed) {
    if (section.key === 'home') {
      return (
        <div className="sb-group">
          {section.items.map((item) => (
            <SidebarItem key={item.to} item={item} badges={badges} collapsed />
          ))}
        </div>
      );
    }

    const totalBadge = section.items.reduce((acc, item) => {
      const badge = item.badgeKey ? badges[item.badgeKey] : 0;
      return acc + badge;
    }, 0);

    return (
      <div className="sb-group sb-parent-container group/parent">
        <button
          type="button"
          className="sb-item sb-parent-trigger"
          aria-label={sectionTitle}
          title={sectionTitle}
          onClick={() => {
            const toggleSidebar = useUiStore.getState().toggleSidebar;
            toggleSidebar();
          }}
        >
          <Icon name={section.icon} size={16} />
          {totalBadge > 0 && <span className="sb-badge-dot" />}
        </button>
        {/* Flyout menu */}
        <div className="sb-flyout">
          <div className="sb-flyout-header">{sectionTitle}</div>
          <div className="sb-flyout-content">
            {section.items.map((item) => {
              const badge = item.badgeKey ? badges[item.badgeKey] : 0;
              return (
                <NavLink key={item.to} to={item.to} end={item.end} className="sb-flyout-item">
                  <span>{t(item.labelKey, item.label)}</span>
                  {badge > 0 && <span className="sb-badge">{badge}</span>}
                </NavLink>
              );
            })}
          </div>
        </div>
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
        onClick={() => setSectionCollapsed(section.key, !sectionCollapsed)}
        aria-expanded={!sectionCollapsed}
        aria-controls={bodyId}
      >
        <span>{sectionTitle}</span>
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
  const location = useLocation();
  const { t } = useTranslation('common');
  const label = t(item.labelKey, item.label);
  const badge = item.badgeKey ? badges[item.badgeKey] : 0;
  const prefetch = () => prefetchRoute(item.to);

  const isActive = useMemo(() => {
    try {
      const toUrl = new URL(item.to, window.location.origin);
      const toPath = toUrl.pathname;
      const toTab = toUrl.searchParams.get('tab');

      const currentTab = new URLSearchParams(location.search).get('tab');

      if (location.pathname !== toPath) return false;

      if (toTab) {
        return currentTab === toTab;
      } else {
        return !currentTab || currentTab === 'overview';
      }
    } catch {
      return false;
    }
  }, [location, item.to]);

  const link = (
    <NavLink
      to={item.to}
      end={item.end}
      aria-current={isActive ? 'page' : undefined}
      className={cn('sb-item', isActive && 'is-active')}
      aria-label={label}
      title={collapsed ? undefined : label}
      onMouseEnter={prefetch}
      onFocus={prefetch}
      onTouchStart={prefetch}
    >
      <Icon name={item.icon} size={16} />
      <span>{label}</span>
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
            <span>{label}</span>
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
